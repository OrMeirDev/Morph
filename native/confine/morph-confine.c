// morph-confine: runs one conversion engine inside a Windows Job Object and, by default, an
// AppContainer. Used by electron/infra/Confinement.cjs; never by users directly.
//
//   morph-confine.exe [options] -- <exe> [args...]
//
//   --appcontainer <name>  run in the AppContainer <name> (its profile is created if missing:
//                          Windows refuses to start a process in an unregistered AppContainer,
//                          error 2, measured). No network capability: no network, no access to
//                          files unless granted below
//   --ephemeral            delete that AppContainer profile again on every exit this process
//                          controls (a killed helper leaves it; the caller then deletes it, and
//                          --sweep-profiles removes leftovers after a crash)
//   --capability <name>    add a custom capability SID derived from <name> to the AppContainer
//                          token; --read grants then go to the capability (shared by every job,
//                          granted once), --write grants to the job's own AppContainer SID
//   --restrict-writes <name> with --low-integrity: also make the token write-restricted to a SID
//                          derived from <name> (per job), so it may write only where that SID is
//                          granted (the --write paths), not into other Low folders
//   --low-integrity        instead of an AppContainer (for engines that cannot run in one): a
//                          restricted copy of the caller's token at Low integrity, all privileges
//                          but traverse dropped, Administrators deny-only. Windows then refuses
//                          writes to anything not labelled Low (all normal user files); reads and
//                          the network are NOT restricted in this mode.
//   --read <path>          AppContainer: grant read + execute on <path> (inherited by children)
//   --write <path>         AppContainer: grant modify on <path>; low integrity: label <path> Low
//                          so the engine may write there (both inherited by children)
//   --job-memory <MiB>     job-wide committed-memory limit
//   --process-memory <MiB> per-process committed-memory limit
//   --max-processes <n>    simultaneously active processes in the job
//   --parent <pid>         end the job when this process ends
//   --cwd <dir>            working directory of the engine
//   --stats <file>         write the outcome and resource accounting as one JSON object
//   --sid <name>           print the AppContainer SID for <name> and exit
//   --delete-profile <name> delete the AppContainer profile <name> and exit
//   --sweep-profiles <prefix> delete every AppContainer profile whose name starts with <prefix>
//   --list-profiles <prefix>  print the names of those profiles, one per line
//
// Lifetime: the job has KILL_ON_JOB_CLOSE and only this process holds its handle, so killing this
// process (cancel), its parent dying (--parent), a limit being hit, or the engine's main process
// exiting all end every process in the job. Grants are only ever added to folders Morph owns; the
// caller decides which (Confinement.cjs).
//
// Exit code: the engine's exit code, or one of the MC_EXIT_* codes below; --stats says which.
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <userenv.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#define MC_EXIT_SETUP 0x4D430001u
#define MC_EXIT_LIMIT 0x4D430002u
#define MC_EXIT_PARENT 0x4D430003u
#define MC_EXIT_USAGE 0x4D430004u
#define MAX_GRANTS 32
#define ORPHAN_GRACE_MS 2000

typedef struct {
  const wchar_t *appContainer;
  int ephemeral;
  const wchar_t *capability;
  const wchar_t *restrictWrites;
  int lowIntegrity;
  const wchar_t *read[MAX_GRANTS];
  int nRead;
  const wchar_t *write[MAX_GRANTS];
  int nWrite;
  ULONGLONG jobMemory, processMemory;
  DWORD maxProcesses;
  DWORD parentPid;
  const wchar_t *cwd;
  const wchar_t *stats;
  int argStart; // index of the engine executable in argv
} Options;

typedef struct {
  const char *outcome; // exited | limit-memory | limit-processes | parent-gone | setup-failed
  DWORD exitCode;
  char error[512];
  char sid[192];
  int appContainer;
  int lowIntegrity;
  int writeRestricted;
  int profileDeleted;
  DWORD profileMs;
  int orphansKilled;
  DWORD peakActive;
  DWORD grantMs;
  char unprotected[1024]; // granted paths on volumes without ACLs (FAT32/exFAT): not confinable
} Result;

static Result R = { .outcome = "setup-failed", .exitCode = MC_EXIT_SETUP };

