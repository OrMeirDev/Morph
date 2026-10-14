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

// 7-Zip for archive tests: MORPH_TOOL_SEVENZIP, the host's 7z, else a 7za from a 7zip-bin package
// if one is installed (copied out, because `npm ci --ignore-scripts` leaves it non-executable).
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

// Reads every entry of a zip (stored or deflated) into a Map name -> Buffer. Enough to inspect
// DOCX/XLSX/PPTX/ODF/EPUB output without a dependency.
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const zipText = (file, name) => { const e = readZip(file).get(name); if (!e) throw new Error(`${name} not in ${path.basename(file)}`); return e.toString('utf8'); };

// Minimal OpenDocument packages (mimetype first and stored, as the spec requires).
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
  + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
  + 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
  + 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" '
  + 'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.3"';
function makeOdf(file, mimetype, body, autoStyles = '') {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:automatic-styles>${autoStyles}</office:automatic-styles><office:body>${body}</office:body></office:document-content>`;
  const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">'
    + `<manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return makeZip(file, [{ name: 'mimetype', data: mimetype }, { name: 'content.xml', data: content }, { name: 'META-INF/manifest.xml', data: manifest }]);
}

// The document fixture: a Hebrew right-to-left paragraph, bold text, a 2x2 table, and a page
// break, so two pages. Strings are exported for assertions.
const DOC = { hebrew: 'שלום עולם, זו בדיקת המרה', bold: 'BoldMarker', cells: ['CellA1', 'CellB1', 'תא2א', 'CellB2'], page2: 'SecondPageMarker' };
function makeRichOdt(file) {
  const styles = '<style:style style:name="Prtl" style:family="paragraph"><style:paragraph-properties style:writing-mode="rl-tb" fo:text-align="end"/></style:style>'
    + '<style:style style:name="Tb" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>'
    + '<style:style style:name="Pbreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>';
  const cell = (t) => `<table:table-cell office:value-type="string"><text:p>${t}</text:p></table:table-cell>`;
  const body = `<office:text><text:p text:style-name="Prtl">${DOC.hebrew}</text:p><text:p>Plain and <text:span text:style-name="Tb">${DOC.bold}</text:span></text:p>`
    + `<table:table table:name="T1"><table:table-column table:number-columns-repeated="2"/><table:table-row>${cell(DOC.cells[0])}${cell(DOC.cells[1])}</table:table-row><table:table-row>${cell(DOC.cells[2])}${cell(DOC.cells[3])}</table:table-row></table:table>`
    + `<text:p text:style-name="Pbreak">${DOC.page2}</text:p></office:text>`;
  return makeOdf(file, 'application/vnd.oasis.opendocument.text', body, styles);
}

// The spreadsheet fixture: sheet "Data" with 3, 4 and =SUM(A1:A2) and a Hebrew label; a second
// sheet "Other" that CSV export must leave out.
const SHEET = { label: 'סכום', other: 'OtherSheetMarker' };
function makeRichOds(file) {
  const num = (v) => `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`;
  const body = '<office:spreadsheet><table:table table:name="Data">'
    + `<table:table-row>${num(3)}</table:table-row><table:table-row>${num(4)}</table:table-row>`
    + `<table:table-row><table:table-cell table:formula="of:=SUM([.A1:.A2])" office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>${SHEET.label}</text:p></table:table-cell></table:table-row>`
    + `</table:table><table:table table:name="Other"><table:table-row><table:table-cell office:value-type="string"><text:p>${SHEET.other}</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>`;
  return makeOdf(file, 'application/vnd.oasis.opendocument.spreadsheet', body);
}

// The presentation fixture: three slides, each with its own marker text.
const SLIDES = ['SlideOneMarker', 'SlideTwoMarker', 'שקף שלישי'];
function makeRichOdp(file) {
  const page = (t, i) => `<draw:page draw:name="p${i + 1}"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>${t}</text:p></draw:text-box></draw:frame></draw:page>`;
  return makeOdf(file, 'application/vnd.oasis.opendocument.presentation', `<office:presentation>${SLIDES.map(page).join('')}</office:presentation>`);
}

// The e-book fixture: EPUB 3 with title/author metadata, two chapters with headings, a Hebrew
// right-to-left paragraph, bold text and a list.
const BOOK = {
  title: 'Morph Test Book', author: 'Morph QA', ch1: 'ChapterOneHeading', ch2: 'ChapterTwoHeading',
  hebrew: 'שלום עולם, זה ספר בדיקה', bold: 'BoldWordMarker', item: 'ListItemMarker', tail: 'LastParagraphMarker',
};
function makeRichEpub(file) {
  const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`
    + `<dc:identifier id="uid">urn:uuid:7f1b2c4e-0d7a-4f39-9a2e-3b8f5e6d1a20</dc:identifier><dc:title>${BOOK.title}</dc:title><dc:creator>${BOOK.author}</dc:creator><dc:language>en</dc:language>`
    + '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    + '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>';
  const nav = xhtml('Contents', `<nav epub:type="toc"><ol><li><a href="c1.xhtml">${BOOK.ch1}</a></li><li><a href="c2.xhtml">${BOOK.ch2}</a></li></ol></nav>`);
  const c1 = xhtml(BOOK.ch1, `<h1>${BOOK.ch1}</h1><p dir="rtl" lang="he">${BOOK.hebrew}</p><p>Plain and <b>${BOOK.bold}</b> text.</p>`);
  const c2 = xhtml(BOOK.ch2, `<h1>${BOOK.ch2}</h1><ul><li>${BOOK.item}</li><li>Second item</li></ul><p>${BOOK.tail}</p>`);
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  return makeZip(file, [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf }, { name: 'OEBPS/nav.xhtml', data: nav }, { name: 'OEBPS/c1.xhtml', data: c1 }, { name: 'OEBPS/c2.xhtml', data: c2 }]);
}

module.exports = { makeRichEpub, BOOK, tmpDir, makeZip, makeGif, makeWav, makePng, makePdf, sevenZip, readZip, zipText, makeRichOdt, makeRichOds, makeRichOdp, DOC, SHEET, SLIDES };
