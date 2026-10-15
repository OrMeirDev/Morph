// Diagnostics for D2 on Windows: runs each engine and the image worker's runtime through
// morph-confine.exe exactly as Morph does (Confinement.prepare: same arguments, grants and
// environment), in each isolation variant, and prints exit code, the helper's outcome and stderr.
// Use it when engines report "unavailable" or confined runs fail.
//   node scripts/confine-diagnose.cjs [--out confine-diagnose.json] [--strict]
// --strict: exit 1 if a mode the shipped policy uses fails, or a job profile is left behind.
// Variants the policy does not use are reported for information only. CI runs this from PowerShell
// on purpose: there the engines share a service's window station, the context in which Low-integrity
// engines once failed with 0xC0000142 (now each gets a private window station and desktop).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Confinement } = require('../electron/infra/Confinement.cjs');
const { binRoots } = require('../electron/infra/ToolRegistry.cjs');
const { workerRuntime, workerReadRoots, codeRoot } = require('../electron/infra/WorkerHost.cjs');
const policy = require('../electron/domain/confinementPolicy.cjs');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'native', 'out', 'morph-confine.exe');
const BIN = path.join(ROOT, 'bin');
const outFile = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();
if (process.platform !== 'win32' || !fs.existsSync(HELPER)) { console.log('needs Windows and native/out/morph-confine.exe'); process.exit(0); }

