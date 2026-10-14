// Starts engine workers and talks to them with request/response messages, deadlines and kill on
// cancel. Inside Electron the worker is a utilityProcess (S1 in the audit); under plain Node
// (tests) it is a child_process.fork with the same protocol. A utility process separates crashes
// and memory; it is not by itself an OS security sandbox.
const path = require('path');
const { fork } = require('child_process');
const { CancelledError, TimeoutError } = require('./errors.cjs');

const WORKER = path.join(__dirname, '..', 'workers', 'engineWorker.cjs');

function spawnWorker({ maxOldSpaceMb = 2048 } = {}) {
  const execArgv = [`--max-old-space-size=${maxOldSpaceMb}`];
  if (process.versions.electron && process.type === 'browser') {
    const { utilityProcess } = require('electron');
    const child = utilityProcess.fork(WORKER, [], { serviceName: 'Morph engine', execArgv, stdio: 'ignore' });
    return {
      post: (m) => child.postMessage(m),
      onMessage: (fn) => child.on('message', fn),
      onExit: (fn) => child.on('exit', fn),
      kill: () => child.kill(),
    };
  }
  const child = fork(WORKER, [], { execArgv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  return {
    post: (m) => child.send(m),
    onMessage: (fn) => child.on('message', fn),
    onExit: (fn) => child.on('exit', fn),
    kill: () => child.kill('SIGKILL'),
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

// A fresh worker for one job (image conversion): cancelling kills it, so no library call can
// finish and write after the user pressed Stop.
function runInFreshWorker(msg, { signal, timeoutMs, onProgress = () => {} } = {}) {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    const w = spawnWorker();
    const id = ++seq;
    let done = false;
    const end = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      w.kill();
      fn(v);
    };
    const onAbort = () => end(reject, new CancelledError());
    const timer = setTimeout(() => end(reject, new TimeoutError(msg.type)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    w.onMessage((m) => {
      if (m?.id !== id) return;
      if (m.progress !== undefined) { onProgress(m.progress); return; }
      if (m.ok) end(resolve, m.result); else end(reject, new Error(m.error));
    });
    w.onExit((code) => end(reject, new Error(`worker-exited:${code}`)));
    w.post({ ...msg, id });
  });
}

module.exports = { PersistentWorker, runInFreshWorker };
