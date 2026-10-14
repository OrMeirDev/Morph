// Coordinator invariants with fake adapters (fast, no engines): ownership, duplicates, every
// cancellation phase, verification before publication, history after publication only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ConversionCoordinator } = require('../../electron/app/ConversionCoordinator.cjs');
const { JobRepository } = require('../../electron/infra/repositories.cjs');
const { CancelledError } = require('../../electron/infra/errors.cjs');
const { tmpDir } = require('./helpers.cjs');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup({ adapter, settings = {}, onLeftover = null } = {}) {
  const dir = tmpDir('coord');
  const input = path.join(dir, 'photo.png');
  fs.writeFileSync(input, PNG);
  const st = fs.statSync(input);
  const files = new Map();
  let n = 0;
  const addFile = (p = input) => {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const s2 = fs.statSync(p);
    files.set(id, { id, path: p, realPath: p, size: s2.size, mtimeMs: s2.mtimeMs, kind: 'image', ext: 'png' });
    return id;
  };
  const intake = {
    get: (id) => files.get(id) || null,
    revalidate: (id) => {
      const f = files.get(id);
      const s = fs.statSync(f.realPath);
      if (s.size !== f.size || s.mtimeMs !== f.mtimeMs) throw Object.assign(new Error('file-changed'), { code: 'file-changed' });
      return f;
    },
  };
  const updates = [];
  const historyAdds = [];
  const journal = new JobRepository(dir);
  if (onLeftover) {
    const add = journal.addLeftover.bind(journal);
    journal.addLeftover = (jobId, p) => { add(jobId, p); onLeftover(p); };
  }
  const c = new ConversionCoordinator({
    intake,
    tools: { has: () => true, path: () => '/bin/true' },
    settings: { get: () => ({ outputMode: 'beside', folder: dir, quality: 'high', maxHeight: null, ...settings }) },
    history: { add: (e) => { historyAdds.push(e); return e; } },
    journal,
    adapters: { image: adapter },
    runTool: () => Promise.resolve({}),
    runWorker: () => Promise.resolve({}),
    officeProfiles: null,
    emit: (u) => updates.push(u),
    workspaceRoot: path.join(dir, 'ws'),
  });
  const outputs = () => fs.readdirSync(dir).filter((x) => !['photo.png', 'ws', 'jobs.json'].includes(x));
  return { c, dir, input, st, addFile, updates, historyAdds, journal, outputs };
}

const finalState = (updates, fileId) => updates.filter((u) => u.fileId === fileId).at(-1)?.state;
const writeWebp = async (ctx) => { const p = ctx.workspace.file('out.webp'); fs.writeFileSync(p, WEBP); return { path: p, isDir: false }; };

test('a conversion publishes a verified output and records history after publication', async () => {
  const t = setup({ adapter: { run: writeWebp } });
  const id = t.addFile();
  assert.equal(t.c.enqueue({ fileId: id, target: 'webp' }).ok, true);
  await t.c.whenIdle();
  assert.equal(finalState(t.updates, id), 'completed');
  assert.deepEqual(t.outputs(), ['photo.webp']);
  assert.equal(t.historyAdds.length, 1);
  assert.equal(t.historyAdds[0].output, path.join(t.dir, 'photo.webp'));
  assert.deepEqual(t.updates.filter((u) => u.fileId === id).map((u) => u.state),
    ['queued', 'preparing', 'converting', 'verifying', 'publishing', 'completed']);
  assert.deepEqual(t.journal.all(), {});
  assert.equal(fs.readFileSync(t.input).equals(PNG), true, 'original untouched');
});

test('commands are validated: unknown file, unknown direction, duplicate active job', async () => {
  let release;
  const t = setup({ adapter: { run: async (ctx) => { await new Promise((r) => { release = r; }); return writeWebp(ctx); } } });
  const id = t.addFile();
  assert.deepEqual(t.c.enqueue({ fileId: 'nope', target: 'webp' }), { ok: false, error: 'unknown-file' });
  assert.deepEqual(t.c.enqueue({ fileId: id, target: 'docx' }), { ok: false, error: 'target-not-allowed' });
  assert.equal(t.c.enqueue({ fileId: id, target: 'webp' }).ok, true);
  assert.deepEqual(t.c.enqueue({ fileId: id, target: 'webp' }), { ok: false, error: 'already-active' });
  await wait(30);
  release();
  await t.c.whenIdle();
  assert.equal(t.outputs().length, 1, 'one job, one output');
});

test('one job at a time, in arrival order', async () => {
  const order = [];
  let active = 0;
  let maxActive = 0;
  const t = setup({ adapter: { run: async (ctx) => { active++; maxActive = Math.max(maxActive, active); order.push(ctx.job.fileId); await wait(20); active--; return writeWebp(ctx); } } });
  const ids = [t.addFile(), t.addFile(), t.addFile()];
  ids.forEach((id) => t.c.enqueue({ fileId: id, target: 'webp' }));
  await t.c.whenIdle();
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ids);
  assert.equal(t.outputs().length, 3);
});

test('cancel before start: removed from the queue, never runs', async () => {
  let ran = 0;
  let release;
  const t = setup({ adapter: { run: async (ctx) => { ran++; if (ran === 1) await new Promise((r) => { release = r; }); return writeWebp(ctx); } } });
  const a = t.addFile();
  const b = t.addFile();
  t.c.enqueue({ fileId: a, target: 'webp' });
  t.c.enqueue({ fileId: b, target: 'webp' });
  assert.equal(t.c.cancel(b), true);
  await wait(20);
  release();
  await t.c.whenIdle();
  assert.equal(ran, 1);
  assert.equal(finalState(t.updates, b), 'cancelled');
  assert.equal(finalState(t.updates, a), 'completed');
});

