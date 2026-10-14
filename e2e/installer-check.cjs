// Installer check on Windows (CI or a clean VM): install the previous release silently, give it
// settings and history in its own (version 0) format, install the new build over it, then run the
// packaged smoke test against the installed copy, and uninstall silently.
//
//   node e2e/installer-check.cjs <old-setup.exe> <new-setup.exe> --new-version <v> [--report <file>]
//
// What this does not cover: the in-app auto-update (download + quitAndInstall) from a published
// GitHub release feed, which needs a real release; see docs/TESTING.md.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [oldSetup, newSetup] = process.argv.slice(2);
const opt = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const newVersion = opt('--new-version');
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Morph');
const exe = path.join(installDir, 'Morph.exe');
const userData = path.join(process.env.APPDATA, 'Morph');

function displayVersion() {
  const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Morph', '/d'], { encoding: 'utf8' });
  const block = (r.stdout || '').split(/\r?\n\r?\n/).find((b) => /DisplayName\s+REG_SZ\s+Morph/.test(b)) || '';
  return (block.match(/DisplayVersion\s+REG_SZ\s+(\S+)/) || [])[1] || null;
}

function install(setup) {
  const r = spawnSync(setup, ['/S'], { stdio: 'inherit', windowsHide: true });
  return r.status;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows only');
  for (const f of [oldSetup, newSetup]) if (!f || !fs.existsSync(f)) throw new Error(`setup not found: ${f}`);

  // 1. The previous release, installed silently (per user, no UAC).
  check('previous release installs silently', install(oldSetup) === 0 && fs.existsSync(exe), installDir);
  const oldVersion = displayVersion();
  check('previous version registered', oldVersion, oldVersion);

  // 2. Its settings and history in the version-0 format Morph <= 1.0.3 wrote.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-upgrade-out-'));
  const done = path.join(outDir, 'old-output.webp');
  fs.writeFileSync(done, 'kept');
  fs.mkdirSync(userData, { recursive: true });
  const settings = { outputMode: 'folder', folder: outDir, quality: 'small', maxHeight: 720 };
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(userData, 'history.json'), JSON.stringify([
    { name: 'old.png', from: 'png', to: 'webp', output: done, convertedAt: '2026-01-02T03:04:05.000Z' },
    { name: 'gone.mp4', from: 'mp4', to: 'mp3', output: path.join(outDir, 'gone.mp3'), convertedAt: '2026-01-01T00:00:00.000Z' },
  ], null, 2));

  // 3. The new build over it.
  check('new build installs silently over the previous one', install(newSetup) === 0 && fs.existsSync(exe));
  const v = displayVersion();
  check('new version registered', v === newVersion, `${oldVersion} -> ${v}`);

  // 4. The installed copy works, with the user's settings and history carried over.
  const smoke = spawnSync(process.execPath, [path.join(__dirname, 'packaged-smoke.cjs'), exe,
    '--appdata', process.env.APPDATA, '--expect-version', newVersion,
    '--expect-settings', JSON.stringify(settings), '--expect-history', '2',
    '--report', path.join(os.tmpdir(), 'morph-installed-smoke.json')], { encoding: 'utf8' });
  process.stdout.write(smoke.stdout || '');
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'morph-installed-smoke.json'), 'utf8')); } catch { /* reported below */ }
  check('installed app passes the packaged smoke test (settings, history, all engines)', smoke.status === 0, report ? `${report.passed} passed, ${report.failed} failed` : smoke.stderr);
  const history = JSON.parse(fs.readFileSync(path.join(userData, 'history.json'), 'utf8'));
  check('history migrated to the versioned format, old entries kept', history.version === 1 && history.entries.some((e) => e.name === 'old.png'), { version: history.version, n: history.entries?.length });

  // 5. Silent uninstall: the program goes, the user's data stays.
  const uninstaller = path.join(installDir, 'Uninstall Morph.exe');
  spawnSync(uninstaller, ['/S'], { stdio: 'inherit' });
  for (let i = 0; i < 120 && fs.existsSync(exe); i++) await wait(500); // the uninstaller re-launches itself from %TEMP%
  check('uninstall removes the program', !fs.existsSync(exe));
  check('uninstall keeps settings and history', fs.existsSync(path.join(userData, 'settings.json')) && fs.existsSync(path.join(userData, 'history.json')));
  check('uninstall removes the registration', displayVersion() === null);
}

main().catch((e) => check('installer run', false, e.stack)).finally(() => {
  const failed = checks.filter((c) => !c.ok);
  const report = { passed: checks.length - failed.length, failed: failed.length, checks };
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
});
