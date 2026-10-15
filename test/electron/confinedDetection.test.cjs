// Detection through byte ranges (detection.detectSource) and the confined detection worker
// (WorkerHost.ConfinedDetector), on any host, with the portable stand-in for morph-confine.exe
// (fixtures/fake-confine.cjs). That Windows denies the worker the original is proven in
// test/windows/isolation.test.cjs; here: same answers as reading the file, the worker is never
// given the path, and Morph serves only bounded reads inside the file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectFile, detectSource } = require('../../electron/infra/detection.cjs');
const { handleReader } = require('../../electron/infra/gifFrames.cjs');
const { ConfinedDetector } = require('../../electron/infra/WorkerHost.cjs');
const { normalizedExt } = require('../../electron/domain/formats.cjs');
const { tmpDir, makeGif, makePng, makeZip } = require('./helpers.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-confine.cjs');
const CORPUS = path.join(__dirname, '..', 'corpus');
const runtime = { exe: process.execPath, args: [], env: {} };
const fakeConfinement = {
  mode: 'enforced',
  prepare(tool, exe, args, { workspace }) {
    const stats = path.join(os.tmpdir(), `fake-confine-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    return {
      exe: process.execPath, args: [FIXTURE, '--stats', stats, '--cwd', workspace, '--', exe, ...args], cwd: workspace,
      env: { ...process.env }, confined: true,
      readStats: () => { try { const s = JSON.parse(fs.readFileSync(stats, 'utf8')); fs.rmSync(stats); return s; } catch { return null; } },
    };
  },
};
const detector = (o = {}) => {
  const d = new ConfinedDetector({ confinement: fakeConfinement, runtime, workspaceRoot: tmpDir('detect-ws'), ...o });
  d.sent = [];
  const ensure = d.ensure.bind(d);
  d.ensure = async () => {
    const w = await ensure();
    if (!w.spied) { const post = w.post; w.post = (m) => { d.sent.push(m); post(m); }; w.spied = true; }
    return w;
  };
  return d;
};

async function fixtures() {
  const d = tmpDir('det-src');
  return [
    await makePng(path.join(d, 'photo.jpg')),
    makeGif(path.join(d, 'anim.gif'), { frames: 2 }),
    makeGif(path.join(d, 'tricky.gif'), { comment: '\x21\xf9\x21\xf9' }),
    makeZip(path.join(d, 'report.docx'), [{ name: 'a.txt', data: 'x' }]),
    (() => { const f = path.join(d, 'notes.txt'); fs.writeFileSync(f, 'plain words'); return f; })(),
    path.join(CORPUS, 'benyehuda-5452-ani-maamin.docx'),
    path.join(CORPUS, 'gutenberg-11-alice.epub'),
    path.join(CORPUS, 'census-nst-est2024-pop.xlsx'),
    path.join(CORPUS, 'irs-form-w9-2024.pdf'),
  ];
}
const strip = (r) => { const { mtimeMs, ...rest } = r; return rest; };

test('byte-range detection gives the same answer as reading the file', async () => {
  for (const f of await fixtures()) {
    const st = fs.statSync(f);
    const fh = await fs.promises.open(f, 'r');
    try {
      const viaRanges = await detectSource({ ext: normalizedExt(f), size: st.size, mtimeMs: st.mtimeMs, read: handleReader(fh) });
      assert.deepEqual(strip(viaRanges), strip(await detectFile(f)), path.basename(f));
    } finally { await fh.close(); }
  }
});

test('confined detector: same answers, and the worker is never given a path', { timeout: 60000 }, async () => {
  const d = detector();
  try {
    for (const f of await fixtures()) {
      assert.deepEqual(strip(await d.detect(f, { timeoutMs: 20000 })), strip(await detectFile(f)), path.basename(f));
    }
    const text = JSON.stringify(d.sent);
    assert.ok(d.sent.some((m) => m.type === 'detect-source'), 'requests went to the worker');
    assert.ok(d.sent.some((m) => m.type === 'read-result'), 'bytes were served by Morph');
    assert.ok(!/report\.docx|photo\.jpg|alice|benyehuda|[\\/]det-src/.test(text), 'no file name or folder reached the worker');
  } finally { await d.stop(); }
});

test('confined detector: reads are bounded (per read and per file) and stay inside the file', { timeout: 60000 }, async () => {
  const f = path.join(CORPUS, 'gutenberg-11-alice.epub');
  // A budget smaller than what the sniffer needs: the read is refused and the answer says the
  // content could not be read (extension only), instead of Morph serving more.
  const small = detector({ budgetBytes: 64 });
  try {
    const r = await small.detect(f, { timeoutMs: 20000 });
    assert.equal(r.confidence, 'extension-after-error');
    const served = small.sent.filter((m) => m.type === 'read-result' && m.data).reduce((n, m) => n + Buffer.from(m.data, 'base64').length, 0);
    assert.ok(served <= 64, `served ${served} bytes`);
  } finally { await small.stop(); }
  // Out-of-range and oversized requests are answered with an error, never with data.
  const d = detector({ maxReadBytes: 16 });
  try {
    const w = await d.ensure();
    const fh = await fs.promises.open(f, 'r');
    const p = { fh, w, size: fs.statSync(f).size, served: 0 };
    const answers = [];
    const post = w.post;
    w.post = (m) => answers.push(m);
    await d.serveRead(w, p, { req: 1, position: 0, length: 17 });
    await d.serveRead(w, p, { req: 2, position: -1, length: 4 });
    await d.serveRead(w, p, { req: 3, position: 1.5, length: 4 });
    await d.serveRead(w, p, { req: 4, position: p.size + 100, length: 8 });
    w.post = post;
    await fh.close();
    assert.deepEqual(answers.map((a) => a.error || `data:${Buffer.from(a.data, 'base64').length}`), ['read-too-large', 'bad-read', 'bad-read', 'data:0']);
  } finally { await d.stop(); }
});

test('confined detector: a missed deadline kills the worker; the next request starts a fresh one', { timeout: 60000 }, async () => {
  const d = detector();
  try {
    const f = path.join(CORPUS, 'irs-form-w9-2024.pdf');
    await assert.rejects(d.detect(f, { timeoutMs: 1 }), (e) => e.code === 'timeout' || /timeout/.test(e.message));
    const r = await d.detect(f, { timeoutMs: 20000 });
    assert.equal(r.ok, true);
    assert.equal(r.ext, 'pdf');
  } finally { await d.stop(); }
});

test('confined detector: a missing file and a folder answer like detectFile', async () => {
  const d = detector();
  try {
    const dir = tmpDir('det-missing');
    assert.equal((await d.detect(path.join(dir, 'gone.png'), { timeoutMs: 20000 })).error, 'missing');
    assert.equal((await d.detect(dir, { timeoutMs: 20000 })).error, 'not-a-file');
  } finally { await d.stop(); }
});