test('cancel during work that ignores the signal: no output, no history, next job runs (MOR-01)', async () => {
  let calls = 0;
  const t = setup({
    adapter: {
      // Simulates a library call that cannot be interrupted and finishes after Stop.
      run: async (ctx) => { calls++; if (calls === 1) await wait(60); return writeWebp(ctx); },
    },
  });
  const a = t.addFile();
  const b = t.addFile();
  t.c.enqueue({ fileId: a, target: 'webp' });
  t.c.enqueue({ fileId: b, target: 'webp' });
  await wait(15);
  t.c.cancel(a);
  await t.c.whenIdle();
  assert.equal(finalState(t.updates, a), 'cancelled');
  assert.equal(finalState(t.updates, b), 'completed');
  assert.deepEqual(t.outputs(), ['photo.webp'], 'only the second job published');
  assert.equal(t.historyAdds.length, 1);
  assert.equal(fs.existsSync(path.join(t.dir, 'ws')) && fs.readdirSync(path.join(t.dir, 'ws')).length, 0, 'workspaces cleaned');
});

test('cancel immediately before publication: the artifact is discarded', async () => {
  const t = setup({ adapter: { run: async (ctx) => { const r = await writeWebp(ctx); t.c.cancel(ctx.job.fileId); return r; } } });
  const id = t.addFile();
  t.c.enqueue({ fileId: id, target: 'webp' });
  await t.c.whenIdle();
  assert.equal(finalState(t.updates, id), 'cancelled');
  assert.deepEqual(t.outputs(), []);
  assert.equal(t.historyAdds.length, 0);
});

test('Stop during publication, after the name is reserved but before the final rename: cancelled, nothing written', async () => {
  let t = null;
  t = setup({
    adapter: { run: writeWebp },
    // The publisher journals the reserved final name just before renaming into it: press Stop there.
    onLeftover: (p) => { if (!path.basename(p).startsWith('.~morph-')) t.c.cancel([...t.c.byFile.keys()][0]); },
  });
  const id = t.addFile();
  t.c.enqueue({ fileId: id, target: 'webp' });
  await t.c.whenIdle();
  assert.equal(finalState(t.updates, id), 'cancelled');
  assert.deepEqual(t.outputs(), [], 'no output, no empty reservation, no staging file');
  assert.equal(t.historyAdds.length, 0);
  assert.deepEqual(t.journal.all(), {});
});

test('an adapter that honours the signal ends cancelled, and a staged file is removed', async () => {
  const t = setup({
    adapter: {
      run: async (ctx) => {
        fs.writeFileSync(ctx.stagingFile('webp'), 'partial');
        await new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new CancelledError())));
      },
    },
  });
  const id = t.addFile();
  t.c.enqueue({ fileId: id, target: 'webp' });
  await wait(20);
  t.c.cancel(id);
  await t.c.whenIdle();
  assert.equal(finalState(t.updates, id), 'cancelled');
  assert.deepEqual(t.outputs(), []);
});

test('an output that is not the requested format is never published', async () => {
  const t = setup({ adapter: { run: async (ctx) => { const p = ctx.workspace.file('out.webp'); fs.writeFileSync(p, 'not a webp'); return { path: p, isDir: false }; } } });
  const id = t.addFile();
  t.c.enqueue({ fileId: id, target: 'webp' });
  await t.c.whenIdle();
  const last = t.updates.filter((u) => u.fileId === id).at(-1);
  assert.equal(last.state, 'failed');
  assert.match(last.error, /^invalid-output:not-webp/);
  assert.deepEqual(t.outputs(), []);
  assert.equal(t.historyAdds.length, 0);
});

test('engine failure leaves nothing behind and reports the engine message', async () => {
  const t = setup({ adapter: { run: async (ctx) => { fs.writeFileSync(ctx.stagingFile('webp'), 'half'); throw new Error('Invalid data found when processing input'); } } });
  const id = t.addFile();
  t.c.enqueue({ fileId: id, target: 'webp' });
  await t.c.whenIdle();
  assert.match(t.updates.at(-1).error, /Invalid data/);
  assert.deepEqual(t.outputs(), []);
});

test('a file changed after detection is refused before any work', async () => {
  let ran = false;
  const t = setup({ adapter: { run: async (ctx) => { ran = true; return writeWebp(ctx); } } });
  const id = t.addFile();
  fs.appendFileSync(t.input, 'more');
  t.c.enqueue({ fileId: id, target: 'webp' });
  await t.c.whenIdle();
  assert.equal(ran, false);
  assert.match(t.updates.at(-1).error, /file-changed/);
});

test('settings are snapshotted at enqueue', async () => {
  let seen;
  const t = setup({ adapter: { run: async (ctx) => { seen = ctx.job.quality; return writeWebp(ctx); } }, settings: { quality: 'small' } });
  const id = t.addFile();
  t.c.enqueue({ fileId: id, target: 'webp' });
  await t.c.whenIdle();
  assert.equal(seen, 'small');
});

test('cancelAll stops everything and resolves when idle', async () => {
  const t = setup({ adapter: { run: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new CancelledError()))) } });
  const ids = [t.addFile(), t.addFile()];
  ids.forEach((id) => t.c.enqueue({ fileId: id, target: 'webp' }));
  await wait(20);
  await t.c.cancelAll();
  assert.deepEqual(ids.map((id) => finalState(t.updates, id)), ['cancelled', 'cancelled']);
  assert.deepEqual(t.outputs(), []);
});
