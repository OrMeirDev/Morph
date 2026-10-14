// Windows-only checks against the real bundled engines in bin/ (fetched by scripts/fetch-engines.cjs).
// Run in CI by the "Bundled engines" job; every test fails (never skips) there if bin/ is missing,
// because MORPH_REQUIRE_PAYLOAD=1. On other machines the file skips as a whole.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeRichOdt, makeRichEpub, makeBigOdt } = require('../electron/helpers.cjs');
const { createStack } = require('../electron/engineStack.cjs');
const { OfficeProfileManager } = require('../../electron/infra/OfficeProfileManager.cjs');

const BIN = path.join(__dirname, '..', '..', 'bin');
const required = process.env.MORPH_REQUIRE_PAYLOAD === '1';
const available = process.platform === 'win32' && fs.existsSync(path.join(BIN, 'libreoffice'));
if (required) assert.ok(available, 'bin/ payload required (MORPH_REQUIRE_PAYLOAD=1) but missing or not on Windows');
const opts = { skip: !available && 'needs Windows and the bundled engines in bin/', timeout: 600000 };

// Processes whose executable lives under the given bin/ subfolder (path match, not just names).
function processesUnder(sub) {
  const dir = path.join(BIN, sub).replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', 'OrdinalIgnoreCase') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  return out ? out.split(/\r?\n/) : [];
}
async function until(fn, ms = 60000, step = 100) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, step)); }
}

// Starts a conversion, waits until the engine's real worker process is running (matched by
// `worker`), presses Stop at once, and reports what ran and what is left. The process list seen at
// that moment is the evidence; a conversion that finished first ends 'completed' and fails the test.
async function cancelMidway(S, file, target, sub, worker) {
  const [d] = await S.intake.detectPaths([file]);
  assert.ok(d.ok, d.error);
  assert.ok(S.coordinator.enqueue({ fileId: d.id, target }).ok);
  const during = await until(() => {
    const procs = processesUnder(sub);
    return procs.some((p) => worker.test(p)) ? procs : null;
  }, 120000, 50);
  S.coordinator.cancel(d.id);
  await S.coordinator.whenIdle();
  const left = await until(() => (processesUnder(sub).length === 0 ? [] : null), 15000, 250);
  return { update: S.lastUpdate(d.id), during: during || [], left: left ?? processesUnder(sub) };
}

