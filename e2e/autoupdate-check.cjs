// The in-app auto-update, end to end, on Windows: the real electron-updater in an installed Morph
// checks a local update feed, downloads the new installer, and installs it with quitAndInstall while
// a LibreOffice conversion is running. Nothing is published: both builds point at a generic feed on
// 127.0.0.1 (e2e/update-feed.builder.cjs). This is separate from e2e/installer-check.cjs, which runs
// installers by hand.
//
//   node e2e/autoupdate-check.cjs <old-setup.exe> <feed-dir> --old-version <a> --new-version <b>
//        --port <feed port> [--report <file>]
//
// <feed-dir> holds the new installer, its .blockmap and latest.yml exactly as electron-builder wrote
// them. Checks: update found and downloaded through the app's own API; Stop policy on update (the
// running conversion is cancelled and cleaned up: no output, no staging, no LibreOffice process
// left, crash journal empty); the new version is installed and registered; the app restarts by
// itself; settings and history survive; conversions work after the restart (packaged smoke).
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { findPage, connect, wait } = require('./cdp.cjs');

const [oldSetup, feedDir] = process.argv.slice(2);
const opt = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const oldVersion = opt('--old-version');
const newVersion = opt('--new-version');
const port = Number(opt('--port') || 8765);
const CDP_PORT = 9341;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); };

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Morph');
const exe = path.join(installDir, 'Morph.exe');
const userData = path.join(process.env.APPDATA, 'Morph');

function displayVersion() {
  const ps = "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | "
    + "Where-Object { $_.DisplayName -like 'Morph*' } | Select-Object -First 1 -ExpandProperty DisplayVersion";
  return (spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).stdout || '').trim() || null;
}
function processesUnder(dir) {
  const d = dir.replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${d}', 'OrdinalIgnoreCase') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  return out ? out.split(/\r?\n/) : [];
}
async function until(fn, ms, step = 500) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(step); }
}

