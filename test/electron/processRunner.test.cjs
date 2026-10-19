const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { runProcess } = require('../../electron/infra/ProcessRunner.cjs');

const posix = process.platform !== 'win32';
const node = process.execPath;

test('captures stdout and resolves on exit 0', async () => {
  const r = await runProcess(node, ['-e', 'console.log("hello")'], { timeoutMs: 10000, captureStdout: true });
  assert.equal(r.stdout.trim(), 'hello');
});

test('a non-zero exit rejects with the last stderr line', async () => {
  await assert.rejects(runProcess(node, ['-e', 'console.error("first\\nboom happened"); process.exit(3)'], { timeoutMs: 10000 }), /boom happened/);
});

test('a missing executable is a typed spawn failure, not a crash', async () => {
  await assert.rejects(runProcess('/nonexistent/tool', [], { timeoutMs: 1000 }), (e) => e.code === 'spawn-failed');
});

test('the deadline ends a hung tool with a timeout error', async () => {
  const t0 = Date.now();
  await assert.rejects(runProcess(node, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 }), (e) => e.code === 'timeout');
  assert.ok(Date.now() - t0 < 5000);
});

test('runaway output keeps only a bounded tail', async () => {
  const r = await runProcess(node, ['-e', 'for (let i = 0; i < 20000; i++) console.error("x".repeat(100))'], { timeoutMs: 20000, tailBytes: 1024 });
  assert.ok(r.stderrTail.length <= 1024);
});

test('full stdout capture is bounded', async () => {
  await assert.rejects(runProcess(node, ['-e', 'process.stdout.write("y".repeat(1e6))'], { timeoutMs: 20000, captureStdout: true, maxCaptureBytes: 1000 }), (e) => e.code === 'output-too-large');
});

test('progress lines are split on \\r and \\n', async () => {
  const lines = [];
  await runProcess(node, ['-e', 'process.stderr.write("10%\\r20%\\r30%\\ndone\\n")'], { timeoutMs: 10000, onLine: (l) => lines.push(l) });
  assert.deepEqual(lines, ['10%', '20%', '30%', 'done']);
});

test('an already-aborted signal never starts the tool', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(runProcess(node, ['-e', ''], { signal: ac.signal, timeoutMs: 1000 }), (e) => e.code === 'cancelled');
});

test('cancel ends the tool and its descendants (process group / taskkill /T)', async () => {
  const ac = new AbortController();
  // The child starts a grandchild that would outlive a plain child.kill().
  const script = 'const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" }); console.log(c.pid); setInterval(() => {}, 1000)';
  let grandchild = null;
  const p = runProcess(node, ['-e', script], { signal: ac.signal, timeoutMs: 20000, onLine: (l) => { if (/^\d+$/.test(l)) { grandchild = Number(l); ac.abort(); } } });
  await assert.rejects(p, (e) => e.code === 'cancelled');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(grandchild, 'grandchild pid reported');
  // A killed process can linger as a zombie until something reaps it (containers often have no
  // reaping init); a zombie runs nothing, so it counts as ended.
  let alive = true;
  try {
    process.kill(grandchild, 0);
    if (process.platform === 'linux') alive = require('fs').readFileSync(`/proc/${grandchild}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z';
  } catch { alive = false; }
  if (alive) { try { if (posix) execFileSync('kill', ['-9', String(grandchild)]); else process.kill(grandchild); } catch { /* cleanup */ } }
  assert.equal(alive, false, 'grandchild survived cancel');
});