static void setError(const char *step, DWORD code) {
  snprintf(R.error, sizeof R.error, "%s failed (Windows error %lu)", step, (unsigned long)code);
}

static void jsonEscape(FILE *f, const char *s) {
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') fprintf(f, "\\%c", c);
    else if (c < 0x20) fprintf(f, "\\u%04x", c);
    else fputc(c, f);
  }
}

static void toUtf8(const wchar_t *w, char *out, int size) {
  if (!WideCharToMultiByte(CP_UTF8, 0, w, -1, out, size, NULL, NULL)) out[0] = 0;
}

static void writeStats(const Options *o, HANDLE job) {
  if (!o->stats) return;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = { 0 };
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION acct = { 0 };
  if (job) {
    QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &ext, sizeof ext, NULL);
    QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &acct, sizeof acct, NULL);
  }
  FILE *f = _wfopen(o->stats, L"wb");
  if (!f) return;
  fprintf(f, "{\"outcome\":\"%s\",\"exitCode\":%lu,\"appContainer\":%s,\"lowIntegrity\":%s,\"writeRestricted\":%s,\"sid\":\"", R.outcome,
          (unsigned long)R.exitCode, R.appContainer ? "true" : "false", R.lowIntegrity ? "true" : "false", R.writeRestricted ? "true" : "false");
  jsonEscape(f, R.sid);
  fprintf(f, "\",\"error\":\"");
  jsonEscape(f, R.error);
  fprintf(f, "\",\"unprotected\":\"");
  jsonEscape(f, R.unprotected);
  fprintf(f, "\",\"peakJobMemory\":%llu,\"peakProcessMemory\":%llu,\"totalProcesses\":%lu,\"peakActiveProcesses\":%lu,"
             "\"userMs\":%llu,\"kernelMs\":%llu,\"orphansKilled\":%s,\"grantMs\":%lu,\"profileMs\":%lu,\"profileDeleted\":%s,"
             "\"limits\":{\"jobMemory\":%llu,\"processMemory\":%llu,\"maxProcesses\":%lu}}",
          (unsigned long long)ext.PeakJobMemoryUsed, (unsigned long long)ext.PeakProcessMemoryUsed,
          (unsigned long)acct.TotalProcesses, (unsigned long)R.peakActive,
          (unsigned long long)(acct.TotalUserTime.QuadPart / 10000), (unsigned long long)(acct.TotalKernelTime.QuadPart / 10000),
          R.orphansKilled ? "true" : "false", (unsigned long)R.grantMs, (unsigned long)R.profileMs, R.profileDeleted ? "true" : "false",
          (unsigned long long)o->jobMemory, (unsigned long long)o->processMemory, (unsigned long)o->maxProcesses);
  fclose(f);
}

static int parseArgs(int argc, wchar_t **argv, Options *o) {
  for (int i = 1; i < argc; i++) {
    const wchar_t *a = argv[i];
    const wchar_t *v = i + 1 < argc ? argv[i + 1] : NULL;
    if (!wcscmp(a, L"--")) { o->argStart = i + 1; return o->argStart < argc && !(o->appContainer && o->lowIntegrity); }
    if (!wcscmp(a, L"--low-integrity")) { o->lowIntegrity = 1; continue; }
    if (!wcscmp(a, L"--ephemeral")) { o->ephemeral = 1; continue; }
    if (!v) return 0;
    if (!wcscmp(a, L"--appcontainer")) o->appContainer = v;
    else if (!wcscmp(a, L"--capability")) o->capability = v;
    else if (!wcscmp(a, L"--restrict-writes")) o->restrictWrites = v;
    else if (!wcscmp(a, L"--read")) { if (o->nRead == MAX_GRANTS) return 0; o->read[o->nRead++] = v; }
    else if (!wcscmp(a, L"--write")) { if (o->nWrite == MAX_GRANTS) return 0; o->write[o->nWrite++] = v; }
    else if (!wcscmp(a, L"--job-memory")) o->jobMemory = _wcstoui64(v, NULL, 10) * 1024 * 1024;
    else if (!wcscmp(a, L"--process-memory")) o->processMemory = _wcstoui64(v, NULL, 10) * 1024 * 1024;
    else if (!wcscmp(a, L"--max-processes")) o->maxProcesses = (DWORD)wcstoul(v, NULL, 10);
    else if (!wcscmp(a, L"--parent")) o->parentPid = (DWORD)wcstoul(v, NULL, 10);
    else if (!wcscmp(a, L"--cwd")) o->cwd = v;
    else if (!wcscmp(a, L"--stats")) o->stats = v;
    else return 0;
    i++;
  }
  return 0;
}