// The update feed: serves feedDir as files, logs every request (the evidence the app used it).
function serveFeed() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    requests.push(`${req.method} /${name}${req.headers.range ? ` (${req.headers.range})` : ''}`);
    const file = path.join(feedDir, name);
    if (!name || name.includes('..') || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size;
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, requests })));
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows only');
  if (!fs.existsSync(path.join(feedDir, 'latest.yml'))) throw new Error(`no latest.yml in ${feedDir}`);
  const latest = fs.readFileSync(path.join(feedDir, 'latest.yml'), 'utf8');
  check('feed offers the new version', latest.includes(`version: ${newVersion}`), latest.split('\n')[0]);
  const feed = await serveFeed();

  // 1. The old build, installed, with user settings (v1 written by the app itself later) and history.
  check('old build installs silently', spawnSync(oldSetup, ['/S'], { stdio: 'inherit' }).status === 0 && fs.existsSync(exe));
  check('old version registered', displayVersion() === oldVersion, displayVersion());
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-update-out-'));
  fs.mkdirSync(userData, { recursive: true });
  const settings = { outputMode: 'folder', folder: outDir, quality: 'medium', maxHeight: 1080 };
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(userData, 'history.json'), JSON.stringify([{ name: 'before-update.png', from: 'png', to: 'jpg', output: path.join(outDir, 'before-update.jpg'), convertedAt: '2026-02-03T04:05:06.000Z' }]));

  // 2. Run it and drive the update through the page's own API (what the update banner calls).
  const app = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`], { stdio: 'ignore', detached: true });
  app.unref();
  const page = await findPage(CDP_PORT, { timeoutMs: 90000 });
  check('old build runs', page, page?.url);
  if (!page) return;
  const c = await connect(page.webSocketDebuggerUrl);
  check('running version before the update', (await c.evaluate('window.morph.appVersion()')) === oldVersion);
  await c.evaluate(`window.__updates = []; window.morph.onAppUpdate((s) => window.__updates.push(s)); true`);
  const found = await c.evaluate('window.morph.checkAppUpdate()');
  const available = await until(() => c.evaluate(`window.__updates.find((s) => s.state === 'available') || null`), 120000);
  check('update found on the feed', found && available?.version === newVersion, available);
  await c.evaluate('window.morph.downloadAppUpdate()');
  const ready = await until(() => c.evaluate(`window.__updates.find((s) => s.state === 'ready' || s.state === 'error') || null`), 900000, 2000);
  check('update downloaded and verified by electron-updater', ready?.state === 'ready' && ready.version === newVersion, ready);
  if (ready?.state !== 'ready') return;

  // 3. A long LibreOffice conversion is running when the user presses "restart to update".
  const { makeBigOdt } = require('../test/electron/helpers.cjs');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-update-work-'));
  const big = makeBigOdt(path.join(workDir, 'during-update.odt'), 40000);
  const fileId = await c.evaluate(`window.morph.detect([${JSON.stringify(big)}]).then((d) => d[0].id)`);
  await c.evaluate(`window.__jobs = []; window.morph.onJobUpdate((u) => window.__jobs.push(u.state)); window.morph.enqueue(${JSON.stringify(fileId)}, 'pdf')`);
  const loBin = path.join(installDir, 'resources', 'bin', 'libreoffice');
  const busy = await until(() => (processesUnder(loBin).some((p) => /soffice\.bin/i.test(p)) ? processesUnder(loBin) : null), 120000, 200);
  check('a LibreOffice conversion is running at update time', busy, busy);
  const installCall = c.evaluate('window.morph.installAppUpdate()').catch((e) => e.message); // the app quits during the call
  const jobStates = await until(() => c.evaluate('window.__jobs.slice()').then((j) => (j.includes('cancelled') ? j : null)).catch(() => null), 30000, 200);
  check('the running conversion is cancelled before the app quits', jobStates?.includes('cancelled'), jobStates);
  await installCall;
  c.close();

  // 4. The installer runs silently, then the app starts again by itself.
  const updated = await until(() => (displayVersion() === newVersion ? newVersion : null), 900000, 3000);
  check('new version installed and registered by the update', updated === newVersion, displayVersion());
  const relaunched = await until(() => (processesUnder(installDir).some((p) => /Morph\.exe/i.test(p)) ? true : null), 180000, 2000);
  check('the app restarted by itself after updating', relaunched);
  check('the update fetched the installer from the local feed', feed.requests.some((r) => r.includes(`Morph-Setup-${newVersion}.exe`)), feed.requests);
  // Settings send outputs to outDir; look there and next to the source.
  const leftovers = [...fs.readdirSync(workDir).filter((n) => n !== 'during-update.odt'),
    ...fs.readdirSync(outDir).filter((n) => n.startsWith('during-update') || n.startsWith('.~morph-'))];
  check('no output or staging from the cancelled conversion', leftovers.length === 0, leftovers);
  check('no LibreOffice process left behind', processesUnder(loBin).length === 0, processesUnder(loBin));
  const journal = JSON.parse(fs.readFileSync(path.join(userData, 'jobs.json'), 'utf8'));
  check('crash journal empty after the update', Object.keys(journal.active || {}).length === 0, journal);

  // 5. Close the relaunched copy, then check the updated install: version, settings, history, engines.
  try { execFileSync('taskkill', ['/IM', 'Morph.exe', '/T', '/F'], { stdio: 'ignore' }); } catch { /* none */ }
  await wait(3000);
  const report = path.join(os.tmpdir(), 'morph-updated-smoke.json');
  const smoke = spawnSync(process.execPath, [path.join(__dirname, 'packaged-smoke.cjs'), exe, '--appdata', process.env.APPDATA,
    '--expect-version', newVersion, '--expect-settings', JSON.stringify(settings), '--expect-history', '1', '--report', report], { encoding: 'utf8' });
  process.stdout.write(smoke.stdout || '');
  const r = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null;
  check('updated app: version, settings, history and every engine (packaged smoke)', smoke.status === 0, r ? `${r.passed} passed, ${r.failed} failed` : smoke.stderr);
  const history = JSON.parse(fs.readFileSync(path.join(userData, 'history.json'), 'utf8'));
  check('history kept and in the versioned format', history.version === 1 && history.entries.some((e) => e.name === 'before-update.png'));

  spawnSync(path.join(installDir, 'Uninstall Morph.exe'), ['/S'], { stdio: 'inherit' });
  await until(() => !fs.existsSync(exe), 60000);
  feed.server.close();
}

main().catch((e) => check('auto-update run', false, e.stack)).finally(() => {
  const failed = checks.filter((x) => !x.ok);
  const report = { passed: checks.length - failed.length, failed: failed.length, checks };
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
});
