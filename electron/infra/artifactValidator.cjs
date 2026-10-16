// Checks that an engine really produced the requested format before Morph publishes it: the file
// exists, is not empty, and starts with that format's signature. A zero exit code alone is not
// proof (LibreOffice, for one, can exit 0 having written nothing). Reads at most 4 KiB per file.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ascii = (buf, at, s) => buf.length >= at + s.length && buf.toString('latin1', at, at + s.length) === s;
const bytes = (buf, at, arr) => buf.length >= at + arr.length && arr.every((b, i) => buf[at + i] === b);
const zip = (b) => bytes(b, 0, [0x50, 0x4b, 0x03, 0x04]);
const isoBmff = (b) => ['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip'].some((t) => ascii(b, 4, t));
const textual = (b) => b.length > 0;

const SIGNATURES = {
  jpg: (b) => bytes(b, 0, [0xff, 0xd8, 0xff]),
  png: (b) => bytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  apng: (b) => bytes(b, 0, [0x89, 0x50, 0x4e, 0x47]) && b.includes(Buffer.from('acTL')),
  gif: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'),
  webp: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  avif: (b) => ascii(b, 4, 'ftyp') && ['avif', 'avis', 'mif1'].some((t) => ascii(b, 8, t)),
  tiff: (b) => bytes(b, 0, [0x49, 0x49, 0x2a, 0x00]) || bytes(b, 0, [0x4d, 0x4d, 0x00, 0x2a]),
  bmp: (b) => ascii(b, 0, 'BM'),
  ico: (b) => bytes(b, 0, [0x00, 0x00, 0x01, 0x00]),
  pdf: (b) => ascii(b, 0, '%PDF-'),
  svg: (b) => /<svg[\s>]/.test(b.toString('utf8')),
  mp4: isoBmff,
  mov: isoBmff,
  m4a: isoBmff,
  mkv: (b) => bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  webm: (b) => bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  avi: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'AVI '),
  wav: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE'),
  mp3: (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  aac: (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0,
  ogg: (b) => ascii(b, 0, 'OggS'),
  opus: (b) => ascii(b, 0, 'OggS'),
  flac: (b) => ascii(b, 0, 'fLaC'),
  docx: zip, xlsx: zip, pptx: zip, odt: zip, ods: zip, odp: zip, epub: zip, zip,
  rtf: (b) => ascii(b, 0, '{\\rtf'),
  txt: textual,
  csv: textual,
  mobi: (b) => ascii(b, 60, 'BOOKMOBI'),
  azw3: (b) => ascii(b, 60, 'BOOKMOBI'),
  '7z': (b) => bytes(b, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  tar: (b) => ascii(b, 257, 'ustar'),
  'tar.gz': (b) => bytes(b, 0, [0x1f, 0x8b]),
};

class InvalidOutputError extends Error {
  constructor(detail) { super(`invalid-output:${detail}`); this.code = 'invalid-output'; }
}

async function head(file) {
  const fd = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

// The MOBI header version: record 0 starts at the offset stored at byte 78 of the PalmDB header,
// and its MOBI header (16 bytes in) holds the format version at +0x14.
async function mobiVersion(file) {
  const fd = await fsp.open(file, 'r');
  try {
    const at = Buffer.alloc(4);
    await fd.read(at, 0, 4, 78);
    const rec0 = at.readUInt32BE(0);
    const hdr = Buffer.alloc(0x18);
    const { bytesRead } = await fd.read(hdr, 0, hdr.length, rec0 + 16);
    if (bytesRead < hdr.length || hdr.toString('latin1', 0, 4) !== 'MOBI') return null;
    return hdr.readUInt32BE(0x14);
  } finally {
    await fd.close();
  }
}

async function verifyFile(file, target) {
  let st;
  try { st = await fsp.lstat(file); } catch { throw new InvalidOutputError('missing'); }
  if (!st.isFile()) throw new InvalidOutputError('not-a-file');
  if (st.size === 0) throw new InvalidOutputError('empty');
  const check = SIGNATURES[target];
  if (!check) throw new InvalidOutputError(`no-check-for:${target}`);
  if (!check(await head(file))) throw new InvalidOutputError(`not-${target}`);
  // AZW3 is KF8: a Mobipocket container whose MOBI header says version 8 (plain MOBI is 6 or less).
  if (target === 'azw3' && (await mobiVersion(file)) !== 8) throw new InvalidOutputError('not-azw3-kf8');
  return { size: st.size };
}

// A page folder (PDF -> images): every entry is a regular, valid image of the target format.
async function verifyDir(dir, target) {
  const names = await fsp.readdir(dir).catch(() => { throw new InvalidOutputError('missing'); });
  if (!names.length) throw new InvalidOutputError('empty-folder');
  let size = 0;
  for (const n of names) size += (await verifyFile(path.join(dir, n), target)).size;
  return { size, files: names.length };
}

const verifyArtifact = (artifact, target) => (artifact.isDir ? verifyDir(artifact.path, target) : verifyFile(artifact.path, target));

module.exports = { verifyArtifact, verifyFile, mobiVersion, InvalidOutputError, SIGNATURES };