// The AppContainer SID for `name`, creating its profile if missing (a process cannot start in an
// AppContainer whose profile is not registered).
static HRESULT containerSid(const wchar_t *name, PSID *sid) {
  HRESULT hr = CreateAppContainerProfile(name, L"Morph conversion job",
                                         L"One Morph conversion job: no network, files only as granted.", NULL, 0, sid);
  if (hr == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) hr = DeriveAppContainerSidFromAppContainerName(name, sid);
  return hr;
}

// AppContainer profiles are registered per user under this key, one subkey per SID with the
// profile name in "Moniker".
#define MAPPINGS L"Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings"
static int forEachProfile(const wchar_t *prefix, int remove) {
  HKEY root;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, MAPPINGS, 0, KEY_READ, &root) != ERROR_SUCCESS) return 0;
  // Collect first: deleting while enumerating would shift the indices.
  wchar_t (*names)[256] = calloc(4096, sizeof *names);
  int n = 0;
  wchar_t sub[256];
  for (DWORD i = 0; names && n < 4096; i++) {
    DWORD len = 256;
    if (RegEnumKeyExW(root, i, sub, &len, NULL, NULL, NULL, NULL) != ERROR_SUCCESS) break;
    wchar_t moniker[256];
    DWORD size = sizeof moniker;
    if (RegGetValueW(root, sub, L"Moniker", RRF_RT_REG_SZ, NULL, moniker, &size) != ERROR_SUCCESS) continue;
    if (!wcsncmp(moniker, prefix, wcslen(prefix))) wcscpy_s(names[n++], 256, moniker);
  }
  RegCloseKey(root);
  for (int i = 0; i < n; i++) {
    if (remove) DeleteAppContainerProfile(names[i]);
    else wprintf(L"%ls\n", names[i]);
  }
  free(names);
  return n;
}

// A custom capability SID (S-1-15-3-...) derived from `name`.
// (Looked up in KernelBase.dll at run time: not every toolchain's import library has it.)
typedef BOOL(WINAPI *DeriveCapsFn)(LPCWSTR, PSID **, DWORD *, PSID **, DWORD *);
static PSID capabilitySid(const wchar_t *name) {
  PSID *groups = NULL, *caps = NULL;
  DWORD nGroups = 0, nCaps = 0;
  HMODULE kb = GetModuleHandleW(L"kernelbase.dll");
  DeriveCapsFn derive = kb ? (DeriveCapsFn)(void *)GetProcAddress(kb, "DeriveCapabilitySidsFromName") : NULL;
  if (!derive) { SetLastError(ERROR_PROC_NOT_FOUND); return NULL; }
  if (!derive(name, &groups, &nGroups, &caps, &nCaps) || !nCaps) return NULL;
  for (DWORD i = 0; i < nGroups; i++) LocalFree(groups[i]);
  LocalFree(groups);
  PSID sid = caps[0];
  for (DWORD i = 1; i < nCaps; i++) LocalFree(caps[i]);
  LocalFree(caps);
  return sid;
}

