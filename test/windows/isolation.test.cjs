// D2 boundaries between jobs, of the image worker, and of the Low-integrity tier, on real Windows
// with real restricted processes (morph-confine.exe, bundled engines, Electron in node mode).
// Run by the "Bundled engines" CI job (MORPH_REQUIRE_PAYLOAD=1: nothing here may skip there).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { makeRichOdt, makeRichEpub, makePdf } = require('../electron/helpers.cjs');
const { createStack } = require('../electron/engineStack.cjs');
const { createWorkspace } = require('../../electron/infra/JobWorkspace.cjs');
const { Confinement } = require('../../electron/infra/Confinement.cjs');
const { binRoots } = require('../../electron/infra/ToolRegistry.cjs');
const { runProcess } = require('../../electron/infra/ProcessRunner.cjs');
const { workerRuntime, workerReadRoots, codeRoot, runInFreshWorker } = require('../../electron/infra/WorkerHost.cjs');
const policy = require('../../electron/domain/confinementPolicy.cjs');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin');
const HELPER = path.join(ROOT, 'native', 'out', 'morph-confine.exe');
const required = process.env.MORPH_REQUIRE_PAYLOAD === '1';
const available = process.platform === 'win32' && fs.existsSync(path.join(BIN, 'libreoffice')) && fs.existsSync(HELPER) && !!workerRuntime();
if (required) assert.ok(available, 'bin/, native/out/morph-confine.exe and the Electron binary are required (MORPH_REQUIRE_PAYLOAD=1)');
const opts = { skip: !available && 'needs Windows, bin/, the built helper and the Electron binary', timeout: 300000 };

const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
const processesOf = (exe) => {
  const p = exe.replace(/'/g, "''");
  const out = ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${p}' -and $_.CommandLine -like '*engineWorker*' } | ForEach-Object { $_.ProcessId }`);
  return out ? out.split(/\r?\n/) : [];
};
async function until(fn, ms = 60000, step = 100) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, step)); }
}
const measurements = [];
const record = (m) => { measurements.push(m); fs.writeFileSync(path.join(process.cwd(), 'isolation-measurements.json'), JSON.stringify(measurements, null, 2)); console.log('MEASURED', JSON.stringify(m)); };

