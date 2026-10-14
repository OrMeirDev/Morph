const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gifFrameCount } = require('../../electron/infra/gifFrames.cjs');
const { detectFile } = require('../../electron/infra/detection.cjs');
const { classify } = require('../../electron/domain/formats.cjs');
const { tmpDir, makeGif, makePng, makeZip } = require('./helpers.cjs');

test('GIF frames are counted structurally', () => {
  const d = tmpDir('gif');
  assert.equal(gifFrameCount(makeGif(path.join(d, 'one.gif'))), 1);
  assert.equal(gifFrameCount(makeGif(path.join(d, 'two.gif'), { frames: 3 })), 2); // stops at 2
});

test('a single-frame GIF whose comment holds 0x21 0xF9 pairs is still single-frame', async () => {
  const d = tmpDir('gif');
  const f = makeGif(path.join(d, 'tricky.gif'), { comment: '\x21\xf9\x21\xf9\x21\xf9' });
  assert.equal(gifFrameCount(f), 1);
  const r = await detectFile(f);
  assert.equal(r.kind, 'image'); // the old byte scan called this animated
  const anim = await detectFile(makeGif(path.join(d, 'anim.gif'), { frames: 2 }));
  assert.equal(anim.kind, 'gif');
});

test('a truncated GIF is an error, not an endless read', () => {
  const d = tmpDir('gif');
  const f = makeGif(path.join(d, 'cut.gif'), { frames: 2 });
  fs.truncateSync(f, 30);
  assert.throws(() => gifFrameCount(f), /gif-truncated/);
});

test('content wins over the name, and the rename is reported', async () => {
  const d = tmpDir('det');
  const f = await makePng(path.join(d, 'photo.jpg'));
  const r = await detectFile(f);
  assert.equal(r.kind, 'image');
  assert.equal(r.ext, 'png');
  assert.equal(r.renamed, 'jpg');
  assert.equal(r.confidence, 'content');
});

test('a name-only match says so', async () => {
  const d = tmpDir('det');
  const f = path.join(d, 'notes.txt');
  fs.writeFileSync(f, 'plain words');
  const r = await detectFile(f);
  assert.equal(r.kind, 'doc');
  assert.equal(r.confidence, 'extension');
});

test('a zip named .docx is treated as a document (container confidence)', async () => {
  const d = tmpDir('det');
  const f = makeZip(path.join(d, 'report.docx'), [{ name: 'a.txt', data: 'x' }]);
  const r = await detectFile(f);
  assert.equal(r.kind, 'doc');
  assert.equal(r.confidence, 'container');
});

test('unknown content with an unknown name is unsupported; folders are refused', async () => {
  const d = tmpDir('det');
  const f = path.join(d, 'blob.xyz');
  fs.writeFileSync(f, 'nothing');
  assert.equal((await detectFile(f)).ok, false);
  assert.equal((await detectFile(d)).error, 'not-a-file');
});

test('classify keeps tar.gz as an archive', () => {
  assert.equal(classify({ ext: 'tar.gz', sniffed: { ext: 'gz', mime: 'application/gzip' } }).kind, 'archive');
});