// Adds an inheritable allow ACE for `sid` on `path` unless one with at least `mask` is there.
// Returns 0 on success, 1 when the volume keeps no ACLs (nothing to grant, nothing protected).
static int grant(const wchar_t *path, PSID sid, DWORD mask, DWORD *err) {
  PACL dacl = NULL;
  PSECURITY_DESCRIPTOR sd = NULL;
  DWORD attrs = GetFileAttributesW(path);
  if (attrs == INVALID_FILE_ATTRIBUTES) { *err = GetLastError(); return -1; }
  DWORD rc = GetNamedSecurityInfoW(path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, &dacl, NULL, &sd);
  if (rc != ERROR_SUCCESS) { *err = rc; return -1; }
  int result = -1;
  if (!dacl) { result = 1; goto done; } // FAT32/exFAT: no security at all
  BOOL isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
  for (DWORD i = 0; i < dacl->AceCount; i++) {
    ACCESS_ALLOWED_ACE *ace;
    if (!GetAce(dacl, i, (void **)&ace) || ace->Header.AceType != ACCESS_ALLOWED_ACE_TYPE) continue;
    if (!EqualSid((PSID)&ace->SidStart, sid)) continue;
    BOOL inherits = !isDir || (ace->Header.AceFlags & (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)) == (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE);
    if ((ace->Mask & mask) == mask && inherits) { result = 0; goto done; }
  }
  EXPLICIT_ACCESSW ea = { 0 };
  ea.grfAccessPermissions = mask;
  ea.grfAccessMode = GRANT_ACCESS;
  ea.grfInheritance = isDir ? SUB_CONTAINERS_AND_OBJECTS_INHERIT : NO_INHERITANCE;
  ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  ea.Trustee.ptstrName = (LPWSTR)sid;
  PACL updated = NULL;
  rc = SetEntriesInAclW(1, &ea, dacl, &updated);
  if (rc == ERROR_SUCCESS) {
    rc = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, updated, NULL);
    LocalFree(updated);
  }
  if (rc == ERROR_SUCCESS) result = 0; else *err = rc;
done:
  if (sd) LocalFree(sd);
  return result;
}

// A restricted, Low-integrity copy of this process's token for engines that cannot run in an
// AppContainer. NULL on failure (error recorded).
static HANDLE lowToken(PSID restrictTo) {
  HANDLE self = NULL, restricted = NULL;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT, &self)) {
    setError("OpenProcessToken", GetLastError());
    return NULL;
  }
  BYTE admins[SECURITY_MAX_SID_SIZE], low[SECURITY_MAX_SID_SIZE];
  DWORD n1 = sizeof admins, n2 = sizeof low;
  CreateWellKnownSid(WinBuiltinAdministratorsSid, NULL, admins, &n1);
  CreateWellKnownSid(WinLowLabelSid, NULL, low, &n2);
  SID_AND_ATTRIBUTES denyOnly = { (PSID)admins, 0 };
  // Write-restricted: every write access check must also pass for one of these SIDs (reads are
  // unaffected). The job's SID is granted only on its --write paths.
  BYTE restrictedSid[SECURITY_MAX_SID_SIZE];
  DWORD n3 = sizeof restrictedSid;
  CreateWellKnownSid(WinRestrictedCodeSid, NULL, restrictedSid, &n3);
  SID_AND_ATTRIBUTES restricting[2] = { { restrictTo, 0 }, { (PSID)restrictedSid, 0 } };
  DWORD flags = DISABLE_MAX_PRIVILEGE | (restrictTo ? WRITE_RESTRICTED : 0);
  if (!CreateRestrictedToken(self, flags, 1, &denyOnly, 0, NULL, restrictTo ? 2 : 0, restrictTo ? restricting : NULL, &restricted)) {
    setError("CreateRestrictedToken", GetLastError());
    CloseHandle(self);
    return NULL;
  }
  CloseHandle(self);
  if (restrictTo) {
    // Objects the engine creates itself (pipes, events, files) get this default DACL; it must name
    // a restricting SID too, or the engine could not write to its own objects.
    BYTE system[SECURITY_MAX_SID_SIZE];
    DWORD n4 = sizeof system;
    CreateWellKnownSid(WinLocalSystemSid, NULL, system, &n4);
    BYTE userBuf[256];
    DWORD got = 0;
    if (!GetTokenInformation(restricted, TokenUser, userBuf, sizeof userBuf, &got)) {
      setError("GetTokenInformation(user)", GetLastError());
      CloseHandle(restricted);
      return NULL;
    }
    PSID user = ((TOKEN_USER *)userBuf)->User.Sid;
    PSID who[4] = { user, (PSID)system, restrictTo, (PSID)restrictedSid };
    DWORD size = sizeof(ACL);
    for (int i = 0; i < 4; i++) size += sizeof(ACCESS_ALLOWED_ACE) + GetLengthSid(who[i]);
    PACL dacl = (PACL)LocalAlloc(LPTR, size);
    BOOL ok = dacl && InitializeAcl(dacl, size, ACL_REVISION);
    for (int i = 0; ok && i < 4; i++) ok = AddAccessAllowedAce(dacl, ACL_REVISION, GENERIC_ALL, who[i]);
    TOKEN_DEFAULT_DACL dd = { dacl };
    if (!ok || !SetTokenInformation(restricted, TokenDefaultDacl, &dd, sizeof dd)) {
      setError("SetTokenInformation(default DACL)", GetLastError());
      if (dacl) LocalFree(dacl);
      CloseHandle(restricted);
      return NULL;
    }
    LocalFree(dacl);
  }
  TOKEN_MANDATORY_LABEL tml = { { (PSID)low, SE_GROUP_INTEGRITY } };
  if (!SetTokenInformation(restricted, TokenIntegrityLevel, &tml, sizeof tml + GetLengthSid((PSID)low))) {
    setError("SetTokenInformation(Low)", GetLastError());
    CloseHandle(restricted);
    return NULL;
  }
  return restricted;
}