let S;
test.before(async () => { if (!available) return; S = createStack('win-isolation'); await S.tools.probe(); });
test.after(() => S?.stop());
const scratch = (tag) => createWorkspace(`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, { root: path.join(S.root, 'ws') });
const run = (name, args, ws, o = {}) => S.tools.run(name, args, { timeoutMs: 120000, workspace: ws.dir, ...o });

// The worker's process configuration (same runtime, same grants, same AppContainer policy as
// 'imageworker'), running a probe script instead of the worker: what can code in there do?
async function workerProbe(ws, script) {
  const runtime = workerRuntime();
  const launch = S.tools.confinement.prepare('imageworker', runtime.exe, [...(runtime.args || []), '-e', script], { workspace: ws.dir, read: workerReadRoots(runtime) });
  const r = await runProcess(runtime.exe, [], { timeoutMs: 60000, name: 'probe', captureStdout: true, launch: { ...launch, env: { ...launch.env, ...runtime.env } } }).catch((e) => ({ error: e.message, stdout: '' }));
  const line = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('RESULT '));
  return line ? JSON.parse(line.slice(7)) : { failedToRun: r.error || r.stdout };
}

test('the image worker runs confined: probe through the helper, conversions work', opts, async () => {
  assert.equal(S.tools.confinement.mode, 'enforced');
  assert.ok(S.has('images'), `images available through the confined worker: ${JSON.stringify(S.tools.images)}`);
  const sharp = require('sharp');
  const dir = S.dirOf('worker-ok');
  const png = path.join(dir, 'תמונה.png');
  await sharp({ create: { width: 640, height: 480, channels: 3, background: '#0096ff' } }).png().toFile(png);
  const u = await S.convert(png, 'webp');
  assert.equal(u.state, 'completed', u.error);
  assert.equal((await sharp(u.output).metadata()).format, 'webp');
});

test('code in the image worker\'s container: no original, no writes outside its workspace, no network', opts, async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-worker-outside-'));
  const original = path.join(outside, 'original.png');
  fs.writeFileSync(original, 'ORIGINAL');
  let hits = 0;
  const server = http.createServer((q, s) => { hits++; s.end('hi'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = await scratch('worker-probe');
  try {
    const script = `
      const fs = require('fs'); const net = require('net'); const out = {};
      try { fs.readFileSync(${JSON.stringify(original)}); out.readOriginal = 'allowed'; } catch (e) { out.readOriginal = e.code; }
      try { fs.writeFileSync(${JSON.stringify(original)}, 'X'); out.writeOriginal = 'allowed'; } catch (e) { out.writeOriginal = e.code; }
      try { fs.writeFileSync(${JSON.stringify(path.join(outside, 'new.txt'))}, 'X'); out.createOutside = 'allowed'; } catch (e) { out.createOutside = e.code; }
      try { fs.writeFileSync(${JSON.stringify(path.join(ws.dir, 'inside.txt'))}, 'X'); out.writeInside = 'allowed'; } catch (e) { out.writeInside = e.code; }
      try { out.loadSharp = require(${JSON.stringify(require.resolve('sharp'))}).versions.sharp; } catch (e) { out.loadSharp = 'failed: ' + e.message.slice(0, 80); }
      const s = net.connect(${server.address().port}, '127.0.0.1');
      s.on('connect', () => { out.loopback = 'connected'; done(); }); s.on('error', (e) => { out.loopback = e.code; done(); });
      setTimeout(() => { out.loopback = out.loopback || 'timeout'; done(); }, 5000);
      let printed = false; function done() { if (printed) return; printed = true; console.log('RESULT ' + JSON.stringify(out)); process.exit(0); }`;
    const r = await workerProbe(ws, script);
    record({ workerContainer: r, serverHits: hits });
    assert.ok(!r.failedToRun, `the probe ran in the worker's container: ${r.failedToRun}`);
    assert.equal(r.writeInside, 'allowed', 'control: it can write its workspace');
    assert.ok(/^\d/.test(r.loadSharp), `control: sharp (native) loads in the container: ${r.loadSharp}`);
    assert.notEqual(r.readOriginal, 'allowed', 'cannot read the original');
    assert.notEqual(r.writeOriginal, 'allowed', 'cannot write the original');
    assert.notEqual(r.createOutside, 'allowed', 'cannot create files outside its workspace');
    assert.notEqual(r.loopback, 'connected', 'no loopback connection');
    assert.equal(hits, 0);
    assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
    assert.deepEqual(fs.readdirSync(outside), ['original.png']);
  } finally { server.close(); await ws.cleanup(); }
});

test('Stop during an image conversion ends the confined worker; no output; the next one works', opts, async () => {
  const sharp = require('sharp');
  const dir = S.dirOf('worker-cancel');
  const big = path.join(dir, 'big.png');
  // Noise compresses badly: a large AVIF encode keeps the worker busy for seconds.
  const w = 6000; const h = 4000;
  await sharp(require('crypto').randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toFile(big);
  const [d] = await S.intake.detectPaths([big]);
  assert.ok(S.coordinator.enqueue({ fileId: d.id, target: 'avif' }).ok);
  const runtime = workerRuntime();
  const seen = await until(() => (processesOf(runtime.exe).length ? processesOf(runtime.exe) : null), 60000, 100);
  assert.ok(seen, 'the confined worker process was running');
  S.coordinator.cancel(d.id);
  await S.coordinator.whenIdle();
  assert.equal(S.lastUpdate(d.id).state, 'cancelled');
  assert.deepEqual(await until(() => (processesOf(runtime.exe).length === 0 ? [] : null), 10000, 200), [], 'no worker process left');
  assert.deepEqual(fs.readdirSync(dir), ['big.png'], 'no output, no staging');
  const small = path.join(S.dirOf('worker-after'), 'small.png');
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).png().toFile(small);
  const u = await S.convert(small, 'jpg');
  assert.equal(u.state, 'completed', u.error);
});

