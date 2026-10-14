// Office content and formatting through LibreOffice, checked inside the produced files (the XML
// of DOCX/XLSX/PPTX/ODF/EPUB, the text and page count of PDFs), not just "a file appeared".
// Fixtures are generated OpenDocument packages: Hebrew right-to-left text, bold, a table and a
// page break (document); two sheets and a formula (spreadsheet); three slides (presentation).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readZip, zipText, makeRichOdt, makeRichOds, makeRichOdp, DOC, SHEET, SLIDES } = require('./helpers.cjs');
const { createStack } = require('./engineStack.cjs');

const S = createStack('documents');
test.after(() => S.stop());

let ready = null;
const office = async (t) => {
  ready = ready || S.tools.probe();
  await ready;
  if (!S.has('soffice')) { t.skip('no LibreOffice'); return false; }
  return true;
};
const ok = (u) => assert.equal(u.state, 'completed', u.error);
const hebrewIn = (s) => /[א-ת]{2,}/.test(s);

// DOCX paragraphs as { text, bidi, xml }: a sentence can be split into several runs (LibreOffice
// splits right-to-left text at punctuation), so text is joined across runs.
const docxParagraphs = (xml) => [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(([, p]) => ({
  text: [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''),
  bidi: /<w:bidi(?: w:val="(?:1|true)")?\/>/.test(p),
  xml: p,
}));

// Office output and the cached source are produced once and shared by the tests below.
let odt;
let docx;
const sources = () => {
  if (!odt) odt = makeRichOdt(path.join(S.dirOf('doc-src'), 'letter.odt'));
  return odt;
};

test('document -> DOCX keeps Hebrew RTL, bold and the table', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('doc-docx');
  fs.copyFileSync(sources(), path.join(d, 'letter.odt'));
  const u = await S.convert(path.join(d, 'letter.odt'), 'docx');
  ok(u);
  docx = u.output;
  const xml = zipText(u.output, 'word/document.xml');
  const paras = docxParagraphs(xml);
  const he = paras.find((p) => p.text === DOC.hebrew);
  assert.ok(he, 'the Hebrew sentence, whole');
  assert.equal(he.bidi, true, 'the Hebrew paragraph is right-to-left');
  const en = paras.find((p) => p.text.includes(DOC.bold));
  assert.equal(en.bidi, false, 'the English paragraph stays left-to-right');
  assert.match(en.xml, /<w:b\/>[\s\S]*?<w:t>BoldMarker<\/w:t>/, 'bold run');
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1, 'one table');
  assert.equal((xml.match(/<w:tr[ >]/g) || []).length, 2, 'two rows');
  for (const c of DOC.cells) assert.ok(paras.some((p) => p.text === c), `cell ${c}`);
  assert.ok(paras.some((p) => p.text === DOC.page2) && /w:type="page"|<w:pageBreakBefore/.test(xml), 'page break kept');
});

test('document -> PDF: two pages, Hebrew and table text', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('doc-pdf');
  fs.copyFileSync(sources(), path.join(d, 'letter.odt'));
  const u = await S.convert(path.join(d, 'letter.odt'), 'pdf');
  ok(u);
  if (!S.has('pdfinfo')) return;
  assert.equal(await S.pdfPages(u.output), 2, 'page break -> two pages');
  const text = await S.pdfText(u.output);
  assert.ok(hebrewIn(text), 'Hebrew text in the PDF');
  for (const c of [DOC.bold, DOC.cells[0], DOC.cells[3], DOC.page2]) assert.ok(text.includes(c), `${c} in the PDF`);
});

test('DOCX -> ODT keeps the table and the right-to-left paragraph', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  if (!docx) return t.skip('needs the DOCX from the previous test');
  const d = S.dirOf('doc-odt');
  fs.copyFileSync(docx, path.join(d, 'letter.docx'));
  const u = await S.convert(path.join(d, 'letter.docx'), 'odt');
  ok(u);
  const content = zipText(u.output, 'content.xml');
  const styles = content + (readZip(u.output).get('styles.xml')?.toString('utf8') || '');
  assert.equal(zipText(u.output, 'mimetype'), 'application/vnd.oasis.opendocument.text');
  assert.ok(content.includes(DOC.hebrew));
  assert.ok(/<table:table /.test(content) && content.includes(DOC.cells[2]), 'table with the Hebrew cell');
  assert.match(styles, /writing-mode="rl-tb"/, 'right-to-left writing mode');
});

test('document -> RTF keeps the table, bold and Hebrew', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('doc-rtf');
  fs.copyFileSync(sources(), path.join(d, 'letter.odt'));
  const u = await S.convert(path.join(d, 'letter.odt'), 'rtf');
  ok(u);
  const rtf = fs.readFileSync(u.output, 'latin1');
  assert.ok(rtf.startsWith('{\\rtf'));
  assert.match(rtf, /\\trowd/, 'table rows');
  assert.match(rtf, /\\b[\s\\]/, 'bold');
  // Exactly one right-to-left paragraph (the Hebrew one): \rtlch alone appears everywhere.
  assert.equal((rtf.match(/\\rtlpar/g) || []).length, 1, 'one paragraph marked right-to-left');
  const hebrewAt = rtf.search(/\\u1513/);
  assert.ok(rtf.lastIndexOf('\\pard', hebrewAt) < rtf.lastIndexOf('\\rtlpar', hebrewAt), 'and it is the Hebrew paragraph');
  // Hebrew letters are written as \uNNNN escapes (1488-1514).
  assert.match(rtf, /\\u14(8[89]|9\d)|\\u15(0\d|1[0-4])/, 'Hebrew characters');
});