// Labels `path` Low (inherited by children) so a Low-integrity engine may write there.
// Returns 0, 1 when the volume keeps no labels (FAT32/exFAT), or -1 with *err.
static int labelLow(const wchar_t *path, DWORD *err) {
  DWORD attrs = GetFileAttributesW(path);
  if (attrs == INVALID_FILE_ATTRIBUTES) { *err = GetLastError(); return -1; }
  PSECURITY_DESCRIPTOR sd = NULL;
  PACL sacl = NULL;
  BOOL present = FALSE, defaulted = FALSE;
  const wchar_t *sddl = (attrs & FILE_ATTRIBUTE_DIRECTORY) ? L"S:(ML;OICI;NW;;;LW)" : L"S:(ML;;NW;;;LW)";
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &sd, NULL)
      || !GetSecurityDescriptorSacl(sd, &present, &sacl, &defaulted)) {
    *err = GetLastError();
    if (sd) LocalFree(sd);
    return -1;
  }
  DWORD rc = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, NULL, NULL, NULL, sacl);
  LocalFree(sd);
  if (rc == ERROR_SUCCESS) return 0;
  if (rc == ERROR_NOT_SUPPORTED || rc == ERROR_INVALID_FUNCTION) return 1;
  *err = rc;
  return -1;
}

// Quoting that CommandLineToArgvW and the MSVC runtime parse back to the same argument.
static void appendQuoted(wchar_t *buf, size_t cap, size_t *len, const wchar_t *arg) {
#define PUT(ch) do { if (*len + 1 < cap) buf[(*len)++] = (ch); } while (0)
  if (*len) PUT(L' ');
  if (*arg && !wcspbrk(arg, L" \t\n\v\"")) { for (; *arg; arg++) PUT(*arg); buf[*len] = 0; return; }
  PUT(L'"');
  for (const wchar_t *p = arg;; p++) {
    size_t slashes = 0;
    while (*p == L'\\') { p++; slashes++; }
    if (!*p) { for (size_t k = 0; k < slashes * 2; k++) PUT(L'\\'); break; }
    if (*p == L'"') { for (size_t k = 0; k < slashes * 2 + 1; k++) PUT(L'\\'); PUT(L'"'); }
    else { for (size_t k = 0; k < slashes; k++) PUT(L'\\'); PUT(*p); }
  }
  PUT(L'"');
  buf[*len] = 0;
#undef PUT
}

static DWORD activeProcesses(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION acct = { 0 };
  QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &acct, sizeof acct, NULL);
  return acct.ActiveProcesses;
}

static DWORD finish(const Options *o, HANDLE job, DWORD code) {
  if (o->ephemeral && o->appContainer && R.appContainer) R.profileDeleted = SUCCEEDED(DeleteAppContainerProfile(o->appContainer));
  writeStats(o, job);
  if (R.error[0]) fprintf(stderr, "morph-confine: %s\n", R.error);
  fflush(stderr);
  return code;
}