// The image worker's limit is set from these measurements. They run under a raised limit so the
// true peak is seen (on 05aea5f the provisional 4096 MiB limit stopped the 64 MP case at 4126 MiB,
// cleanly, with limit-memory). The shipped limit must leave 2x headroom over the realistic case.
async function workerPeak(tag, width, height, channels) {
  const sharp = require('sharp');
  const ws = await scratch(`worker-stress-${tag}`);
  try {
    const big = ws.file('big.png');
    const background = channels === 4 ? { r: 10, g: 120, b: 200, alpha: 0.5 } : '#0a78c8';
    await sharp({ create: { width, height, channels, background } }).png().toFile(big);
    const raised = new Confinement({ ownedRoots: [...binRoots(), codeRoot()], limits: { ...policy.limits, imageworker: { jobMemoryMb: 32768, maxProcesses: 8 } } });
    let stats;
    const got = new Promise((r) => { stats = r; });
    await runInFreshWorker({ type: 'image', task: { input: big, ext: 'png', target: 'avif', quality: 'high', out: ws.file('out.avif') } },
      { timeoutMs: 540000, confine: { confinement: raised, workspace: ws.dir }, onStats: stats });
    const s = await got;
    const mib = Math.ceil((s?.peakJobMemory || 0) / 1048576);
    record({ stress: `imageworker-${tag}-avif`, pixels: width * height, channels, peakMiB: mib, shippedLimitMiB: policy.limits.imageworker.jobMemoryMb, processes: s?.totalProcesses });
    assert.ok(mib > 0, 'a real peak was measured (statistics read after the helper closed)');
    return mib;
  } finally { await ws.cleanup(); }
}

test('stress: image worker, 24 MP photo (6000x4000 RGB) to AVIF: shipped limit leaves 2x headroom', opts, async () => {
  const mib = await workerPeak('24mp', 6000, 4000, 3);
  assert.ok(mib * 2 <= policy.limits.imageworker.jobMemoryMb, `${mib} MiB leaves less than 2x headroom under ${policy.limits.imageworker.jobMemoryMb} MiB`);
});

test('stress: image worker, 64 MP RGBA (8000x8000) to AVIF: measured and recorded', opts, async () => {
  await workerPeak('64mp-rgba', 8000, 8000, 4);
});

test('jobs are isolated from each other: an engine in job B cannot read job A\'s live workspace', opts, async () => {
  const A = await scratch('job-a');
  const B = await scratch('job-b');
  try {
    const secret = await makePdf(A.file('a.pdf'), 1, 'job A');
    // Job A's engine is given its workspace (the grant to A's own AppContainer is in place).
    const own = await run('pdfinfo', [secret], A, { captureStdout: true });
    assert.match(own.stdout, /Pages:\s+1/, 'control: job A reads its own file');
    const cross = await run('pdfinfo', [secret], B, { captureStdout: true }).then(() => 'read', (e) => `refused: ${e.message.slice(0, 80)}`);
    // And the image worker's container for job B.
    const probe = await workerProbe(B, `const out = {}; try { require('fs').readFileSync(${JSON.stringify(secret)}); out.read = 'allowed'; } catch (e) { out.read = e.code; } console.log('RESULT ' + JSON.stringify(out));`);
    record({ crossJob: { pdfinfo: cross, imageWorker: probe.read } });
    assert.match(cross, /^refused/, 'job B\'s engine could not read job A\'s file');
    assert.notEqual(probe.read, 'allowed', 'job B\'s image worker could not read job A\'s file');
  } finally { await A.cleanup(); await B.cleanup(); }
});

