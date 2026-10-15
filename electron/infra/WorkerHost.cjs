// Starts engine workers and talks to them with request/response messages, deadlines and kill on
// cancel. Two kinds:
//   - the persistent detection worker: an Electron utilityProcess (fork under plain Node). Separate
//     process, deadlines, killed on timeout; NOT OS-confined (Electron has no confinement option
//     for a Node utility process).
//   - the per-job image worker (sharp, libvips, heic, pdf-lib): when confinement is enforced it is
//     launched through morph-confine.exe like an engine (Job Object + AppContainer: no network,
//     reads only Morph's runtime and code, writes only the job workspace), running Electron in
//     node mode (ELECTRON_RUN_AS_NODE) and speaking JSON lines over stdin/stdout. Otherwise it is
//     a utilityProcess/fork like the detection worker.
const fs = require('fs');
const path = require('path');
const { fork, spawn } = require('child_process');
const readline = require('readline');
const { CancelledError, TimeoutError } = require('./errors.cjs');
const { killTree } = require('./ProcessRunner.cjs');
const { outcomeError } = require('./Confinement.cjs');
const { createWorkspace } = require('./JobWorkspace.cjs');

const WORKER = path.join(__dirname, '..', 'workers', 'engineWorker.cjs');
const FRAME = '\u001eMORPH:'; // as in workers/engineWorker.cjs

/**
 * The executable that runs the confined worker: Morph's own Electron binary in node mode (packaged
 * and dev), or, under plain Node (tests), the Electron binary from node_modules. null if neither.
 */
function workerRuntime() {
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  // An AppContainer cannot open the NUL device, and Electron aborts at start-up when it cannot set
  // up stdio from it ("Unable to open nul device ... try starting with --no-stdio-init", measured
  // in run 38713426740). The worker's stdio are the helper's pipes, so NUL is not needed.
  const args = ['--no-stdio-init'];
  if (process.versions.electron) return { exe: process.execPath, args, env };
  try {
    const exe = require('electron'); // under plain Node this is the path of the Electron binary
    if (typeof exe === 'string' && fs.existsSync(exe)) return { exe, args, env };
  } catch { /* not installed */ }
  return null;
}

// Folders the confined worker must read: the runtime and Morph's code (the install folder when
// packaged, the repository in development and tests).
function workerReadRoots(runtime) {
  const appRoot = path.resolve(__dirname, '..', '..');
  const code = /\.asar$/i.test(appRoot) ? path.dirname(path.dirname(appRoot)) : appRoot;
  return [...new Set([code, path.dirname(runtime.exe)])];
}

// One confined worker process through the helper. Same surface as spawnWorker().
function spawnConfinedWorker({ confinement, workspace, runtime }) {
  const launch = confinement.prepare('imageworker', runtime.exe, [...(runtime.args || []), WORKER], { workspace, read: workerReadRoots(runtime) });
  // detached off Windows only: the tree is then one process group (as in ProcessRunner).
  const child = spawn(launch.exe, launch.args, { cwd: launch.cwd, env: { ...launch.env, ...runtime.env, MORPH_WORKER_STDIO: '1' }, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const listeners = [];
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith(FRAME)) return;
    let m;
    try { m = JSON.parse(line.slice(FRAME.length)); } catch { return; }
    for (const fn of listeners) fn(m);
  });
  child.stdin.on('error', () => {}); // the worker may already be gone
  // Settles once the helper has exited and its statistics (written as it exits) are read.
  const closed = new Promise((resolve) => {
    child.on('close', async (code) => {
      const stats = launch.readStats();
      if (launch.cleanup) await launch.cleanup(stats);
      resolve({ code, stats, stderr: stderr.trim().split(/\r?\n/).pop()?.slice(0, 200) || '' });
    });
    child.on('error', (e) => resolve({ code: null, stats: null, stderr: `spawn-failed:${e.code || e.message}` }));
  });
  return {
    post: (m) => { if (child.stdin.writable) child.stdin.write(`${JSON.stringify(m)}\n`); },
    onMessage: (fn) => listeners.push(fn),
    shutdown: () => child.stdin.end(), // the worker exits when its stdin closes; the helper then writes its stats
    kill: () => killTree(child),
    closed,
    pid: child.pid,
    confined: true,
  };
}

function spawnWorker({ maxOldSpaceMb = 2048 } = {}) {
  const execArgv = [`--max-old-space-size=${maxOldSpaceMb}`];
  if (process.versions.electron && process.type === 'browser') {
    const { utilityProcess } = require('electron');
    const child = utilityProcess.fork(WORKER, [], { serviceName: 'Morph engine', execArgv, stdio: 'ignore' });
    const closed = new Promise((resolve) => child.once('exit', (code) => resolve({ code, stats: null, stderr: '' })));
    return {
      post: (m) => child.postMessage(m),
      onMessage: (fn) => child.on('message', fn),
      onExit: (fn) => child.on('exit', fn),
      shutdown: () => child.postMessage({ type: 'shutdown' }),
      kill: () => child.kill(),
      closed,
      confined: false,
    };
  }
  const child = fork(WORKER, [], { execArgv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const closed = new Promise((resolve) => child.once('exit', (code) => resolve({ code, stats: null, stderr: '' })));
  return {
    post: (m) => { if (child.connected) child.send(m); },
    onMessage: (fn) => child.on('message', fn),
    onExit: (fn) => child.on('exit', fn),
    shutdown: () => { if (child.connected) child.send({ type: 'shutdown' }); },
    kill: () => child.kill('SIGKILL'),
    closed,
    pid: child.pid,
    confined: false,
  };
}

let seq = 0;

// One worker, many sequential/concurrent requests (detection). A request that misses its deadline
// kills the worker; the next request starts a fresh one.
class PersistentWorker {
  constructor(opts) { this.opts = opts; this.w = null; this.pending = new Map(); }

  ensure() {
    if (this.w) return this.w;
    const w = spawnWorker(this.opts);
    w.onMessage((m) => {
      const p = this.pending.get(m?.id);
      if (!p || m.progress !== undefined) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    });
    w.onExit(() => {
      if (this.w === w) this.w = null;
      for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('worker-exited')); this.pending.delete(id); }
    });
    this.w = w;
    return w;
  }

  request(msg, { timeoutMs }) {
    const w = this.ensure();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(msg.type));
        if (this.w === w) { this.w = null; w.kill(); }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      w.post({ ...msg, id });
    });
  }

  stop() { if (this.w) { this.w.kill(); this.w = null; } }
}

