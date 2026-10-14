// Runs one engine executable with a deadline, cancellation that reaches its descendants, and
// bounded diagnostics. Every external tool call goes through here.
//
// Process-tree ownership: on Windows the tree is ended with `taskkill /T /F` (descendants such as
// LibreOffice's soffice.bin included); elsewhere the child leads its own process group, which is
// signalled as a whole. Windows Job Objects (kill-on-close, memory caps) are the stronger option
// and remain to be evaluated on real Windows (see docs/ARCHITECTURE.md).
const { spawn } = require('child_process');
const { CancelledError, TimeoutError, ToolError } = require('./errors.cjs');

const IS_WIN = process.platform === 'win32';

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
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
 * @returns {Promise<{ code: number, stdout: string, stderrTail: string }>}
 */
function runProcess(exe, args, { signal, timeoutMs, onLine, cwd, captureStdout = false, maxCaptureBytes = 32 * 1024 * 1024, tailBytes = 64 * 1024, name = exe } = {}) {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, { cwd, windowsHide: true, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
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
    child.on('close', (code) => {
      if (stopReason === 'cancelled') return finish(reject, new CancelledError());
      if (stopReason === 'timeout') return finish(reject, new TimeoutError(name));
      if (stopReason === 'too-much-output') return finish(reject, new ToolError(`output-too-large:${name}`, 'output-too-large'));
      if (code === 0) return finish(resolve, { code, stdout: captureStdout ? stdoutFull.join('') : outTail.value, stderrTail: errTail.value });
      return finish(reject, new ToolError(lastLine(errTail.value || outTail.value) || `${name} exited with ${code}`));
    });
  });
}

module.exports = { runProcess, killTree, lastLine };
