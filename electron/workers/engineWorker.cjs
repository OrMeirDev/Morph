// The engine worker: a separate process (Electron utilityProcess in the app, child_process.fork in
// tests) that runs file detection and in-process image work. Messages:
//   { id, type: 'detect', file }          -> { id, ok, result }
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

async function handle(msg) {
  switch (msg.type) {
    case 'detect': return require('../infra/detection.cjs').detectFile(msg.file);
    case 'image': return require('../adapters/imageOps.cjs').convertImage(msg.task, (p) => send({ id: msg.id, progress: p }));
    case 'probe': return require('../adapters/imageOps.cjs').probeImages();
    default: throw new Error(`unknown-request:${msg.type}`);
  }
}

const onMessage = (msg) => {
  if (!msg || typeof msg !== 'object') return;
  handle(msg).then(
    (result) => send({ id: msg.id, ok: true, result }),
    (e) => send({ id: msg.id, ok: false, error: String(e?.message || e).slice(0, 300) }),
  );
};

if (stdio) {
  require('readline').createInterface({ input: process.stdin }).on('line', (line) => { try { onMessage(JSON.parse(line)); } catch { /* not a request */ } })
    .on('close', () => process.exit(0)); // the parent went away
} else if (port) port.on('message', (e) => onMessage(e.data));
else process.on('message', onMessage);
