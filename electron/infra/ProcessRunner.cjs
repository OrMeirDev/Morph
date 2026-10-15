// Runs one engine executable with a deadline, cancellation that reaches its descendants, and
// bounded diagnostics. Every external tool call goes through here.
//
// Process-tree ownership: on Windows a confined call (infra/Confinement.cjs) runs the engine inside
// a Job Object owned by morph-confine.exe, which ends every process in it when it is killed, when
// Morph dies or when a limit is hit; `taskkill /T /F` on the helper is kept as a second path.
// Elsewhere the child leads its own process group, which is signalled as a whole.
const { spawn } = require('child_process');
const { CancelledError, TimeoutError, ToolError } = require('./errors.cjs');
const { outcomeError } = require('./Confinement.cjs');

const IS_WIN = process.platform === 'win32';

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WIN) {
      // taskkill first (it finds descendants through the parent link), then, if the root is still
      // running when taskkill is done (or could not start), terminate it directly.
      const stillRunning = () => child.exitCode === null && child.signalCode === null;
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        .on('error', () => child.kill())
        .on('exit', () => { if (stillRunning()) child.kill(); });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// A string that keeps only its last `limit` characters.
function tailBuffer(limit) {
  let text = '';
  return {
    push(d) { text += d; if (text.length > limit * 2) text = text.slice(-limit); },
    get value() { return text.length > limit ? text.slice(-limit) : text; },
  };
}

function lastLine(text) {
  return String(text).trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 240) || '';
}

/**
 * @param {string} exe absolute path of an approved tool (from ToolRegistry)
 * @param {string[]} args argv; never passed through a shell
 * @param {object} o
 * @param {AbortSignal} [o.signal] aborts the whole tree
 * @param {number} o.timeoutMs deadline for this call
 * @param {(line: string) => void} [o.onLine] progress lines (split on \r, \n and \b)
 * @param {boolean} [o.captureStdout] keep full stdout (bounded by maxCaptureBytes)
 * @param {object} [o.launch] a confined call from Confinement.prepare(): what is actually spawned
 * @returns {Promise<{ code: number, stdout: string, stderrTail: string, confinement: object|null }>}
 */
function runProcess(exe, args, { signal, timeoutMs, onLine, cwd, captureStdout = false, maxCaptureBytes = 32 * 1024 * 1024, tailBytes = 64 * 1024, name = exe, launch = null } = {}) {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  const run = launch || { exe, args, cwd, env: undefined, readStats: () => null };
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(run.exe, run.args, { cwd: run.cwd, env: run.env, windowsHide: true, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new ToolError(`spawn-failed:${name}:${e.code || e.message}`, 'spawn-failed'));
      return;
    }
    let settled = false;
    let stopReason = null; // 'cancelled' | 'timeout' | 'too-much-output'
    const stdoutFull = [];
    let stdoutBytes = 0;
    const outTail = tailBuffer(tailBytes);
    const errTail = tailBuffer(tailBytes);
    const bufs = { out: '', err: '' };

    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(v);
    };
    const stop = (reason) => {
      if (stopReason) return;
      stopReason = reason;
      killTree(child);
    };
    const onAbort = () => stop('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = timeoutMs ? setTimeout(() => stop('timeout'), timeoutMs) : null;

    // ffmpeg, 7-Zip and Calibre redraw progress with \r (and \b), so split on all of them.
    const feed = (key, d) => {
      if (!onLine) return;
      bufs[key] += d;
      if (bufs[key].length > 8192) bufs[key] = bufs[key].slice(-8192);
      const lines = bufs[key].split(/[\r\n\b]+/);
      bufs[key] = lines.pop();
      for (const l of lines) { const t = l.trim(); if (t) onLine(t); }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      outTail.push(d);
      if (captureStdout) {
        stdoutBytes += Buffer.byteLength(d);
        if (stdoutBytes > maxCaptureBytes) stop('too-much-output');
        else stdoutFull.push(d);
      }
      feed('out', d);
    });
    child.stderr.on('data', (d) => { errTail.push(d); feed('err', d); });
    child.on('error', (e) => finish(reject, new ToolError(`spawn-failed:${name}:${e.code || e.message}`, 'spawn-failed')));
    child.on('close', async (code) => {
      const stats = run.readStats();
      if (run.cleanup) await run.cleanup(stats); // e.g. the job's AppContainer profile, if the helper was killed
      if (stopReason === 'cancelled') return finish(reject, new CancelledError());
      if (stopReason === 'timeout') return finish(reject, new TimeoutError(name));
      if (stopReason === 'too-much-output') return finish(reject, new ToolError(`output-too-large:${name}`, 'output-too-large'));
      const limit = outcomeError(stats, name); // a limit hit or a confinement that could not be set up
      if (limit) return finish(reject, Object.assign(limit, { confinement: stats }));
      if (code === 0) return finish(resolve, { code, stdout: captureStdout ? stdoutFull.join('') : outTail.value, stderrTail: errTail.value, confinement: stats });
      return finish(reject, Object.assign(new ToolError(lastLine(errTail.value || outTail.value) || `${name} exited with ${code}`), { confinement: stats }));
    });
  });
}

module.exports = { runProcess, killTree, lastLine };
