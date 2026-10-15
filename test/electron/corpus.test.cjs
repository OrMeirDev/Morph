// Real-world documents (test/corpus, attribution in SOURCES.md) through the real engines. Unlike
// the generated fixtures, nobody designed these files for Morph: the checks are that the
// conversion succeeds and that the text a reader cares about survives, in order and in Hebrew
// where it was Hebrew. A pass here is evidence for these files, not for every file of the type.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { zipText } = require('./helpers.cjs');
const { createStack } = require('./engineStack.cjs');

const CORPUS = path.join(__dirname, '..', 'corpus');
const S = createStack('corpus');
test.after(() => S.stop());

let ready = null;
const needs = async (t, tool, why) => {
  ready = ready || S.tools.probe();
  await ready;
  if (!S.has(tool)) { t.skip(why); return false; }
  return true;
};
const ok = (u) => assert.equal(u.state, 'completed', u.error);

// Hebrew compared without niqqud/cantillation, bidi controls and spacing: PDF text extraction
// splits pointed words into glyph clusters, which says nothing about whether the text survived.
const bare = (s) => s.normalize('NFC').replace(/[֑-ׇ‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, '');
const POEM = { title: 'אנימאמין', byline: 'מאתשאולטשרניחובסקי', line1: 'שחקי,שחקיעלהחלומות', last: 'פרחיםילקטולזר' };

const sources = Object.fromEntries(fs.readFileSync(path.join(CORPUS, 'SOURCES.md'), 'utf8')
  .split('\n').map((l) => l.match(/^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|$/)).filter(Boolean).map((m) => [m[1], m[2]]));

// Each conversion works on a copy in its own folder; the corpus itself is never written.
async function convert(name, target) {
  const d = S.dirOf(`${name}-${target}`);
  const copy = path.join(d, name);
  fs.copyFileSync(path.join(CORPUS, name), copy);
  const u = await S.convert(copy, target);
  ok(u);
  return u.output;
}

test('corpus files are the recorded ones (SHA-256 in SOURCES.md) and all are listed', () => {
  const files = fs.readdirSync(CORPUS).filter((n) => n !== 'SOURCES.md');
  assert.deepEqual(files.sort(), Object.keys(sources).sort());
  for (const f of files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(CORPUS, f))).digest('hex'), sources[f], f);
});

test('Hebrew poem DOCX -> PDF: every line in Hebrew, right-to-left text kept in order', { timeout: 180000 }, async (t) => {
  if (!(await needs(t, 'soffice', 'no LibreOffice'))) return;
  const out = await convert('benyehuda-5452-ani-maamin.docx', 'pdf');
  const text = bare(await S.pdfText(out));
  for (const [k, v] of Object.entries(POEM)) assert.ok(text.includes(v), `${k}: ${v}`);
  assert.ok(text.indexOf(POEM.line1) < text.indexOf(POEM.last), 'first line before the last');
});

test('Hebrew poem DOCX -> ODT: right-to-left paragraphs and the heading styles survive', { timeout: 180000 }, async (t) => {
  if (!(await needs(t, 'soffice', 'no LibreOffice'))) return;
  const out = await convert('benyehuda-5452-ani-maamin.docx', 'odt');
  const content = zipText(out, 'content.xml');
  const styles = content + zipText(out, 'styles.xml');
  assert.ok(bare(content.replace(/<[^>]+>/g, ' ')).includes(POEM.line1), 'text');
  assert.match(styles, /style:writing-mode="rl-tb"/, 'right-to-left paragraph style');
  assert.match(content, /<text:h [^>]*text:outline-level="1"/, 'the title is still a heading');
});

test('Hebrew poem DOCX -> TXT keeps the niqqud', { timeout: 180000 }, async (t) => {
  if (!(await needs(t, 'soffice', 'no LibreOffice'))) return;
  const out = await convert('benyehuda-5452-ani-maamin.docx', 'txt');
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.normalize('NFC').includes('אֲנִי מַאֲמִין'.normalize('NFC')), 'pointed title, exact');
  assert.ok(bare(text).includes(POEM.last));
});

test('Hebrew poem PDF -> TXT (Poppler) and -> PNG pages', { timeout: 180000 }, async (t) => {
  if (!(await needs(t, 'pdftotext', 'no poppler'))) return;
  const txt = await convert('benyehuda-5452-ani-maamin.pdf', 'txt');
  const text = bare(fs.readFileSync(txt, 'utf8'));
  for (const [k, v] of Object.entries(POEM)) assert.ok(text.includes(v), `${k}: ${v}`);
  const pages = await convert('benyehuda-5452-ani-maamin.pdf', 'png');
  const pngs = fs.readdirSync(pages).filter((n) => n.endsWith('.png'));
  assert.equal(pngs.length, 2, 'two pages, two images');
  for (const p of pngs) assert.equal(fs.readFileSync(path.join(pages, p)).subarray(1, 4).toString(), 'PNG');
});