const withDeadline = (p, ms) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), ms);
  p.then((v) => { clearTimeout(t); resolve(v); });
});

// A fresh worker for one job (image conversion). Cancelling kills it, so no library call can
// finish and write after the user pressed Stop. With `confine` ({ confinement, workspace }) and
// confinement enforced, the worker runs confined; if confinement is enforced but no runtime is
// available, the job fails (never an unconfined fallback).
//
// Lifecycle: nothing settles while the worker process is alive. A successful reply is provisional:
// the worker is asked to exit, its closure is awaited (bounded by shutdownMs, then forced), and for
// a confined worker the helper's final outcome decides (a limit hit or an abnormal exit fails the
// job even after a successful reply). Cancel and timeout kill at once and still wait for closure
// before rejecting, so the caller removes the workspace or publishes only after the process is gone.
// onStats(stats) receives the helper's accounting (confined workers) once the process has closed.
function runInFreshWorker(msg, { signal, timeoutMs, onProgress = () => {}, confine = null, onStats = null, shutdownMs = 10000, killWaitMs = 15000 } = {}) {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  let w;
  try {
    if (confine && confine.confinement.mode === 'enforced') {
      const runtime = confine.runtime || workerRuntime();
      if (!runtime) throw Object.assign(new Error('confinement-unavailable:image:no worker runtime (Electron binary)'), { code: 'confinement-unavailable' });
      w = spawnConfinedWorker({ ...confine, runtime });
    } else if (confine && confine.confinement.mode === 'unavailable') {
      throw Object.assign(new Error(`confinement-unavailable:image:${confine.confinement.reason}`), { code: 'confinement-unavailable' });
    } else {
      w = spawnWorker();
    }
  } catch (e) {
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    let settling = false;
    const report = (exit) => { if (onStats) onStats(exit ? exit.stats : null); };
    // The final word on a process that has closed: its exit and, when confined, the helper's outcome.
    const exitError = (exit) => {
      const limit = outcomeError(exit.stats, 'image');
      if (limit) return Object.assign(limit, { confinement: exit.stats });
      if (w.confined && (!exit.stats || exit.stats.outcome !== 'exited')) return new Error(`worker-exit:no-outcome:${exit.code}${exit.stderr ? `:${exit.stderr}` : ''}`);
      if (exit.code !== 0) return new Error(`worker-exit:${exit.code}${exit.stderr ? `:${exit.stderr}` : ''}`);
      return null;
    };
    const stop = async (err) => { // cancel, timeout, error reply, or the process ended first
      w.kill();
      const exit = await withDeadline(w.closed, killWaitMs);
      report(exit);
      reject(exit ? err : Object.assign(err, { stillRunning: true }));
    };
    const complete = async (result) => { // a successful reply: provisional until the process closed cleanly
      w.shutdown();
      let exit = await withDeadline(w.closed, shutdownMs);
      if (!exit) {
        w.kill();
        exit = await withDeadline(w.closed, killWaitMs);
        report(exit);
        reject(Object.assign(new Error('worker-exit:did-not-exit-after-reply'), { code: 'worker-shutdown-timeout' }));
        return;
      }
      report(exit);
      const err = exitError(exit);
      if (err) reject(err); else resolve(result);
    };
    const settle = (fn, v) => {
      if (settling) return;
      settling = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(v);
    };
    const onAbort = () => settle(stop, new CancelledError());
    const timer = setTimeout(() => settle(stop, new TimeoutError(msg.type)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    w.onMessage((m) => {
      if (m?.id !== id) return;
      if (m.progress !== undefined) { onProgress(m.progress); return; }
      if (m.ok) settle(complete, m.result); else settle(stop, new Error(m.error));
    });
    // The process ended before replying (crash, limit, kill from outside).
    w.closed.then((exit) => {
      if (settling) return;
      settling = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      report(exit);
      reject(exitError(exit) || new Error(`worker-exited:${exit.code}`));
    });
    w.post({ ...msg, id });
  });
}

// The image capability probe. Confinement enforced: through a confined worker (so "images
// available" means sharp actually loads where conversions will run); otherwise `fallback`.
async function probeImageWorker({ confinement, fallback, workspaceRoot, timeoutMs = 60000 }) {
  if (confinement.mode !== 'enforced') return fallback();
  const ws = await createWorkspace(`probe-image-${process.pid}-${Date.now().toString(36)}`, workspaceRoot ? { root: workspaceRoot } : undefined);
  try { return await runInFreshWorker({ type: 'probe' }, { timeoutMs, confine: { confinement, workspace: ws.dir } }); } finally { await ws.cleanup(); }
}

// Morph's own code folder (install folder when packaged, repository otherwise).
const codeRoot = () => workerReadRoots({ exe: process.execPath })[0];

module.exports = { PersistentWorker, runInFreshWorker, probeImageWorker, workerRuntime, workerReadRoots, codeRoot };
