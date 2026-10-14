const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilityFor, targetsFor } = require('../../electron/domain/capabilities.cjs');
const { KINDS } = require('../../electron/domain/formats.cjs');

test('every advertised target has an adapter and requirements', () => {
  for (const [kind, { targets }] of Object.entries(KINDS)) {
    for (const t of targets) {
      const cap = capabilityFor(kind, 'x', t);
      assert.ok(cap && cap.adapter && cap.requires.length && cap.fidelity, `${kind} -> ${t}`);
    }
  }
});

test('targets depend on verified engine capabilities, not on the table alone', () => {
  const none = targetsFor({ kind: 'video', ext: 'mp4' }, () => false);
  assert.deepEqual(none.available, []);
  assert.ok(none.unavailable.find((u) => u.target === 'mp3').missing.includes('ffmpeg'));
  // ffmpeg present but built without libvpx-vp9: WEBM is not offered, MP3 is.
  const has = (c) => c !== 'ffmpeg:enc:libvpx-vp9';
  const t = targetsFor({ kind: 'video', ext: 'mp4' }, has);
  assert.ok(!t.available.includes('webm'));
  assert.ok(t.available.includes('mp3'));
  assert.ok(!t.available.includes('mp4'), 'never offers the same format');
});

test('images need ffmpeg only for BMP/ICO, and HEIC needs its decoder', () => {
  const imagesOnly = (c) => c === 'images';
  const png = targetsFor({ kind: 'image', ext: 'png' }, imagesOnly);
  assert.ok(png.available.includes('webp'));
  assert.ok(!png.available.includes('bmp'));
  assert.deepEqual(targetsFor({ kind: 'image', ext: 'bmp' }, imagesOnly).available, []);
  assert.deepEqual(targetsFor({ kind: 'image', ext: 'heic' }, imagesOnly).available, []);
});

test('fidelity is stated for lossy-in-kind directions', () => {
  assert.equal(capabilityFor('image', 'png', 'svg').fidelity, 'vector-approx');
  assert.equal(capabilityFor('pdf', 'pdf', 'docx').fidelity, 'reconstruct');
  assert.equal(capabilityFor('gif', 'gif', 'png').fidelity, 'single-frame');
  assert.equal(capabilityFor('sheet', 'xlsx', 'csv').fidelity, 'first-sheet');
  assert.equal(capabilityFor('video', 'mp4', 'mp3').fidelity, 'audio-only');
  assert.equal(capabilityFor('archive', 'zip', '7z').fidelity, 'repack');
  assert.equal(capabilityFor('video', 'mp4', 'apng').fidelity, 'resampled');
  assert.equal(capabilityFor('audio', 'mp3', 'flac').fidelity, 'lossless');
});

test('an unknown direction has no capability', () => {
  assert.equal(capabilityFor('audio', 'mp3', 'docx'), null);
  assert.equal(capabilityFor('nope', 'x', 'mp3'), null);
});

test('an AZW3 book is offered MOBI but not AZW3', () => {
  const t = targetsFor({ kind: 'ebook', ext: 'azw3' }, () => true);
  assert.ok(t.available.includes('mobi'));
  assert.ok(!t.available.includes('azw3'));
});
