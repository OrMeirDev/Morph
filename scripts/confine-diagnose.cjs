// Diagnostics for D2 on Windows: runs morph-confine.exe directly with each isolation mode Morph
// uses and prints the exit code, the helper's statistics and stderr for each. Use it when engines
// report "unavailable" or confined runs fail; CI runs it before the tests (output in the evidence).
//   node scripts/confine-diagnose.cjs [--out confine-diagnose.json] [--strict]
// --strict: exit 1 if any mode fails or a profile is left behind (CI: fail in minutes, not hours).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'native', 'out', 'morph-confine.exe');
const BIN = path.join(ROOT, 'bin');
const outFile = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();

function electronExe() { try { const e = require('electron'); return typeof e === 'string' && fs.existsSync(e) ? e : null; } catch { return null; } }

function run(name, helperArgs, exe, args, env = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-diag-'));
  fs.mkdirSync(path.join(ws, 'tmp'));
  const stats = path.join(os.tmpdir(), `morph-diag-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const t0 = Date.now();
  const r = spawnSync(HELPER, [...helperArgs(ws), '--write', ws, '--parent', String(process.pid), '--stats', stats, '--cwd', ws, '--', exe, ...args],
    // Launched the way ProcessRunner launches engines (hidden, no stdin).
    { encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TEMP: path.join(ws, 'tmp'), TMP: path.join(ws, 'tmp'), ...env } });
  let s = null;
  try { s = JSON.parse(fs.readFileSync(stats, 'utf8')); } catch { /* none */ }
  const res = { name, status: r.status, ms: Date.now() - t0, timedOut: !!r.error && /ETIMEDOUT/.test(String(r.error)), stats: s,
    stdout: (r.stdout || '').trim().slice(-300), stderr: (r.stderr || '').trim().slice(-600) };
  console.log(`${r.status === 0 ? 'OK  ' : 'FAIL'} ${name}: status=${r.status} outcome=${s?.outcome} error=${s?.error || ''} ${res.stderr ? `stderr=${res.stderr.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
  fs.rmSync(ws, { recursive: true, force: true });
  return res;
}

const results = [];
if (process.platform !== 'win32' || !fs.existsSync(HELPER)) {
  console.log('needs Windows and native/out/morph-confine.exe');
  process.exit(0);
}
const ffmpeg = path.join(BIN, 'ffmpeg', 'ffmpeg.exe');
const soffice = path.join(BIN, 'libreoffice', 'program', 'soffice.com');
const ec = path.join(BIN, 'calibre', 'ebook-convert.exe');
const cmd = 'C:\\Windows\\System32\\cmd.exe';
const id = `diag${Date.now().toString(36)}`;
const cases = [
  ['job only, cmd /c ver', () => [], cmd, ['/d', '/c', 'ver']],
  ['AppContainer, profile created and deleted (--ephemeral), cmd /c ver', () => ['--appcontainer', `Morph.Diag.${id}`, '--ephemeral'], cmd, ['/d', '/c', 'ver']],
  ['AppContainer + capability, cmd /c ver', () => ['--appcontainer', `Morph.Diag.${id}b`, '--ephemeral', '--capability', 'morph.engines.read'], cmd, ['/d', '/c', 'ver']],
  ...(fs.existsSync(ffmpeg) ? [
    ['AppContainer, ffmpeg -version, read granted to the container', () => ['--appcontainer', `Morph.Diag.${id}c`, '--ephemeral', '--read', path.dirname(ffmpeg)], ffmpeg, ['-hide_banner', '-version']],
    ['AppContainer + capability, ffmpeg -version, read granted to the capability', () => ['--appcontainer', `Morph.Diag.${id}d`, '--ephemeral', '--capability', 'morph.engines.read', '--read', path.dirname(ffmpeg)], ffmpeg, ['-hide_banner', '-version']],
  ] : []),
  ...(fs.existsSync(soffice) ? [
    ['Low integrity, soffice --version', () => ['--low-integrity'], soffice, ['--headless', '--version']],
    ['Low integrity + write-restricted, soffice --version', () => ['--low-integrity', '--restrict-writes', `Morph.Diag.${id}e`], soffice, ['--headless', '--version']],
  ] : []),
  ...(fs.existsSync(ec) ? [
    ['Low integrity, ebook-convert --version', () => ['--low-integrity'], ec, ['--version']],
    ['Low integrity + write-restricted, ebook-convert --version', () => ['--low-integrity', '--restrict-writes', `Morph.Diag.${id}f`], ec, ['--version']],
  ] : []),
];
const electron = electronExe();
if (electron) {
  cases.push(['AppContainer + capability, Electron as node: console.log', () => ['--appcontainer', `Morph.Diag.${id}g`, '--ephemeral', '--capability', 'morph.engines.read', '--read', ROOT],
    electron, ['-e', 'console.log("node " + process.version)'], { ELECTRON_RUN_AS_NODE: '1' }]);
}
for (const [name, h, exe, args, env] of cases) results.push(run(name, h, exe, args, env));
const left = spawnSync(HELPER, ['--list-profiles', 'Morph.Diag.'], { encoding: 'utf8' }).stdout.trim();
console.log(`profiles left by the runs above: ${left ? left.split(/\r?\n/).length : 0}`);
results.push({ name: 'profiles left', left });
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
if (process.argv.includes('--strict') && (results.some((r) => r.status !== undefined && r.status !== 0) || left)) process.exit(1);
