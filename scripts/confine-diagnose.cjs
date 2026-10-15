// Diagnostics for D2 on Windows: runs each engine and the image worker's runtime through
// morph-confine.exe exactly as Morph does (Confinement.prepare: same arguments, grants and
// environment), in each isolation variant, and prints exit code, the helper's outcome and stderr.
// Use it when engines report "unavailable" or confined runs fail.
//   node scripts/confine-diagnose.cjs [--out confine-diagnose.json] [--strict]
// --strict: exit 1 if a mode the shipped policy uses fails, or a job profile is left behind.
// Variants the policy does not use are reported for information only, and so is the Low-integrity
// tier: launched from a CI step (not from Morph or the tests) its engines fail to start with
// 0xC0000142, while the same tier converts through the real path (test/windows/*.test.cjs).
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
function run(name, { tools = policy.tools, tool, exe, args, env = {}, read = [], shipped = true }) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-diag-'));
  const c = new Confinement({ ownedRoots: [...binRoots(), codeRoot()], tools });
  const launch = c.prepare(tool, exe, args, { workspace: ws, read });
  const t0 = Date.now();
  const r = spawnSync(launch.exe, launch.args, { cwd: launch.cwd, env: { ...launch.env, ...env }, encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = launch.readStats();
  const container = launch.args[launch.args.indexOf('--appcontainer') + 1];
  if (launch.args.includes('--appcontainer') && !s?.profileDeleted) spawnSync(HELPER, ['--delete-profile', container], { stdio: 'ignore' });
  const ok = r.status === 0 && s?.outcome === 'exited';
  const res = { name, shipped, ok, status: r.status, ms: Date.now() - t0, timedOut: !!r.error, stats: s, stdout: (r.stdout || '').trim().slice(-300), stderr: (r.stderr || '').trim().slice(-600) };
  console.log(`${ok ? 'OK  ' : 'FAIL'}${shipped ? '' : ' (not shipped)'} ${name}: status=${r.status} outcome=${s?.outcome} ${s?.error ? `error=${s.error} ` : ''}${!ok && res.stderr ? `stderr=${res.stderr.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
  fs.rmSync(ws, { recursive: true, force: true });
  results.push(res);
}

const engine = (tool, rel, args) => ({ tool, exe: path.join(BIN, rel), args });
const cases = [
  ['ffmpeg -version', engine('ffmpeg', 'ffmpeg/ffmpeg.exe', ['-hide_banner', '-version'])],
  ['pdfinfo -v', engine('pdfinfo', 'poppler/pdfinfo.exe', ['-v'])],
  ['7-Zip banner', engine('sevenzip', '7zip/7z.exe', [])],
  ['soffice --version', engine('soffice', 'libreoffice/program/soffice.com', ['--headless', '--version'])],
  ['ebook-convert --version', engine('calibre', 'calibre/ebook-convert.exe', ['--version'])],
];
for (const [name, c] of cases) {
  if (!fs.existsSync(c.exe)) continue;
  const t = policy.tools[c.tool];
  run(`${name} (${t.isolation}${t.restrictWrites ? ', write-restricted' : ''})`, { ...c, shipped: t.isolation !== 'low-integrity' });
  if (t.isolation === 'low-integrity') {
    const flip = { ...policy.tools, [c.tool]: { ...t, restrictWrites: !t.restrictWrites } };
    run(`${name} (low-integrity${flip[c.tool].restrictWrites ? ', write-restricted' : ''})`, { ...c, tools: flip, shipped: false });
  }
}
const rt = workerRuntime();
if (rt) {
  run('image worker runtime: Electron as node in the AppContainer', { tool: 'imageworker', exe: rt.exe, args: [...(rt.args || []), '-e', 'console.log("node " + process.version)'], env: rt.env, read: workerReadRoots(rt) });
}
const left = spawnSync(HELPER, ['--list-profiles', 'Morph.Job.'], { encoding: 'utf8' }).stdout.trim();
console.log(`job profiles left by the runs above: ${left ? left.split(/\r?\n/).length : 0}`);
results.push({ name: 'job profiles left', left });
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
if (process.argv.includes('--strict') && (results.some((r) => r.shipped && r.ok === false) || left)) process.exit(1);
