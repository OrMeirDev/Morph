// E-books through Calibre, checked inside the output: text order and Hebrew, DOCX structure and
// metadata, PDF text and title, MOBI/AZW3 container versions and what a round trip reads back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readZip, zipText, makeRichEpub, makePdf, BOOK } = require('./helpers.cjs');
const { createStack } = require('./engineStack.cjs');
const { mobiVersion } = require('../../electron/infra/artifactValidator.cjs');

const S = createStack('ebooks');
test.after(() => S.stop());

let ready = null;
const calibre = async (t) => {
  ready = ready || S.tools.probe();
  await ready;
  if (!S.has('calibre')) { t.skip('no Calibre'); return false; }
  return true;
};
const ok = (u) => assert.equal(u.state, 'completed', u.error);
const fresh = (dir) => makeRichEpub(path.join(S.dirOf(dir), 'book.epub'));
const ordered = (text, parts) => {
  let at = -1;
  for (const p of parts) {
    const i = text.indexOf(p, at + 1);
    assert.ok(i > at, `"${p}" present and in order`);
    at = i;
  }
};
// The book's text in reading order: container.xml -> package document -> spine -> manifest hrefs
// (zip entry order says nothing about the order a reader shows).
function epubText(file) {
  const z = readZip(file);
  const opfPath = z.get('META-INF/container.xml').toString().match(/full-path="([^"]+)"/)[1];
  const opf = z.get(opfPath).toString();
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const hrefOf = Object.fromEntries([...opf.matchAll(/<item\b[^>]*>/g)].map(([tag]) => [tag.match(/\bid="([^"]+)"/)[1], tag.match(/\bhref="([^"]+)"/)[1]]));
  const spine = [...opf.match(/<spine[\s\S]*?<\/spine>/)[0].matchAll(/idref="([^"]+)"/g)].map((m) => m[1]);
  return spine.map((id) => z.get(base + decodeURIComponent(hrefOf[id]))?.toString('utf8') || '').join('\n');
}

test('e-book -> text: every block, in order, Hebrew intact, no markup', { timeout: 180000 }, async (t) => {
  if (!(await calibre(t))) return;
  const u = await S.convert(fresh('eb-txt'), 'txt');
  ok(u);
  const text = fs.readFileSync(u.output, 'utf8');
  ordered(text, [BOOK.ch1, BOOK.hebrew, `Plain and ${BOOK.bold} text.`, BOOK.ch2, BOOK.item, BOOK.tail]);
  assert.ok(!/[<>]/.test(text), 'no markup');
});