test('Hebrew poem EPUB -> DOCX and -> TXT (Calibre): Hebrew text kept; paragraph RTL is the known limit', { timeout: 300000 }, async (t) => {
  if (!(await needs(t, 'calibre', 'no Calibre'))) return;
  const docx = await convert('benyehuda-5452-ani-maamin.epub', 'docx');
  const xml = zipText(docx, 'word/document.xml');
  assert.ok(bare(xml.replace(/<[^>]+>/g, ' ')).includes(POEM.line1));
  // The documented limit (KNOWN_LIMITS 'ebook>docx', backlog E4). If Calibre starts writing
  // right-to-left paragraphs, this fails: drop the limit and its note instead of keeping a stale one.
  assert.doesNotMatch(xml, /<w:bidi(?: w:val="(?:1|true)")?\s*\/>/, 'Calibre still drops paragraph RTL (known limit)');
  const txt = await convert('benyehuda-5452-ani-maamin.epub', 'txt');
  const text = bare(fs.readFileSync(txt, 'utf8'));
  assert.ok(text.indexOf(POEM.line1) >= 0 && text.indexOf(POEM.line1) < text.indexOf(POEM.last), 'in order');
});

test('IRS W-9 PDF (6 pages, form fields) -> TXT, -> JPG pages, -> DOCX', { timeout: 300000 }, async (t) => {
  if (!(await needs(t, 'pdftotext', 'no poppler'))) return;
  const text = fs.readFileSync(await convert('irs-form-w9-2024.pdf', 'txt'), 'utf8');
  assert.match(text, /Request for Taxpayer/);
  assert.match(text, /Identification Number and Certification/);
  const pages = fs.readdirSync(await convert('irs-form-w9-2024.pdf', 'jpg')).filter((n) => n.endsWith('.jpg'));
  assert.equal(pages.length, 6);
  if (!S.has('soffice')) return;
  const docx = await convert('irs-form-w9-2024.pdf', 'docx');
  assert.match(zipText(docx, 'word/document.xml').replace(/<[^>]+>/g, ''), /Taxpayer/);
});

test('Census XLSX (styled table, merged headers) -> CSV and -> ODS keep the numbers', { timeout: 180000 }, async (t) => {
  if (!(await needs(t, 'soffice', 'no LibreOffice'))) return;
  const csv = fs.readFileSync(await convert('census-nst-est2024-pop.xlsx', 'csv'), 'utf8');
  const us = csv.split(/\r?\n/).find((l) => l.startsWith('United States'));
  assert.ok(us, 'the United States row');
  const numbers = [...us.matchAll(/"([\d,]+)"|(\d+)/g)].map((m) => Number((m[1] || m[2]).replace(/,/g, ''))).filter((n) => n > 300e6);
  assert.ok(numbers.length >= 5, `population figures in that row: ${us}`);
  assert.ok(csv.split(/\r?\n/).some((l) => /^"?\.?Wyoming/.test(l)), 'the last state is there too');
  const ods = await convert('census-nst-est2024-pop.xlsx', 'ods');
  assert.match(zipText(ods, 'content.xml'), /United States/);
});

test('Gutenberg EPUB (12 chapters, cover image) -> TXT, -> AZW3 and -> PDF', { timeout: 600000 }, async (t) => {
  if (!(await needs(t, 'calibre', 'no Calibre'))) return;
  const text = fs.readFileSync(await convert('gutenberg-11-alice.epub', 'txt'), 'utf8');
  const first = text.search(/CHAPTER I\.\s+Down the Rabbit-Hole/);
  const last = text.lastIndexOf('CHAPTER XII.');
  assert.ok(first >= 0 && last > first && text.indexOf('THE END', last) > last, 'chapters I to XII in order, to THE END');
  const azw3 = await convert('gutenberg-11-alice.epub', 'azw3');
  assert.equal(fs.readFileSync(azw3).subarray(60, 68).toString(), 'BOOKMOBI');
  const pdf = await convert('gutenberg-11-alice.epub', 'pdf');
  assert.ok((await S.pdfPages(pdf)) > 20, 'a whole book, not a fragment');
  assert.match(await S.pdfText(pdf), /Rabbit/);
});

test('the corpus files were not modified by any conversion', () => {
  for (const [f, sha] of Object.entries(sources)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(CORPUS, f))).digest('hex'), sha, f);
});

