// The confined image worker's lifecycle (infra/WorkerHost.cjs runInFreshWorker), on any host, with
// a portable stand-in for morph-confine.exe (fixtures/fake-confine.cjs) that, like the real helper,
// writes its statistics only while exiting. What Windows itself enforces is covered by
// test/windows/isolation.test.cjs; this is about when the host may call a conversion done.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runInFreshWorker } = require('../../electron/infra/WorkerHost.cjs');
const { createStack } = require('./engineStack.cjs');
const { tmpDir } = require('./helpers.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-confine.cjs');
const runtime = { exe: process.execPath, args: [], env: {} };
let sharp = null;
try { sharp = require('sharp'); } catch { /* checked per test */ }
const needsSharp = { skip: !sharp && 'sharp not installed', timeout: 120000 };

function fakeConfinement(env = {}) {
  return {
    mode: 'enforced',
    prepare(tool, exe, args, { workspace }) {
      const stats = path.join(os.tmpdir(), `fake-confine-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
      return {
        exe: process.execPath,
        args: [FIXTURE, '--stats', stats, '--cwd', workspace, '--', exe, ...args],
        cwd: workspace,
        env: { ...process.env, ...env },
        confined: true,
        readStats: () => { try { const s = JSON.parse(fs.readFileSync(stats, 'utf8')); fs.rmSync(stats); return s; } catch { return null; } },
      };
    },
  };
}
// Running = the same process still exists. Elsewhere: exists and is not a zombie (a killed process
// whose parent died waits to be reaped by PID 1, which in some containers never happens; it runs
// no code). On Windows a PID is reused quickly, so the PID alone proves nothing (run 38760399959:
// "alive" PID 3228 with no readable command line): the process must also be node.exe and have
// started when the fixture recorded it.
const alive = ({ pid, startMs }) => {
  if (process.platform === 'win32') {
    let out = '';
    try {
      out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { '{0}|{1}' -f ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds(), $p.Path }`], { encoding: 'utf8' }).trim();
    } catch { return false; }
    if (!out) return false;
    const [t, exe] = out.split('|');
    return Math.abs(Number(t) - startMs) < 2000 && path.resolve(exe || '.').toLowerCase() === process.execPath.toLowerCase();
  }
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
// { helper: { pid, startMs }, engine: { pid, startMs } }
const pidsFrom = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => l.trim().split(' ')).map(([k, pid, startMs]) => [k, { pid: Number(pid), startMs: Number(startMs) }]));

async function smallPng(dir) {
  const f = path.join(dir, 'in.png');
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#0096ff' } }).png().toFile(f);
  return f;
}
const task = (dir, input) => ({ type: 'image', task: { input, ext: 'png', target: 'webp', quality: 'high', out: path.join(dir, 'out.webp') } });

