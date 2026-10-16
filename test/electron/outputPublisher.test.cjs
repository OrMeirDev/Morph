const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { publish, stagingPath, discardLeftovers } = require('../../electron/infra/OutputPublisher.cjs');
const { tmpDir } = require('./helpers.cjs');

const src = (dir, name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
const no = () => false;

test('publishes under the plain name, then numbered names; never overwrites', async () => {
  const work = tmpDir('w');
  const out = tmpDir('o');
  fs.writeFileSync(path.join(out, 'photo.webp'), 'EXISTING');
  const a = await publish({ source: src(work, 'a', 'A'), outDir: out, base: 'photo', ext: 'webp', jobId: 'j1', isCancelled: no });
  assert.equal(path.basename(a), 'photo (1).webp');
  assert.equal(fs.readFileSync(path.join(out, 'photo.webp'), 'utf8'), 'EXISTING');
  assert.equal(fs.readFileSync(a, 'utf8'), 'A');
  assert.deepEqual(fs.readdirSync(out).sort(), ['photo (1).webp', 'photo.webp']);
});

test('simultaneous publishes of the same name get distinct files', async () => {
  const work = tmpDir('w');
  const out = tmpDir('o');
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => publish({ source: src(work, `s${i}`, `content ${i}`), outDir: out, base: 'same', ext: 'txt', jobId: `job${i}`, isCancelled: no })));
  assert.equal(new Set(results).size, 8);
  const contents = results.map((r) => fs.readFileSync(r, 'utf8')).sort();
  assert.deepEqual(contents, Array.from({ length: 8 }, (_, i) => `content ${i}`).sort());
  assert.ok(fs.readdirSync(out).every((n) => !n.startsWith('.~morph-')));
});

test('a cancel noticed at publish time leaves nothing behind', async () => {
  const work = tmpDir('w');
  const out = tmpDir('o');
  await assert.rejects(publish({ source: src(work, 'a', 'A'), outDir: out, base: 'x', ext: 'png', jobId: 'jc', isCancelled: () => true }), (e) => e.code === 'cancelled');
  assert.deepEqual(fs.readdirSync(out), []);
});

test('an artifact already staged in the output folder is renamed, not copied', async () => {
  const out = tmpDir('o');
  const staged = stagingPath(out, 'jf', 'mp4');
  fs.writeFileSync(staged, 'VIDEO');
  const p = await publish({ source: staged, outDir: out, base: 'clip', ext: 'mp4', jobId: 'jf', isCancelled: no });
  assert.deepEqual(fs.readdirSync(out), ['clip.mp4']);
  assert.equal(fs.readFileSync(p, 'utf8'), 'VIDEO');
});

test('page folders publish atomically under a free name', async () => {
  const work = tmpDir('w');
  const out = tmpDir('o');
  const pages = path.join(work, 'pages');
  fs.mkdirSync(pages);
  fs.writeFileSync(path.join(pages, '1.png'), 'p1');
  fs.mkdirSync(path.join(out, 'doc - pages'));
  const p = await publish({ source: pages, isDir: true, outDir: out, base: 'doc - pages', jobId: 'jd', isCancelled: no });
  assert.equal(path.basename(p), 'doc - pages (1)');
  assert.deepEqual(fs.readdirSync(p), ['1.png']);
});

test('the original file is never a valid destination', async () => {
  const dir = tmpDir('o');
  const original = src(dir, 'song.mp3', 'ORIGINAL');
  const work = tmpDir('w');
  const p = await publish({ source: src(work, 'n', 'NEW'), outDir: dir, base: 'song', ext: 'mp3', jobId: 'jo', isCancelled: no });
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
  assert.equal(path.basename(p), 'song (1).mp3');
});

test('recovery removes staging files and empty reservations but keeps real outputs', async () => {
  const dir = tmpDir('o');
  const staged = stagingPath(dir, 'jr', 'png');
  fs.writeFileSync(staged, 'half');
  const empty = path.join(dir, 'reserved.png');
  fs.writeFileSync(empty, '');
  const real = path.join(dir, 'real.png');
  fs.writeFileSync(real, 'done');
  await discardLeftovers([staged, empty, real, path.join(dir, 'gone')]);
  assert.deepEqual(fs.readdirSync(dir), ['real.png']);
});

// Stop arriving after the first cancel check, while the name is being reserved: the publish must
// still not happen. isCancelled() answers false once (the post-staging check), then true.
const lateCancel = () => { let calls = 0; return () => ++calls > 1; };

test('a cancel that lands during reservation, before the final rename, publishes nothing (file)', async () => {
  const work = tmpDir('w');
  const out = tmpDir('o');
  await assert.rejects(publish({ source: src(work, 'a', 'A'), outDir: out, base: 'late', ext: 'png', jobId: 'jl', isCancelled: lateCancel() }), (e) => e.code === 'cancelled');
  assert.deepEqual(fs.readdirSync(out), [], 'no output, no empty reservation, no staging file');
});

test('a cancel that lands during reservation, before the final rename, publishes nothing (page folder)', async () => {
  const work = tmpDir('w');
  const out = tmpDir('o');
  const pages = path.join(work, 'pages');
  fs.mkdirSync(pages);
  fs.writeFileSync(path.join(pages, '1.png'), 'p1');
  await assert.rejects(publish({ source: pages, isDir: true, outDir: out, base: 'doc', jobId: 'jld', isCancelled: lateCancel() }), (e) => e.code === 'cancelled');
  assert.deepEqual(fs.readdirSync(out), []);
});
