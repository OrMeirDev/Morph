// Shared fixtures for backend tests. Everything is generated at test time (no binary fixtures in
// git): small, deterministic and owned by the project.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const tmpDir = (tag = 't') => fs.mkdtempSync(path.join(os.tmpdir(), `morph-test-${tag}-`));

// A stored (uncompressed) zip with arbitrary entry names, including hostile ones.
function makeZip(file, entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, symlink = false } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(data);
    const crc = zlib.crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(symlink ? 0x0314 : 0x0014, 4); central.writeUInt16LE(10, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(symlink ? (0o120777 << 16) >>> 0 : (0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
  return file;
}

// Minimal GIFs built block by block. `frames` image blocks; `comment` adds a comment extension
// (used to plant 0x21 0xF9 byte pairs that are not graphic control extensions).
function makeGif(file, { frames = 1, comment = null } = {}) {
  const parts = [Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0]), Buffer.from([0, 0, 0, 255, 255, 255])];
  if (comment) {
    const c = Buffer.from(comment, 'latin1');
    parts.push(Buffer.from([0x21, 0xfe, c.length]), c, Buffer.from([0]));
  }
  for (let i = 0; i < frames; i++) {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0])); // graphic control extension
    parts.push(Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0])); // image descriptor 1x1
    parts.push(Buffer.from([2, 2, 0x44, 0x01, 0])); // LZW min size 2, one sub-block, terminator
  }
  parts.push(Buffer.from([0x3b]));
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

// 16-bit mono PCM WAV with a sine tone.
function makeWav(file, { seconds = 0.5, rate = 8000 } = {}) {
  const n = Math.floor(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

async function makePng(file, { width = 16, height = 16, alpha = false } = {}) {
  const sharp = require('sharp');
  await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 150, b: 255, alpha: 0.5 } : '#0096ff' } }).png().toFile(file);
  return file;
}

async function makePdf(file, pages = 1, text = 'Morph test') {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]).drawText(`${text} ${i + 1}`, { x: 20, y: 100, size: 14, font });
  fs.writeFileSync(file, await doc.save());
  return file;
}

// 7-Zip for archive tests: the host's 7z, else the 7za that ships in electron-builder's
// 7zip-bin (copied out, because `npm ci --ignore-scripts` leaves it non-executable).
function sevenZip() {
  if (process.env.MORPH_TOOL_SEVENZIP) return process.env.MORPH_TOOL_SEVENZIP;
  const { resolveTool } = require('../../electron/infra/ToolRegistry.cjs');
  const host = resolveTool('sevenzip');
  if (host) return host;
  const bundled = path.join(__dirname, '..', '..', 'node_modules', '7zip-bin', process.platform === 'win32' ? 'win' : process.platform, process.arch, process.platform === 'win32' ? '7za.exe' : '7za');
  if (!fs.existsSync(bundled)) return null;
  if (process.platform === 'win32') return bundled;
  const copy = path.join(os.tmpdir(), 'morph-test-7za');
  if (!fs.existsSync(copy)) { fs.copyFileSync(bundled, copy); fs.chmodSync(copy, 0o755); }
  return copy;
}

module.exports = { tmpDir, makeZip, makeGif, makeWav, makePng, makePdf, sevenZip };
