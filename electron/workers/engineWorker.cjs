// The engine worker: a separate process (Electron utilityProcess in the app, child_process.fork in
// tests) that runs file detection and in-process image work. Messages:
//   { id, type: 'detect', file }          -> { id, ok, result }
//   { id, type: 'image', task }           -> { id, progress } ... { id, ok, result }
//   { id, type: 'probe' }                 -> { id, ok, result }
// A crash, a hang or a kill here never takes Electron main with it.
const port = process.parentPort; // set when running as an Electron utility process
const send = (msg) => (port ? port.postMessage(msg) : process.send(msg));

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

if (port) port.on('message', (e) => onMessage(e.data));
else process.on('message', onMessage);