test('e-book -> DOCX: headings, bold, list, Hebrew text and book metadata', { timeout: 180000 }, async (t) => {
  if (!(await calibre(t))) return;
  const u = await S.convert(fresh('eb-docx'), 'docx');
  ok(u);
  const xml = zipText(u.output, 'word/document.xml');
  const styles = zipText(u.output, 'word/styles.xml');
  const paras = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(([, p]) => ({ p, text: [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('') }));
  for (const h of [BOOK.ch1, BOOK.ch2]) {
    assert.ok(paras.some((x) => x.text === h && /<w:pStyle w:val="Heading ?1"\/>/.test(x.p)), `${h} is a level-1 heading`);
  }
  const he = paras.find((x) => x.text === BOOK.hebrew);
  assert.ok(he, 'Hebrew paragraph whole');
  assert.match(he.p, /w:bidi="he"/, 'marked as Hebrew (complex-script language)');
  // Known Calibre limitation (seen with 7.6): the paragraph is not marked right-to-left
  // (<w:bidi/>), so Word lays it out left-to-right. Recorded, not asserted; see docs/FORMATS.md.
  t.diagnostic(`Hebrew paragraph right-to-left in DOCX: ${/<w:bidi(?: w:val="(?:1|true|on)")?\/>/.test(he.p)}`);
  const bold = paras.find((x) => x.text.includes(BOOK.bold));
  const run = bold.p.match(new RegExp(`<w:r>(?:(?!<w:r>).)*?${BOOK.bold}`))[0];
  const styleId = (run.match(/<w:rStyle w:val="([^"]+)"/) || [])[1];
  const isBold = /<w:b(?: w:val="(?:1|true|on)")?\/>/.test(run)
    || (styleId && new RegExp(`w:styleId="${styleId}"[\\s\\S]*?<w:b(?: w:val="(?:1|true|on)")?/>[\\s\\S]*?</w:style>`).test(styles.slice(styles.indexOf(`w:styleId="${styleId}"`))));
  assert.ok(isBold, 'bold run (direct or through its character style)');
  assert.ok(paras.some((x) => x.text === BOOK.item && /<w:numPr>/.test(x.p)), 'list item is a numbered/bulleted paragraph');
  const core = zipText(u.output, 'docProps/core.xml');
  assert.match(core, new RegExp(`<dc:title>${BOOK.title}</dc:title>`));
  assert.match(core, new RegExp(`<dc:creator>${BOOK.author}</dc:creator>`));
});

test('e-book -> PDF: text in order, Hebrew, title metadata', { timeout: 300000 }, async (t) => {
  if (!(await calibre(t))) return;
  const u = await S.convert(fresh('eb-pdf'), 'pdf');
  ok(u);
  if (!S.has('pdftotext')) return;
  const text = await S.pdfText(u.output);
  ordered(text, [BOOK.ch1, BOOK.bold, BOOK.ch2, BOOK.item, BOOK.tail]);
  assert.ok(/[א-ת]{3,}/.test(text), 'Hebrew text in the PDF');
  const info = (await S.tool('pdfinfo', [u.output], { captureStdout: true })).stdout;
  assert.match(info, new RegExp(`^Title:\\s+${BOOK.title}$`, 'm'));
  assert.ok(Number(info.match(/^Pages:\s+(\d+)/m)[1]) >= 2, 'chapters start on new pages');
});

test('e-book -> MOBI: Mobipocket 6 container that reads back as the same book', { timeout: 300000 }, async (t) => {
  if (!(await calibre(t))) return;
  const u = await S.convert(fresh('eb-mobi'), 'mobi');
  ok(u);
  const v = await mobiVersion(u.output);
  assert.ok(v !== null && v <= 6, `MOBI version ${v}`);
  assert.ok(fs.readFileSync(u.output).includes(Buffer.from(BOOK.title)), 'title stored in the book');
  const back = await S.convert(u.output, 'txt');
  ok(back);
  ordered(fs.readFileSync(back.output, 'utf8'), [BOOK.ch1, BOOK.hebrew, BOOK.bold, BOOK.ch2, BOOK.item, BOOK.tail]);
});

test('e-book -> AZW3 (KF8), detected as AZW3, and AZW3 -> EPUB reads back the book', { timeout: 300000 }, async (t) => {
  if (!(await calibre(t))) return;
  const u = await S.convert(fresh('eb-azw3'), 'azw3');
  ok(u);
  assert.equal(await mobiVersion(u.output), 8, 'KF8');
  const [det] = await S.intake.detectPaths([u.output]);
  assert.equal(det.ext, 'azw3');
  assert.equal(det.renamed, null, 'no false "renamed" warning');
  assert.ok(det.targets.includes('mobi') && !det.targets.includes('azw3'));
  const back = await S.convert(u.output, 'epub');
  ok(back);
  assert.equal(readZip(back.output).get('mimetype')?.toString(), 'application/epub+zip');
  const html = epubText(back.output);
  ordered(html.replace(/<[^>]+>/g, ' '), [BOOK.ch1, BOOK.hebrew, BOOK.bold, BOOK.ch2, BOOK.item, BOOK.tail]);
  assert.match(html, /<(b|strong)\b[^>]*>BoldWordMarker|class="[^"]*"[^>]*>BoldWordMarker/, 'bold kept as markup or a styled span');
});

test('PDF -> EPUB: a valid book with the page text', { timeout: 300000 }, async (t) => {
  if (!(await calibre(t))) return;
  const pdf = await makePdf(path.join(S.dirOf('pdf-epub'), 'paper.pdf'), 2);
  const u = await S.convert(pdf, 'epub');
  ok(u);
  const z = readZip(u.output);
  assert.equal(z.get('mimetype')?.toString(), 'application/epub+zip');
  assert.ok([...z.keys()].some((n) => n.endsWith('.opf')), 'package document');
  const text = epubText(u.output).replace(/<[^>]+>/g, ' ');
  ordered(text, ['Morph test 1', 'Morph test 2']);
});