int wmain(int argc, wchar_t **argv) {
  if (argc == 3 && !wcscmp(argv[1], L"--sid")) {
    PSID sid = NULL;
    wchar_t *s = NULL;
    if (FAILED(containerSid(argv[2], &sid)) || !ConvertSidToStringSidW(sid, &s)) return (int)MC_EXIT_SETUP;
    wprintf(L"%ls\n", s);
    return 0;
  }
  if (argc == 3 && (!wcscmp(argv[1], L"--sweep-profiles") || !wcscmp(argv[1], L"--list-profiles"))) {
    int n = forEachProfile(argv[2], !wcscmp(argv[1], L"--sweep-profiles"));
    if (!wcscmp(argv[1], L"--sweep-profiles")) wprintf(L"%d\n", n);
    return 0;
  }
  if (argc == 3 && !wcscmp(argv[1], L"--delete-profile")) {
    HRESULT hr = DeleteAppContainerProfile(argv[2]);
    return SUCCEEDED(hr) || hr == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) ? 0 : (int)MC_EXIT_SETUP;
  }

  Options o = { 0 };
  if (!parseArgs(argc, argv, &o)) {
    fwprintf(stderr, L"usage: morph-confine.exe [--appcontainer name [--capability name] | --low-integrity [--restrict-writes name]] [--read p] [--write p] [--job-memory MiB] "
                     L"[--process-memory MiB] [--max-processes n] [--parent pid] [--cwd dir] [--stats file] -- exe [args]\n");
    return (int)MC_EXIT_USAGE;
  }

  HANDLE parent = NULL;
  if (o.parentPid) {
    parent = OpenProcess(SYNCHRONIZE, FALSE, o.parentPid);
    if (!parent) { setError("OpenProcess(parent)", GetLastError()); return (int)finish(&o, NULL, MC_EXIT_SETUP); }
    if (WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) { R.outcome = "parent-gone"; return (int)finish(&o, NULL, MC_EXIT_PARENT); }
  }

  // 1. The job: everything the engine starts belongs to it and dies with it.
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (!job) { setError("CreateJobObject", GetLastError()); return (int)finish(&o, NULL, MC_EXIT_SETUP); }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION lim = { 0 };
  lim.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
  if (o.jobMemory) { lim.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY; lim.JobMemoryLimit = (SIZE_T)o.jobMemory; }
  if (o.processMemory) { lim.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY; lim.ProcessMemoryLimit = (SIZE_T)o.processMemory; }
  if (o.maxProcesses) { lim.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS; lim.BasicLimitInformation.ActiveProcessLimit = o.maxProcesses; }
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &lim, sizeof lim)) {
    setError("SetInformationJobObject(limits)", GetLastError());
    return (int)finish(&o, job, MC_EXIT_SETUP);
  }
  // No clipboard, no global atoms, no changing display or system settings, no logging off.
  JOBOBJECT_BASIC_UI_RESTRICTIONS ui = { JOB_OBJECT_UILIMIT_READCLIPBOARD | JOB_OBJECT_UILIMIT_WRITECLIPBOARD | JOB_OBJECT_UILIMIT_GLOBALATOMS
                                         | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS | JOB_OBJECT_UILIMIT_EXITWINDOWS
                                         | JOB_OBJECT_UILIMIT_DESKTOP };
  if (!SetInformationJobObject(job, JobObjectBasicUIRestrictions, &ui, sizeof ui)) {
    setError("SetInformationJobObject(ui)", GetLastError());
    return (int)finish(&o, job, MC_EXIT_SETUP);
  }
  HANDLE port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1);
  JOBOBJECT_ASSOCIATE_COMPLETION_PORT acp = { job, port };
  if (!port || !SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &acp, sizeof acp)) {
    setError("job completion port", GetLastError());
    return (int)finish(&o, job, MC_EXIT_SETUP);
  }

  // 2. The AppContainer and its grants.
  PSID sid = NULL, capSid = NULL;
  SECURITY_CAPABILITIES caps = { 0 };
  SID_AND_ATTRIBUTES capAttr = { 0 };
  if (o.appContainer) {
    ULONGLONG p0 = GetTickCount64();
    HRESULT hr = containerSid(o.appContainer, &sid);
    if (FAILED(hr)) { setError("CreateAppContainerProfile", (DWORD)hr); return (int)finish(&o, job, MC_EXIT_SETUP); }
    R.appContainer = 1; // a profile exists from here on (deleted on exit with --ephemeral)
    R.profileMs = (DWORD)(GetTickCount64() - p0);
    if (o.capability) {
      capSid = capabilitySid(o.capability);
      if (!capSid) { setError("DeriveCapabilitySidsFromName", GetLastError()); return (int)finish(&o, job, MC_EXIT_SETUP); }
      capAttr.Sid = capSid;
      capAttr.Attributes = SE_GROUP_ENABLED;
      caps.Capabilities = &capAttr;
      caps.CapabilityCount = 1;
    }
    wchar_t *s = NULL;
    if (ConvertSidToStringSidW(sid, &s)) { toUtf8(s, R.sid, sizeof R.sid); LocalFree(s); }
    ULONGLONG t0 = GetTickCount64();
    for (int pass = 0; pass < 2; pass++) {
      int n = pass ? o.nWrite : o.nRead;
      const wchar_t **list = pass ? o.write : o.read;
      DWORD mask = pass ? (FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE) : (FILE_GENERIC_READ | FILE_GENERIC_EXECUTE);
      for (int i = 0; i < n; i++) {
        DWORD err = 0;
        int g = grant(list[i], (pass == 0 && capSid) ? capSid : sid, mask, &err);
        if (g < 0) {
          char p[400];
          toUtf8(list[i], p, sizeof p);
          snprintf(R.error, sizeof R.error, "granting %s on %s failed (Windows error %lu)", pass ? "write" : "read", p, (unsigned long)err);
          return (int)finish(&o, job, MC_EXIT_SETUP);
        }
        if (g == 1) {
          char p[400];
          toUtf8(list[i], p, sizeof p);
          size_t used = strlen(R.unprotected);
          snprintf(R.unprotected + used, sizeof R.unprotected - used, "%s%s", used ? ";" : "", p);
        }
      }
    }
    R.grantMs = (DWORD)(GetTickCount64() - t0);
    caps.AppContainerSid = sid;
    R.appContainer = 1;
  }
  HANDLE token = NULL;
  PSID writeSid = NULL;
  if (o.lowIntegrity) {
    ULONGLONG t0 = GetTickCount64();
    if (o.restrictWrites) {
      HRESULT hr = containerSid(o.restrictWrites, &writeSid);
      if (FAILED(hr)) { setError("DeriveAppContainerSidFromAppContainerName(restrict)", (DWORD)hr); return (int)finish(&o, job, MC_EXIT_SETUP); }
      wchar_t *s = NULL;
      if (ConvertSidToStringSidW(writeSid, &s)) { toUtf8(s, R.sid, sizeof R.sid); LocalFree(s); }
    }
    for (int i = 0; i < o.nWrite; i++) {
      DWORD err = 0;
      int g = labelLow(o.write[i], &err);
      if (g == 0 && writeSid) g = grant(o.write[i], writeSid, FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE, &err);
      char p[400];
      toUtf8(o.write[i], p, sizeof p);
      if (g < 0) {
        snprintf(R.error, sizeof R.error, "labelling %s Low failed (Windows error %lu)", p, (unsigned long)err);
        return (int)finish(&o, job, MC_EXIT_SETUP);
      }
      if (g == 1) {
        size_t used = strlen(R.unprotected);
        snprintf(R.unprotected + used, sizeof R.unprotected - used, "%s%s", used ? ";" : "", p);
      }
    }
    R.grantMs = (DWORD)(GetTickCount64() - t0);
    token = lowToken(writeSid);
    R.writeRestricted = writeSid != NULL;
    if (!token) return (int)finish(&o, job, MC_EXIT_SETUP);
    R.lowIntegrity = 1;
  }

  // 3. Start the engine already inside the job (and the AppContainer), with only its stdio inherited.
  HANDLE std[3] = { GetStdHandle(STD_INPUT_HANDLE), GetStdHandle(STD_OUTPUT_HANDLE), GetStdHandle(STD_ERROR_HANDLE) };
  HANDLE inherit[3];
  DWORD nInherit = 0;
  for (int i = 0; i < 3; i++) {
    if (!std[i] || std[i] == INVALID_HANDLE_VALUE) continue;
    BOOL dup = FALSE;
    for (DWORD k = 0; k < nInherit; k++) dup |= inherit[k] == std[i];
    if (dup) continue;
    SetHandleInformation(std[i], HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    inherit[nInherit++] = std[i];
  }
  DWORD nAttrs = 1 + (nInherit ? 1 : 0) + (o.appContainer ? 1 : 0);
  SIZE_T attrSize = 0;
  InitializeProcThreadAttributeList(NULL, nAttrs, 0, &attrSize);
  LPPROC_THREAD_ATTRIBUTE_LIST attrs = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(GetProcessHeap(), 0, attrSize);
  if (!attrs || !InitializeProcThreadAttributeList(attrs, nAttrs, 0, &attrSize)
      || !UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job, sizeof job, NULL, NULL)
      || (nInherit && !UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit, nInherit * sizeof(HANDLE), NULL, NULL))
      || (o.appContainer && !UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &caps, sizeof caps, NULL, NULL))) {
    setError("process attributes", GetLastError());
    return (int)finish(&o, job, MC_EXIT_SETUP);
  }
  STARTUPINFOEXW si = { 0 };
  si.StartupInfo.cb = sizeof si;
  si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  si.StartupInfo.hStdInput = std[0];
  si.StartupInfo.hStdOutput = std[1];
  si.StartupInfo.hStdError = std[2];
  si.lpAttributeList = attrs;

  size_t cap = 32768, len = 0;
  wchar_t *cmd = (wchar_t *)calloc(cap, sizeof(wchar_t));
  for (int i = o.argStart; i < argc; i++) appendQuoted(cmd, cap, &len, argv[i]);
  if (len + 1 >= cap) { snprintf(R.error, sizeof R.error, "command line too long"); return (int)finish(&o, job, MC_EXIT_SETUP); }

  PROCESS_INFORMATION pi = { 0 };
  DWORD flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
  BOOL started = token
    ? CreateProcessAsUserW(token, argv[o.argStart], cmd, NULL, NULL, nInherit > 0, flags, NULL, o.cwd, &si.StartupInfo, &pi)
    : CreateProcessW(argv[o.argStart], cmd, NULL, NULL, nInherit > 0, flags, NULL, o.cwd, &si.StartupInfo, &pi);
  if (!started) {
    setError("CreateProcess(engine)", GetLastError());
    return (int)finish(&o, job, MC_EXIT_SETUP);
  }
  CloseHandle(pi.hThread);

  // 4. Wait: engine exit, limit messages, parent gone.
  R.outcome = "exited";
  DWORD exitCode = 0;
  BOOL engineDone = FALSE, jobEmpty = FALSE;
  ULONGLONG engineDoneAt = 0;
  for (;;) {
    DWORD msg = 0;
    ULONG_PTR key = 0;
    LPOVERLAPPED ov = NULL;
    while (GetQueuedCompletionStatus(port, &msg, &key, &ov, engineDone ? 50 : 200)) {
      if (msg == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO) jobEmpty = TRUE;
      else if (msg == JOB_OBJECT_MSG_JOB_MEMORY_LIMIT || msg == JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT) {
        if (!strcmp(R.outcome, "exited")) R.outcome = "limit-memory";
        TerminateJobObject(job, MC_EXIT_LIMIT);
      } else if (msg == JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT) {
        if (!strcmp(R.outcome, "exited")) R.outcome = "limit-processes";
        TerminateJobObject(job, MC_EXIT_LIMIT);
      }
    }
    DWORD active = activeProcesses(job);
    if (active > R.peakActive) R.peakActive = active;
    if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) {
      R.outcome = "parent-gone";
      TerminateJobObject(job, MC_EXIT_PARENT);
      WaitForSingleObject(pi.hProcess, 5000);
      return (int)finish(&o, job, MC_EXIT_PARENT);
    }
    if (!engineDone && WaitForSingleObject(pi.hProcess, 0) == WAIT_OBJECT_0) {
      GetExitCodeProcess(pi.hProcess, &exitCode);
      engineDone = TRUE;
      engineDoneAt = GetTickCount64();
    }
    if (engineDone && (jobEmpty || active == 0)) break;
    if (engineDone && GetTickCount64() - engineDoneAt > ORPHAN_GRACE_MS) {
      R.orphansKilled = 1; // the engine left processes behind: they go with the job
      TerminateJobObject(job, exitCode);
      break;
    }
  }
  R.exitCode = exitCode;
  if (strcmp(R.outcome, "exited")) return (int)finish(&o, job, MC_EXIT_LIMIT);
  return (int)finish(&o, job, exitCode);
}