test('Low-integrity tier: writing into a pre-existing Low folder outside the workspace (measured, both variants)', { ...opts, timeout: 900000 }, async () => {
  const localLow = path.join(process.env.USERPROFILE, 'AppData', 'LocalLow');
  assert.ok(fs.existsSync(localLow), 'LocalLow exists');
  const target = path.join(localLow, `morph-test-${Date.now()}`);
  fs.mkdirSync(target); // inherits LocalLow's Low label
  const results = {};
  try {
    for (const restrictWrites of [false, true]) {
      const tools = { ...policy.tools, calibre: { ...policy.tools.calibre, restrictWrites }, soffice: { ...policy.tools.soffice, restrictWrites } };
      const L = createStack(`win-low-${restrictWrites}`, { confinement: new Confinement({ ownedRoots: [...binRoots(), codeRoot()], tools }) });
      try {
        await L.tools.probe();
        const ws = await createWorkspace(`low-${restrictWrites}-${Date.now()}`, { root: path.join(L.root, 'ws') });
        const epub = makeRichEpub(ws.file('in.epub'));
        const out = path.join(target, `book-${restrictWrites}.txt`);
        const t = restrictWrites ? 45000 : 120000; // the unshipped variant may hang until its deadline (measured)
        await L.tools.run('calibre', [epub, out], { workspace: ws.dir, timeoutMs: t }).catch(() => {});
        const calibreOutside = fs.existsSync(out);
        // Does the conversion itself still work in this variant?
        const inside = await L.tools.run('calibre', [epub, ws.file('ok.txt')], { workspace: ws.dir, timeoutMs: restrictWrites ? 45000 : 300000 }).then(() => fs.existsSync(ws.file('ok.txt')), () => false);
        const odt = L.dirOf('lo-src');
        const doc = makeRichOdt(path.join(odt, 'doc.odt'));
        const lo = await L.convert(doc, 'pdf').then((u) => u.state, (e) => e.message);
        results[restrictWrites ? 'writeRestricted' : 'lowOnly'] = { calibreWroteIntoLocalLow: calibreOutside, calibreConverts: inside, libreofficeConverts: lo, probes: { soffice: L.tools.tools.soffice?.ok, calibre: L.tools.tools.calibre?.ok } };
        await ws.cleanup();
      } finally { L.stop(); }
    }
    record({ lowTier: results });
    // What the shipped policy uses must convert; and with write restriction, LocalLow is refused.
    const shipped = policy.tools.calibre.restrictWrites ? results.writeRestricted : results.lowOnly;
    assert.equal(shipped.calibreConverts, true, 'Calibre converts with the shipped policy');
    assert.equal(shipped.libreofficeConverts, 'completed', 'LibreOffice converts with the shipped policy');
    if (policy.tools.calibre.restrictWrites) assert.equal(shipped.calibreWroteIntoLocalLow, false, 'write-restricted: no writes into other Low folders');
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test('Morph dying during an image conversion takes the confined worker with it', opts, async () => {
  const sharp = require('sharp');
  const root = S.dirOf('worker-parent');
  const big = path.join(root, 'big.png');
  const w = 6000; const h = 4000;
  await sharp(require('crypto').randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toFile(big);
  const child = spawn(process.execPath, [path.join(__dirname, 'confined-child.cjs'), root, big, 'avif'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const runtime = workerRuntime();
  const seen = await until(() => (processesOf(runtime.exe).length ? processesOf(runtime.exe) : null), 120000, 100);
  assert.ok(seen, 'the confined worker started in the child');
  execFileSync('taskkill', ['/pid', String(child.pid), '/F']);
  assert.deepEqual(await until(() => (processesOf(runtime.exe).length === 0 ? [] : null), 15000, 200), [], 'no worker outlived Morph');
});

test('no job AppContainer profile is left behind (helpers ended normally, killed, or cancelled above)', opts, () => {
  const out = execFileSync(HELPER, ['--list-profiles', 'Morph.Job.'], { encoding: 'utf8' }).trim();
  record({ leftoverJobProfiles: out ? out.split(/\r?\n/).length : 0 });
  assert.equal(out, '', `left over: ${out}`);
});

// Pass the measurements file to the evidence (unused binding keeps pathToFileURL for future checks).
void pathToFileURL;