const results = [];
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
function run(name, { tools = policy.tools, tool, exe, args, env = {}, read = [], shipped = true, input = null, expect = null, flags = [], viaBash = false, timeoutMs = 120000 }) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-diag-'));
  const c = new Confinement({ ownedRoots: [...binRoots(), codeRoot()], tools });
  // args may depend on the workspace (a real conversion writes its output there).
  const launch = c.prepare(tool, exe, typeof args === 'function' ? args(ws) : args, { workspace: ws, read });
  if (flags.length) launch.args.splice(launch.args.indexOf('--'), 0, ...flags);
  const t0 = Date.now();
  // viaBash: the same call started through Git Bash (whose runtime gives descendants a console of
  // its own), to compare with the direct start from this (PowerShell) step.
  const [file, argv] = viaBash ? [BASH, ['-c', '"$0" "$@"', launch.exe, ...launch.args]] : [launch.exe, launch.args];
  const r = spawnSync(file, argv, { cwd: launch.cwd, env: { ...launch.env, ...env, ...(viaBash ? { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' } : {}) }, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], input: input || undefined });
  const s = launch.readStats();
  const container = launch.args[launch.args.indexOf('--appcontainer') + 1];
  if (launch.args.includes('--appcontainer') && !s?.profileDeleted) spawnSync(HELPER, ['--delete-profile', container], { stdio: 'ignore' });
  const ok = r.status === 0 && s?.outcome === 'exited' && (!expect || expect.test(r.stdout || ''));
  const res = { name, shipped, ok, status: r.status, ms: Date.now() - t0, timedOut: !!r.error, stats: s, stdout: (r.stdout || '').trim().slice(-300), stderr: (r.stderr || '').trim().slice(-600) };
  console.log(`${ok ? 'OK  ' : 'FAIL'}${shipped ? '' : ' (not shipped)'} ${name}: status=${r.status} outcome=${s?.outcome} ${s?.privateDesktop ? 'privateDesktop ' : ''}${s?.totalProcesses != null ? `processes=${s.totalProcesses} ` : ''}${s?.error ? `error=${s.error} ` : ''}${!ok && res.stderr ? `stderr=${res.stderr.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
  // A timed-out engine may still be dying (kill-on-close): retry, and never let cleanup end the run.
  try { fs.rmSync(ws, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* left in TEMP */ }
  results.push(res);
}

const engine = (tool, rel, args) => ({ tool, exe: path.join(BIN, rel), args });
const cases = [
  ['ffmpeg -version', engine('ffmpeg', 'ffmpeg/ffmpeg.exe', ['-hide_banner', '-version'])],
  ['pdfinfo -v', engine('pdfinfo', 'poppler/pdfinfo.exe', ['-v'])],
  ['7-Zip banner', engine('sevenzip', '7zip/7z.exe', [])],
  ['soffice --version', engine('soffice', 'libreoffice/program/soffice.com', ['--headless', '--version'])],
  ['ebook-convert --version', engine('calibre', 'calibre/ebook-convert.exe', ['--version'])],
  // A real conversion too: Calibre starts a worker and talks to it over a pipe, which --version
  // never does (WinError 5 in the packaged app while --version passed, run 38734059687).
  ['ebook-convert EPUB -> MOBI', { ...engine('calibre', 'calibre/ebook-convert.exe', []),
    args: (ws) => [path.join(ROOT, 'test', 'corpus', 'gutenberg-11-alice.epub'), path.join(ws, 'out.mobi')] }],
];
for (const [name, c] of cases) {
  if (!fs.existsSync(c.exe)) continue;
  const t = policy.tools[c.tool];
  run(`${name} (${t.isolation}${t.restrictWrites ? ', write-restricted' : ''})`, c);
  if (t.isolation === 'low-integrity') {
    const flip = { ...policy.tools, [c.tool]: { ...t, restrictWrites: !t.restrictWrites } };
    run(`${name} (low-integrity${flip[c.tool].restrictWrites ? ', write-restricted' : ''})`, { ...c, tools: flip, shipped: false });
  }
}
// Low-integrity variants (information, measured to choose the shipped policy): real conversions
// and read canaries, each with the token Low only / write-restricted / read-restricted (every
// access restricted: the engine may read system files and its own folder, not the user's files)
// and with a new console or the helper's. cmd.exe reads the canaries: a file in the user profile
// (only the user, SYSTEM and Administrators may read it) and C:\\Windows\\win.ini (Users may).
const SYS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const canary = path.join(os.homedir(), `morph-canary-${process.pid}.txt`);
fs.writeFileSync(canary, 'CANARY-SECRET');
const variantCases = [
  ['read user-profile canary', { tool: 'soffice', exe: path.join(SYS, 'cmd.exe'), args: ['/c', 'type', canary] }, /CANARY-SECRET/],
  ['read C:\\Windows\\win.ini', { tool: 'soffice', exe: path.join(SYS, 'cmd.exe'), args: ['/c', 'type', path.join(process.env.SystemRoot || 'C:\\Windows', 'win.ini')] }, /fonts/i],
  ['LibreOffice DOCX -> PDF', { ...engine('soffice', 'libreoffice/program/soffice.com', []),
    args: (ws) => ['--headless', '--norestore', `-env:UserInstallation=${require('url').pathToFileURL(path.join(ws, 'profile')).href}`, '--convert-to', 'pdf', '--outdir', ws, path.join(ROOT, 'test', 'corpus', 'benyehuda-5452-ani-maamin.docx')] }, null],
  ['Calibre EPUB -> MOBI', { ...engine('calibre', 'calibre/ebook-convert.exe', []),
    args: (ws) => [path.join(ROOT, 'test', 'corpus', 'gutenberg-11-alice.epub'), path.join(ws, 'out.mobi')] }, null],
];
for (const [name, c, expect] of variantCases) {
  if (!fs.existsSync(c.exe)) continue;
  for (const [label, extra] of [['Low only', {}], ['write-restricted', { restrictWrites: true }], ['read-restricted', { restrictReads: true }]]) {
    for (const consoleMode of ['new', 'inherit']) {
      const tools = { ...policy.tools, [c.tool]: { ...policy.tools[c.tool], restrictWrites: false, restrictReads: false, ...extra, console: consoleMode } };
      run(`variant: ${name} (${label}, console ${consoleMode})`, { ...c, tools, expect, shipped: false, timeoutMs: expect ? 30000 : 120000 });
    }
  }
}
fs.rmSync(canary, { force: true });
// LibreOffice in an AppContainer (no network at all), re-measured after the start-up fixes above:
// its first profile start never returned there (run 38680593398).
{
  const [name, c] = variantCases[2];
  if (fs.existsSync(c.exe)) run(`variant: ${name} (AppContainer)`, { ...c, tools: { ...policy.tools, soffice: { isolation: 'appcontainer' } }, shipped: false, timeoutMs: 120000 });
}
const rt = workerRuntime();
if (rt) {
  run('image worker runtime: Electron as node in the AppContainer', { tool: 'imageworker', exe: rt.exe, args: [...(rt.args || []), '-e', 'console.log("node " + process.version)'], env: rt.env, read: workerReadRoots(rt) });
  // The real worker script answering a probe (loads sharp in the container), as the app runs it.
  const worker = path.join(ROOT, 'electron', 'workers', 'engineWorker.cjs');
  run('image worker: probe request through the real worker (sharp loads in the AppContainer)', { tool: 'imageworker', exe: rt.exe, args: [...(rt.args || []), worker],
    env: { ...rt.env, MORPH_WORKER_STDIO: '1' }, read: workerReadRoots(rt), input: `${JSON.stringify({ id: 1, type: 'probe' })}\n`, expect: /"ok":true[^\n]*"sharp":"\d/ });
}
const left = spawnSync(HELPER, ['--list-profiles', 'Morph.Job.'], { encoding: 'utf8' }).stdout.trim();
console.log(`job profiles left by the runs above: ${left ? left.split(/\r?\n/).length : 0}`);
results.push({ name: 'job profiles left', left });
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
if (process.argv.includes('--strict') && (results.some((r) => r.shipped && r.ok === false) || left)) process.exit(1);
