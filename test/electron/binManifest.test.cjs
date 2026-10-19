const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { record, verify } = require('../../scripts/bin-manifest.cjs');
const { tmpDir } = require('./helpers.cjs');

function payload() {
  const root = tmpDir('bin');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(bin, 'ffmpeg'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'ffmpeg', 'ffmpeg.exe'), 'MZ fake ffmpeg');
  fs.writeFileSync(path.join(bin, 'ffmpeg', 'ffprobe.exe'), 'MZ fake ffprobe');
  return { bin, manifestFile: path.join(root, 'bin-manifest.json') };
}

test('a recorded payload verifies clean', () => {
  const p = payload();
  record({ binDir: p.bin, manifestFile: p.manifestFile });
  assert.deepEqual(verify({ binDir: p.bin, manifestFile: p.manifestFile }), []);
});

test('tampered, missing and extra files all fail verification', () => {
  const p = payload();
  record({ binDir: p.bin, manifestFile: p.manifestFile });
  fs.writeFileSync(path.join(p.bin, 'ffmpeg', 'ffmpeg.exe'), 'MZ fake ffmpeg!'); // same size +1, different hash
  fs.rmSync(path.join(p.bin, 'ffmpeg', 'ffprobe.exe'));
  fs.writeFileSync(path.join(p.bin, 'ffmpeg', 'evil.dll'), 'x');
  assert.deepEqual(verify({ binDir: p.bin, manifestFile: p.manifestFile }).sort(), ['changed: ffmpeg/ffmpeg.exe', 'missing: ffmpeg/ffprobe.exe', 'unexpected: ffmpeg/evil.dll']);
});

test('no manifest means no packaging', () => {
  const p = payload();
  assert.match(verify({ binDir: p.bin, manifestFile: p.manifestFile })[0], /no manifest/);
});
