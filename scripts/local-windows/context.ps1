# Records who and where a local Windows validation run is: Windows build, hardware, the account,
# its token (elevation type, integrity level, Administrators membership) and the Morph checkout.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-windows\context.ps1 -Out ctx.json
# Reads only; changes nothing on the machine. No credentials or file contents are recorded.
param([string]$Out = '', [string]$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MorphToken {
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetTokenInformation(IntPtr t, int cls, IntPtr buf, int len, out int ret);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint i);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static int Int(int cls) {
    IntPtr t; if (!OpenProcessToken(GetCurrentProcess(), 8, out t)) return -1;
    IntPtr b = Marshal.AllocHGlobal(4); int r;
    try { return GetTokenInformation(t, cls, b, 4, out r) ? Marshal.ReadInt32(b) : -1; }
    finally { Marshal.FreeHGlobal(b); CloseHandle(t); }
  }
  // TokenElevationType = 18: 1 default (no split token), 2 full (elevated), 3 limited (filtered)
  public static int ElevationType() { return Int(18); }
  // TokenElevation = 20: nonzero when the token is elevated
  public static int Elevated() { return Int(20); }
  // TokenIntegrityLevel = 25: RID of the mandatory label
  public static int IntegrityRid() {
    IntPtr t; if (!OpenProcessToken(GetCurrentProcess(), 8, out t)) return -1;
    int len; GetTokenInformation(t, 25, IntPtr.Zero, 0, out len);
    IntPtr b = Marshal.AllocHGlobal(len);
    try {
      if (!GetTokenInformation(t, 25, b, len, out len)) return -1;
      IntPtr sid = Marshal.ReadIntPtr(b);
      int n = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(n - 1)));
    } finally { Marshal.FreeHGlobal(b); CloseHandle(t); }
  }
}
'@

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
$groups = whoami /groups /fo csv | ConvertFrom-Csv
$adminGroup = $groups | Where-Object { $_.SID -eq 'S-1-5-32-544' }
$rid = [MorphToken]::IntegrityRid()
$il = switch ($rid) { 0x1000 { 'Low' } 0x2000 { 'Medium' } 0x2100 { 'MediumPlus' } 0x3000 { 'High' } 0x4000 { 'System' } default { "0x{0:X}" -f $rid } }
$et = [MorphToken]::ElevationType()
$inAdmins = $false
try { $inAdmins = [bool](Get-LocalGroupMember -SID S-1-5-32-544 -ErrorAction Stop | Where-Object { $_.SID -eq $id.User }) } catch { $inAdmins = [bool]$adminGroup }

$kind = if ([MorphToken]::Elevated() -ne 0) { 'elevated-administrator' }
        elseif ($inAdmins -or $adminGroup) { 'administrator-unelevated' }
        else { 'standard-user' }

$os = Get-CimInstance Win32_OperatingSystem
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$sysDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
$sha = ''; $dirty = ''
try { Push-Location $Repo; $sha = (git rev-parse HEAD).Trim(); $dirty = (git status --porcelain | Measure-Object).Count; Pop-Location } catch {}

$ctx = [ordered]@{
  recordedAt = (Get-Date).ToString('o')
  windows = [ordered]@{ caption = $os.Caption; version = $os.Version; displayVersion = $cv.DisplayVersion; build = "$($cv.CurrentBuild).$($cv.UBR)"; architecture = $os.OSArchitecture; processArch = $env:PROCESSOR_ARCHITECTURE }
  hardware = [ordered]@{ ramTotalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1); ramFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1); systemDriveFreeGB = [math]::Round($sysDrive.FreeSpace / 1GB, 1); logicalProcessors = [Environment]::ProcessorCount }
  account = [ordered]@{
    name = $id.Name
    kind = $kind
    memberOfAdministrators = [bool]($inAdmins -or $adminGroup)
    administratorsInToken = if ($adminGroup) { $adminGroup.Attributes } else { 'absent' }
    tokenElevationType = @{ 1 = 'default'; 2 = 'full'; 3 = 'limited' }[$et]
    tokenElevated = ([MorphToken]::Elevated() -ne 0)
    integrityLevel = $il
    isInRoleAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  }
  repo = [ordered]@{ path = $Repo; sha = $sha; changedFiles = $dirty }
  node = (node --version 2>$null)
}
$json = $ctx | ConvertTo-Json -Depth 5
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding($false))) }
$json