test('document -> text: words only, UTF-8 Hebrew, no markup', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('doc-txt');
  fs.copyFileSync(sources(), path.join(d, 'letter.odt'));
  const u = await S.convert(path.join(d, 'letter.odt'), 'txt');
  ok(u);
  const text = fs.readFileSync(u.output, 'utf8');
  assert.ok(text.includes(DOC.hebrew) && text.includes(DOC.bold) && text.includes(DOC.cells[1]) && text.includes(DOC.page2));
  assert.ok(!/[<>{}\\]/.test(text), 'no markup');
});

test('document -> EPUB: valid package with the Hebrew text', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('doc-epub');
  fs.copyFileSync(sources(), path.join(d, 'letter.odt'));
  const u = await S.convert(path.join(d, 'letter.odt'), 'epub');
  ok(u);
  const entries = readZip(u.output);
  assert.equal(entries.get('mimetype')?.toString(), 'application/epub+zip');
  assert.ok(entries.has('META-INF/container.xml'));
  const xhtml = [...entries].filter(([n]) => /\.x?html$/.test(n)).map(([, b]) => b.toString('utf8')).join('');
  assert.ok(xhtml.includes(DOC.hebrew) && xhtml.includes(DOC.cells[0]), 'text and table content in the book');
});

test('spreadsheet -> XLSX keeps both sheets, the formula and its value', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('sheet-xlsx');
  const u = await S.convert(makeRichOds(path.join(d, 'budget.ods')), 'xlsx');
  ok(u);
  const workbook = zipText(u.output, 'xl/workbook.xml');
  assert.match(workbook, /name="Data"/);
  assert.match(workbook, /name="Other"/);
  const sheet1 = zipText(u.output, 'xl/worksheets/sheet1.xml');
  assert.match(sheet1, /<f[^>]*>SUM\(A1:A2\)<\/f>\s*<v>7<\/v>/, 'formula kept with its cached value');
  const shared = readZip(u.output).get('xl/sharedStrings.xml')?.toString('utf8') || '';
  assert.ok(shared.includes(SHEET.label) || sheet1.includes(SHEET.label), 'Hebrew label');
});

test('spreadsheet -> CSV: first sheet only, computed values', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('sheet-csv');
  const u = await S.convert(makeRichOds(path.join(d, 'budget.ods')), 'csv');
  ok(u);
  const lines = fs.readFileSync(u.output, 'utf8').trim().split(/\r?\n/);
  // LibreOffice pads every row to the sheet's used width, hence the empty second column.
  assert.deepEqual(lines, ['3,', '4,', `7,${SHEET.label}`]);
  assert.ok(!lines.join().includes(SHEET.other), 'second sheet left out (as the UI note says)');
});

test('spreadsheet -> PDF shows the computed value and the Hebrew label', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('sheet-pdf');
  const u = await S.convert(makeRichOds(path.join(d, 'budget.ods')), 'pdf');
  ok(u);
  if (!S.has('pdftotext')) return;
  const text = await S.pdfText(u.output);
  assert.match(text, /\b7\b/);
  assert.ok(text.includes(SHEET.label));
});

let pptx;
test('presentation -> PPTX keeps three slides and their text', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('slides-pptx');
  const u = await S.convert(makeRichOdp(path.join(d, 'deck.odp')), 'pptx');
  ok(u);
  pptx = u.output;
  const entries = readZip(u.output);
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
  assert.equal(slides.length, 3);
  SLIDES.forEach((marker, i) => assert.ok(entries.get(`ppt/slides/slide${i + 1}.xml`).toString('utf8').includes(marker), `slide ${i + 1} text`));
});

test('presentation -> PDF: one page per slide', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  const d = S.dirOf('slides-pdf');
  const u = await S.convert(makeRichOdp(path.join(d, 'deck.odp')), 'pdf');
  ok(u);
  if (!S.has('pdfinfo')) return;
  assert.equal(await S.pdfPages(u.output), 3);
  const text = await S.pdfText(u.output);
  for (const m of SLIDES) assert.ok(text.includes(m), `${m} in the PDF`);
});

test('PPTX -> ODP keeps three slides', { timeout: 120000 }, async (t) => {
  if (!(await office(t))) return;
  if (!pptx) return t.skip('needs the PPTX from the previous test');
  const d = S.dirOf('slides-odp');
  fs.copyFileSync(pptx, path.join(d, 'deck.pptx'));
  const u = await S.convert(path.join(d, 'deck.pptx'), 'odp');
  ok(u);
  const content = zipText(u.output, 'content.xml');
  assert.equal((content.match(/<draw:page /g) || []).length, 3);
  for (const m of SLIDES) assert.ok(content.includes(m));
});
