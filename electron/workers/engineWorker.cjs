// The engine worker: a separate process (Electron utilityProcess in the app, child_process.fork in
// tests) that runs file detection and in-process image work. Messages:
//   { id, type: 'detect', file }          -> { id, ok, result }
//   { id, type: 'detect-source', ext, size, mtimeMs }
//                                         -> { id, read: { req, position, length } } ...
//                                            <- { type: 'read-result', req, data | error }
//                                         -> { id, ok, result }
//     (the confined detection worker: Morph reads the ranges it asks for; it never gets the path)
//   { id, type: 'image', task }           -> { id, progress } ... { id, ok, result }
//   { id, type: 'probe' }                 -> { id, ok, result }
// A crash, a hang or a kill here never takes Electron main with it.
// Transports: Electron utility process (parentPort), child_process.fork (process.send), or, when
// launched confined through morph-confine.exe (MORPH_WORKER_STDIO=1), JSON lines on stdin/stdout.
// On stdout every message carries FRAME, so anything a library prints is never taken for a reply.
const FRAME = '\u001eMORPH:';
const stdio = process.env.MORPH_WORKER_STDIO === '1';
const port = process.parentPort; // set when running as an Electron utility process
const send = (msg) => {
  if (stdio) process.stdout.write(`${FRAME}${JSON.stringify(msg)}\n`);
  else if (port) port.postMessage(msg);
  else process.send(msg);
};

// Byte ranges of the file being detected, read by Morph (see WorkerHost.ConfinedDetector).
const reads = new Map();
let readSeq = 0;
const brokeredRead = (id) => (position, length) => new Promise((resolve, reject) => {
  const req = ++readSeq;
  reads.set(req, { resolve, reject });
  send({ id, read: { req, position, length } });
});
const onReadResult = (m) => {
  const r = reads.get(m.req);
  if (!r) return;
  reads.delete(m.req);
  if (typeof m.data === 'string') r.resolve(Buffer.from(m.data, 'base64'));
  else r.reject(new Error(m.error || 'read-failed'));
};

async function handle(msg) {
  switch (msg.type) {
    case 'detect': return require('../infra/detection.cjs').detectFile(msg.file);
    case 'detect-source': return require('../infra/detection.cjs').detectSource({ ext: String(msg.ext || ''), size: Number(msg.size) || 0, mtimeMs: msg.mtimeMs, read: brokeredRead(msg.id) });
    case 'image': return require('../adapters/imageOps.cjs').convertImage(msg.task, (p) => send({ id: msg.id, progress: p }));
    case 'probe': return require('../adapters/imageOps.cjs').probeImages();
    default: throw new Error(`unknown-request:${msg.type}`);
  }
}

let pending = 0;
let inputClosed = false;
const exitIfDone = () => { if (inputClosed && pending === 0) process.exit(0); };
const onMessage = (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'shutdown') { process.exit(0); return; } // orderly end after the last reply
  if (msg.type === 'read-result') { onReadResult(msg); return; }
  pending++;
  handle(msg).then(
    (result) => send({ id: msg.id, ok: true, result }),
    (e) => send({ id: msg.id, ok: false, error: String(e?.message || e).slice(0, 300) }),
  ).finally(() => { pending--; exitIfDone(); });
};

if (stdio) {
  require('readline').createInterface({ input: process.stdin }).on('line', (line) => { try { onMessage(JSON.parse(line)); } catch { /* not a request */ } })
    .on('close', () => { inputClosed = true; exitIfDone(); }); // input ended: finish what was asked, then exit
} else if (port) port.on('message', (e) => onMessage(e.data));
else process.on('message', onMessage);