// A book long enough that rendering it to PDF keeps Calibre busy for many seconds.
function makeBigEpub(file, chapters = 120) {
  const { makeZip } = require('../electron/helpers.cjs');
  const para = (i) => `<p>Paragraph ${i}: שורה בעברית and enough English words to fill a line of the rendered page with text.</p>`;
  const xhtml = (n) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>C${n}</title></head><body><h1>Chapter ${n}</h1>${Array.from({ length: 80 }, (_, i) => para(i)).join('')}</body></html>`;
  const ids = Array.from({ length: chapters }, (_, i) => i + 1);
  const opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">big-book</dc:identifier><dc:title>Big Book</dc:title><dc:language>en</dc:language></metadata>'
    + `<manifest>${ids.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`;
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  return makeZip(file, [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: container }, { name: 'content.opf', data: opf }, ...ids.map((n) => ({ name: `c${n}.xhtml`, data: xhtml(n) }))]);
}

const noStaging = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('.~morph-'));

test('Stop during a LibreOffice conversion ends soffice.com and soffice.bin; no output, no staging', opts, async () => {
  const S = createStack('win-lo-cancel');
  try {
    await S.tools.probe();
    const dir = S.dirOf('big');
    const file = makeBigOdt(path.join(dir, 'big.odt'));
    const r = await cancelMidway(S, file, 'pdf', 'libreoffice', /soffice\.bin/i);
    console.log('LibreOffice processes while converting:', r.during.join(', '));
    assert.equal(r.update.state, 'cancelled');
    assert.ok(r.during.some((p) => /soffice\.bin/i.test(p)), 'soffice.bin (the real worker) was running');
    assert.deepEqual(r.left, [], 'no LibreOffice process left');
    assert.deepEqual(fs.readdirSync(dir), ['big.odt'], 'no output');
    assert.deepEqual(noStaging(dir), []);
    // The profile survived the kill: the next conversion works.
    const small = makeRichOdt(path.join(S.dirOf('after'), 'small.odt'));
    const u = await S.convert(small, 'pdf');
    assert.equal(u.state, 'completed', u.error);
  } finally { S.stop(); }
});

test('Stop during a Calibre conversion ends ebook-convert and its helpers; no output', opts, async () => {
  const S = createStack('win-cal-cancel');
  try {
    await S.tools.probe();
    const dir = S.dirOf('book');
    const file = makeBigEpub(path.join(dir, 'book.epub'));
    const r = await cancelMidway(S, file, 'pdf', 'calibre', /ebook-convert|calibre-parallel/i);
    console.log('Calibre processes while converting:', r.during.join(', '));
    assert.ok(r.during.some((p) => /ebook-convert|calibre-parallel/i.test(p)), 'Calibre was still converting when Stop was pressed');
    assert.equal(r.update.state, 'cancelled');
    assert.deepEqual(r.left, [], 'no Calibre process left (ebook-convert, calibre-parallel, QtWebEngineProcess)');
    assert.deepEqual(fs.readdirSync(dir), ['book.epub']);
    assert.deepEqual(noStaging(dir), []);
  } finally { S.stop(); }
});

test('Office profile: a first start cancelled midway, then a damaged profile, both recover', opts, async () => {
  const S = createStack('win-lo-profile');
  try {
    await S.tools.probe();
    const base = path.join(S.root, 'prof');
    S.coordinator.officeProfiles = new OfficeProfileManager({ baseDir: base });
    const file = makeRichOdt(path.join(S.dirOf('p'), 'letter.odt'));
    // Stop while the profile's first start (soffice --terminate_after_init) is running: the test
    // presses Stop half a second after that very command starts.
    const [d] = await S.intake.detectPaths([file]);
    const runTool = S.coordinator.runTool;
    S.coordinator.runTool = (name, args, o) => {
      const p = runTool(name, args, o);
      if (args.includes('--terminate_after_init')) setTimeout(() => S.coordinator.cancel(d.id), 500);
      return p;
    };
    S.coordinator.enqueue({ fileId: d.id, target: 'pdf' });
    await S.coordinator.whenIdle();
    S.coordinator.runTool = runTool;
    assert.equal(S.lastUpdate(d.id).state, 'cancelled');
    const profileDir = S.coordinator.officeProfiles.profileDirFor(S.tools.path('soffice'));
    assert.equal(OfficeProfileManager.healthy(profileDir), false, 'an interrupted first start is never marked ready');
    assert.deepEqual(processesUnder('libreoffice'), [], 'the interrupted first start left no process');
    let u = await S.convert(file, 'docx');
    assert.equal(u.state, 'completed', `after a cancelled first start: ${u.error}`);
    assert.equal(OfficeProfileManager.healthy(profileDir), true);
    // Damage the profile the way an interrupted first start did (tiny registry).
    fs.writeFileSync(path.join(profileDir, 'user', 'registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"/>');
    u = await S.convert(file, 'rtf');
    assert.equal(u.state, 'completed', `after a damaged profile: ${u.error}`);
    assert.equal(OfficeProfileManager.healthy(profileDir), true, 'rebuilt');
  } finally { S.stop(); }
});

test('Office profile path at the 100-character limit works; over it falls back to the short path', opts, async () => {
  const S = createStack('win-lo-limit');
  try {
    await S.tools.probe();
    const { MAX_PROFILE_PATH } = require('../../electron/infra/OfficeProfileManager.cjs');
    // The base gets "-xxxxxx" appended, so a base of MAX - 8 characters is the longest accepted.
    let base = path.join(os.tmpdir(), 'מורף');
    while (base.length < MAX_PROFILE_PATH - 8) base += 'א';
    base = base.slice(0, MAX_PROFILE_PATH - 8);
    const atLimit = new OfficeProfileManager({ baseDir: base });
    assert.equal(atLimit.baseDir, base, 'accepted as is');
    S.coordinator.officeProfiles = atLimit;
    const file = makeRichOdt(path.join(S.dirOf('limit'), 'letter.odt'));
    const u = await S.convert(file, 'pdf');
    assert.equal(u.state, 'completed', `profile path of ${atLimit.profileDirFor(S.tools.path('soffice')).length} characters: ${u.error}`);
    const over = new OfficeProfileManager({ baseDir: `${base}אאאאאאאאאאאא` });
    assert.notEqual(over.baseDir, `${base}אאאאאאאאאאאא`, 'too long: falls back');
    assert.ok(over.baseDir.length <= MAX_PROFILE_PATH);
    S.coordinator.officeProfiles = over;
    const v = await S.convert(file, 'docx');
    assert.equal(v.state, 'completed', v.error);
  } finally { S.stop(); }
});

test('Hebrew folder names and long paths through every engine', opts, async () => {
  const S = createStack('win-paths');
  try {
    await S.tools.probe();
    // A Hebrew user-like folder and a path near (not over) MAX_PATH once outputs are added.
    let dir = path.join(S.root, 'משתמש עברי', 'מסמכים וקבצים');
    const pad = 'תיקייה-ארוכה-מאוד-';
    while (dir.length < 200) dir = path.join(dir, pad);
    fs.mkdirSync(dir, { recursive: true });
    console.log('path length', dir.length);
    // The LibreOffice profile under a Hebrew base folder, within the 100-character rule.
    const profBase = path.join(os.tmpdir(), 'מורף-פרופיל');
    S.coordinator.officeProfiles = new OfficeProfileManager({ baseDir: profBase });
    const { makePng, makeWav, makePdf, makeZip } = require('../electron/helpers.cjs');
    const cases = [
      [await makePng(path.join(dir, 'תמונה.png')), 'webp'],
      [makeWav(path.join(dir, 'צליל.wav')), 'mp3'],
      [await makePdf(path.join(dir, 'מסמך.pdf'), 1), 'png'],
      [makeRichOdt(path.join(dir, 'מכתב.odt')), 'docx'],
      [makeRichEpub(path.join(dir, 'ספר.epub')), 'mobi'],
      [makeZip(path.join(dir, 'ארכיון.zip'), [{ name: 'קובץ.txt', data: 'שלום' }]), '7z'],
    ];
    for (const [file, target] of cases) {
      const u = await S.convert(file, target);
      assert.equal(u.state, 'completed', `${path.basename(file)} -> ${target}: ${u.error}`);
      assert.ok(u.output.startsWith(dir), 'published next to the original');
      assert.ok(fs.statSync(u.output).size > 0);
    }
  } finally { S.stop(); }
});

// Output publication on other file systems. The CI job prepares them (FAT32 and exFAT virtual
// disks, an SMB share on this machine) and passes their roots; the job requires all three.
for (const [name, env] of [['FAT32', 'MORPH_TEST_FAT32'], ['exFAT', 'MORPH_TEST_EXFAT'], ['SMB share', 'MORPH_TEST_SMB']]) {
  const root = process.env[env];
  test(`publication on ${name}: free names, no overwrite, no leftovers`, { ...opts, skip: opts.skip || (!root && !required && `${env} not set`) }, async () => {
    assert.ok(root, `${env} must point at a prepared ${name} folder`);
    const S = createStack(`win-fs-${name.replace(/\W/g, '')}`);
    try {
      await S.tools.probe();
      const dir = path.join(root, `morph-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const { makePng } = require('../electron/helpers.cjs');
      const png = await makePng(path.join(dir, 'pic.png'));
      fs.writeFileSync(path.join(dir, 'pic.webp'), 'EXISTING');
      const a = await S.convert(png, 'webp');
      const b = await S.convert(png, 'webp');
      assert.equal(a.state, 'completed', a.error);
      assert.equal(b.state, 'completed', b.error);
      assert.deepEqual([path.basename(a.output), path.basename(b.output)], ['pic (1).webp', 'pic (2).webp']);
      assert.equal(fs.readFileSync(path.join(dir, 'pic.webp'), 'utf8'), 'EXISTING');
      assert.deepEqual(noStaging(dir), []);
    } finally { S.stop(); }
  });
}