test('the liveness check sees a running process and not the same PID after it ended', async () => {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, ['-e', 'console.log(Math.round(Date.now() - process.uptime() * 1000)); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const startMs = Number(await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim()))));
  const p = { pid: child.pid, startMs };
  try {
    assert.equal(alive(p), true, 'running');
    if (process.platform === 'win32') assert.equal(alive({ ...p, startMs: startMs - 60000 }), false, 'a different start time is a different process');
  } finally {
    await new Promise((r) => { child.once('exit', r); child.kill(); });
  }
  assert.equal(alive(p), false, 'ended');
});

test('normal completion returns the helper\'s real statistics, before success is reported', needsSharp, async () => {
  const ws = tmpDir('life-ok');
  const input = await smallPng(ws);
  let stats = null;
  const result = await runInFreshWorker(task(ws, input), { timeoutMs: 60000, confine: { confinement: fakeConfinement(), workspace: ws, runtime }, onStats: (s) => { stats = s; } });
  assert.equal(result, path.join(ws, 'out.webp'));
  assert.ok(stats, 'statistics were read before the promise resolved');
  assert.equal(stats.fake, true);
  assert.equal(stats.peakJobMemory, 123 * 1048576, 'the values the helper wrote, not a placeholder');
});

test('success cannot resolve while the helper is still alive', needsSharp, async () => {
  const ws = tmpDir('life-linger');
  const input = await smallPng(ws);
  const pids = path.join(ws, 'pids.txt');
  const t0 = Date.now();
  await runInFreshWorker(task(ws, input), { timeoutMs: 60000, confine: { confinement: fakeConfinement({ FAKE_CONFINE_LINGER_MS: '1500', FAKE_CONFINE_PIDS: pids }), workspace: ws, runtime } });
  const { helper, engine } = pidsFrom(pids);
  assert.ok(Date.now() - t0 >= 1500, 'waited for the helper, which lingered 1.5 s after the worker exited');
  assert.equal(alive(helper), false, 'helper gone when success was reported');
  assert.equal(alive(engine), false, 'worker gone when success was reported');
});

test('a failed final helper outcome overrides an earlier successful reply', needsSharp, async () => {
  const ws = tmpDir('life-limit');
  const input = await smallPng(ws);
  let stats = null;
  await assert.rejects(
    runInFreshWorker(task(ws, input), { timeoutMs: 60000, confine: { confinement: fakeConfinement({ FAKE_CONFINE_OUTCOME: 'limit-memory' }), workspace: ws, runtime }, onStats: (s) => { stats = s; } }),
    (e) => e.code === 'limit-memory',
  );
  assert.equal(stats.outcome, 'limit-memory');
});

test('a helper that does not exit after the reply is killed at the deadline and the call fails', needsSharp, async () => {
  const ws = tmpDir('life-stuck');
  const input = await smallPng(ws);
  const pids = path.join(ws, 'pids.txt');
  await assert.rejects(
    runInFreshWorker(task(ws, input), { timeoutMs: 60000, shutdownMs: 500, confine: { confinement: fakeConfinement({ FAKE_CONFINE_LINGER_MS: '60000', FAKE_CONFINE_PIDS: pids }), workspace: ws, runtime } }),
    (e) => e.code === 'worker-shutdown-timeout',
  );
  assert.equal(alive(pidsFrom(pids).helper), false, 'the stuck helper was killed before the call returned');
});

test('cancellation leaves no worker, no staging and no published output', { ...needsSharp, timeout: 180000 }, async () => {
  const S = createStack('life-cancel');
  try {
    await S.tools.probe();
    const pids = path.join(S.root, 'pids.txt');
    const confinement = fakeConfinement({ FAKE_CONFINE_PIDS: pids });
    S.coordinator.runWorker = (msg, o) => runInFreshWorker(msg, { ...o, confine: { confinement, workspace: o.workspace, runtime } });
    const dir = S.dirOf('cancel');
    const big = path.join(dir, 'big.png');
    const w = 4000; const h = 3000; // noise: an AVIF encode of it takes seconds
    await sharp(require('crypto').randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toFile(big);
    const [d] = await S.intake.detectPaths([big]);
    assert.ok(S.coordinator.enqueue({ fileId: d.id, target: 'avif' }).ok);
    const t0 = Date.now();
    while (!(fs.existsSync(pids) && /engine/.test(fs.readFileSync(pids, 'utf8')))) {
      assert.ok(Date.now() - t0 < 60000, 'the worker started');
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 300)); // inside the encode
    const tCancel = Date.now();
    S.coordinator.cancel(d.id);
    await S.coordinator.whenIdle();
    const cancelMs = Date.now() - tCancel;
    const { helper, engine } = pidsFrom(pids);
    assert.equal(S.lastUpdate(d.id).state, 'cancelled');
    assert.equal(alive(helper), false, `no helper left (PID ${helper.pid}; cancel took ${cancelMs} ms)`);
    assert.equal(alive(engine), false, `no worker left (PID ${engine.pid}; cancel took ${cancelMs} ms)`);
    assert.deepEqual(fs.readdirSync(dir), ['big.png'], 'no output, no staging');
    assert.deepEqual(fs.existsSync(path.join(S.root, 'ws')) ? fs.readdirSync(path.join(S.root, 'ws')) : [], [], 'workspace removed');
  } finally { S.stop(); }
});
