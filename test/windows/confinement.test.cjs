// D2 on real Windows, with the real bundled engines running confined by native/out/morph-confine.exe.
// Every check exercises an actual restricted process and looks at what the OS did: processes that
// are or are not there, files that did or did not change, connections a server did or did not see.
// Run by the "Bundled engines" CI job (MORPH_REQUIRE_PAYLOAD=1: nothing here may skip there).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { makeRichOdt, makeBigOdt, makePdf, makeZip } = require('../electron/helpers.cjs');
const { createStack } = require('../electron/engineStack.cjs');
const { createWorkspace } = require('../../electron/infra/JobWorkspace.cjs');
const { Confinement } = require('../../electron/infra/Confinement.cjs');
const { binRoots } = require('../../electron/infra/ToolRegistry.cjs');
const policy = require('../../electron/domain/confinementPolicy.cjs');

const BIN = path.join(__dirname, '..', '..', 'bin');
const HELPER = path.join(__dirname, '..', '..', 'native', 'out', 'morph-confine.exe');
const required = process.env.MORPH_REQUIRE_PAYLOAD === '1';
const available = process.platform === 'win32' && fs.existsSync(path.join(BIN, 'libreoffice')) && fs.existsSync(HELPER);
if (required) assert.ok(available, 'bin/ payload and native/out/morph-confine.exe required (MORPH_REQUIRE_PAYLOAD=1)');
const opts = { skip: !available && 'needs Windows, the bundled engines in bin/ and the built helper', timeout: 300000 };

const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
function processesUnder(sub) {
  const dir = path.join(BIN, sub).replace(/'/g, "''");
  const out = ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', 'OrdinalIgnoreCase') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`);
  return out ? out.split(/\r?\n/) : [];
}
const helpersOf = (pid) => {
  const out = ps(`Get-CimInstance Win32_Process -Filter "Name='morph-confine.exe' AND ParentProcessId=${pid}" | ForEach-Object { $_.ProcessId }`);
  return out ? out.split(/\r?\n/).map(Number) : [];
};
async function until(fn, ms = 60000, step = 100) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, step)); }
}
const noStaging = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('.~morph-'));
// Tests that count engine processes start from none, so a leftover is reported where it came from.
const startClean = (sub) => assert.deepEqual(processesUnder(sub), [], `no ${sub} process left over from an earlier test`);

let S;
test.before(async () => { if (!available) return; S = createStack('win-confine'); await S.tools.probe(); });
test.after(() => S?.stop());

// A scratch workspace like a job's, for calling engines directly through the registry.
const scratch = async (tag) => createWorkspace(`${tag}-${Date.now()}`, { root: path.join(S.root, 'ws') });
const run = (name, args, ws, o = {}) => S.tools.run(name, args, { timeoutMs: 120000, workspace: ws.dir, ...o });

test('confinement is enforced and every engine passed its probe confined', opts, () => {
  const st = S.tools.status();
  console.log('probe results:', JSON.stringify(st.details)); // printed before any assertion, for diagnosis
  assert.equal(st.confinement.mode, 'enforced', st.confinement.reason);
  for (const [name, d] of Object.entries(st.details)) assert.ok(d.ok, `${name}: ${d.reason}`);
  console.log('confinement per tool:', JSON.stringify(st.confinement.tools));
});

test('a confined engine cannot write outside its workspace: the OS denies it (canary unchanged)', opts, async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-canary-'));
  const canary = path.join(outside, 'canary.png');
  fs.writeFileSync(canary, 'CANARY');
  const ws = await scratch('canary');
  try {
    if (policy.tools.ffmpeg.isolation === 'appcontainer') {
      // ffmpeg's last line is only "Conversion failed!"; the proof is the canary and the control below.
      await assert.rejects(run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=d=1', '-frames:v', '1', '-f', 'image2', canary], ws));
      assert.equal(fs.readFileSync(canary, 'utf8'), 'CANARY', 'ffmpeg did not overwrite the canary');
      // Control: the same call into the workspace works, so the denial is the confinement.
      await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=d=1', '-frames:v', '1', '-f', 'image2', ws.file('inside.png')], ws);
      assert.ok(fs.statSync(ws.file('inside.png')).size > 0);
    }
    if (policy.tools.sevenzip.isolation === 'appcontainer') {
      const zip = makeZip(ws.file('a.zip'), [{ name: 'evil.txt', data: 'x' }]);
      await assert.rejects(run('sevenzip', ['x', '-y', `-o${outside}`, zip], ws));
      assert.deepEqual(fs.readdirSync(outside).sort(), ['canary.png'], '7-Zip extracted nothing outside the workspace');
    }
    // LibreOffice and Calibre (low integrity in the measured policy) are denied too: Windows refuses
    // a Low-integrity write to anything not labelled Low, whatever the folder's permissions say.
    fs.mkdirSync(ws.file('profile'));
    const odt = makeRichOdt(ws.file('in.odt'));
    // A refused write does not make LibreOffice exit; it waits until the deadline ends it (measured).
    await run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(ws.file('profile')).href}`, '--convert-to', 'pdf', '--outdir', outside, odt], ws, { write: [ws.file('profile')], timeoutMs: 60000 }).catch(() => {});
    assert.deepEqual(fs.readdirSync(outside).sort(), ['canary.png'], 'LibreOffice wrote nothing outside the workspace');
    // Control in a separate, fresh workspace (as every app conversion has): reusing the workspace
    // of the refused run, which was killed at its deadline, hung LibreOffice (runs 38688395176,
    // 38719799779).
    const wc = await scratch('canary-control');
    try {
      fs.mkdirSync(wc.file('profile'));
      const odt2 = makeRichOdt(wc.file('control.odt'));
      await run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(wc.file('profile')).href}`, '--convert-to', 'pdf', '--outdir', wc.file('out'), odt2], wc, { write: [wc.file('profile')], timeoutMs: 120000 });
      assert.ok(fs.existsSync(wc.file('out/control.pdf')), 'control: the same conversion into a workspace works');
    } finally { await wc.cleanup(); }
    // Calibre in its own workspace, as in the app (one engine family per job workspace; a workspace
    // used before by AppContainer and LibreOffice runs refused Calibre's appdata folder, run
    // 38722315865).
    const we = await scratch('canary-calibre');
    try {
      const epub = require('../electron/helpers.cjs').makeRichEpub(we.file('in.epub'));
      await run('calibre', [epub, path.join(outside, 'book.txt')], we, { timeoutMs: 120000 }).catch(() => {});
      assert.deepEqual(fs.readdirSync(outside).sort(), ['canary.png'], 'Calibre wrote nothing outside the workspace');
      await run('calibre', [epub, we.file('book.txt')], we, { timeoutMs: 300000 });
      assert.ok(fs.statSync(we.file('book.txt')).size > 0, 'control: Calibre converts into the workspace');
    } finally { await we.cleanup(); }
  } finally {
    // Contain a hang: no helper of this test may outlive it and disturb the process counts below.
    for (const pid of helpersOf(process.pid)) { try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F']); } catch { /* gone */ } }
    await ws.cleanup();
  }
});

test('a confined engine cannot read a file outside its workspace (the original), only the copy inside', opts, async () => {
  if (policy.tools.pdfinfo.isolation !== 'appcontainer') return;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-original-'));
  const original = await makePdf(path.join(outside, 'original.pdf'), 2);
  const ws = await scratch('read');
  try {
    await assert.rejects(run('pdfinfo', [original], ws, { captureStdout: true }), /denied|Couldn't open|Permission/i);
    fs.copyFileSync(original, ws.file('copy.pdf'));
    const r = await run('pdfinfo', [ws.file('copy.pdf')], ws, { captureStdout: true });
    assert.match(r.stdout, /Pages:\s+2/, 'the copy in the workspace is readable');
  } finally { await ws.cleanup(); }
});

test('a confined engine has no network: loopback and internet both fail, while the host can reach both', opts, async () => {
  if (policy.tools.ffmpeg.isolation !== 'appcontainer') return;
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/probe.txt`;
  const ws = await scratch('net');
  try {
    const control = await fetch(url).then((r) => r.text());
    assert.equal(control, 'hello', 'control: the server answers the host');
    // Control: ffmpeg itself runs confined, so a failure below is the network, not a broken engine.
    const v = await run('ffmpeg', ['-hide_banner', '-version'], ws, { captureStdout: true });
    assert.match(v.stdout, /ffmpeg version/, 'control: ffmpeg runs in the AppContainer');
    const before = hits;
    await assert.rejects(run('ffmpeg', ['-hide_banner', '-nostdin', '-rw_timeout', '5000000', '-i', url, '-f', 'null', '-'], ws));
    assert.equal(hits, before, 'the confined engine never reached the loopback server');
    const internet = await fetch('https://www.example.com/', { signal: AbortSignal.timeout(15000) }).then((r) => r.status, () => null);
    assert.ok(internet, 'control: the host itself reaches the internet (else this test proves nothing)');
    const e = await run('ffmpeg', ['-hide_banner', '-nostdin', '-rw_timeout', '8000000', '-i', 'https://www.example.com/', '-f', 'null', '-'], ws).then(() => null, (x) => x);
    assert.ok(e, 'the confined engine could not fetch from the internet');
    assert.doesNotMatch(e.message, /Server returned|Invalid data found/, `no HTTP response reached it: ${e.message}`);
  } finally { server.close(); await ws.cleanup(); }
});

test('the job owns LibreOffice\'s descendants: killing only the helper ends soffice.com and soffice.bin', opts, async () => {
  startClean('libreoffice');
  const ws = await scratch('own-lo');
  const big = makeBigOdt(ws.file('big.odt'));
  fs.mkdirSync(ws.file('profile'));
  try {
    const p = run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(ws.file('profile')).href}`, '--convert-to', 'pdf', '--outdir', ws.dir, big], ws, { timeoutMs: 600000, write: [ws.file('profile')] }).catch((e) => e);
    const during = await until(() => { const l = processesUnder('libreoffice'); return l.some((x) => /soffice\.bin/i.test(x)) ? l : null; }, 120000, 50);
    assert.ok(during, 'soffice.bin started');
    const helpers = helpersOf(process.pid);
    assert.equal(helpers.length, 1, 'one helper owns the call');
    execFileSync('taskkill', ['/pid', String(helpers[0]), '/F']); // the helper only, not its tree
    const left = await until(() => (processesUnder('libreoffice').length === 0 ? [] : null), 10000, 100);
    console.log('LibreOffice processes before the kill:', during.join(', '));
    assert.deepEqual(left, [], 'every LibreOffice process ended with the job (kill-on-close)');
    await p;
  } finally { await ws.cleanup(); }
});

test('Morph dying mid-conversion takes the engines with it; recovery leaves no staging; the next conversion works', opts, async () => {
  startClean('libreoffice');
  const root = S.dirOf('parent');
  const big = makeBigOdt(path.join(root, 'big.odt'));
  const child = spawn(process.execPath, [path.join(__dirname, 'confined-child.cjs'), root, big, 'pdf'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const during = await until(() => { const l = processesUnder('libreoffice'); return l.some((x) => /soffice\.bin/i.test(x)) ? l : null; }, 180000, 100);
  assert.ok(during, `soffice.bin started in the child (${out.slice(-300)})`);
  execFileSync('taskkill', ['/pid', String(child.pid), '/F']); // like a crash: no cleanup code runs in Morph
  const left = await until(() => (processesUnder('libreoffice').length === 0 && helpersOf(child.pid).length === 0 ? [] : null), 15000, 200);
  assert.deepEqual(left, [], 'no LibreOffice process and no helper outlived Morph');
  // Next start: the journal's leftovers are discarded, nothing was published.
  const { JobRepository } = require('../../electron/infra/repositories.cjs');
  const { discardLeftovers } = require('../../electron/infra/OutputPublisher.cjs');
  const journal = new JobRepository(path.join(root, 'state'));
  for (const r of journal.takeInterrupted()) await discardLeftovers(r.leftovers || []);
  assert.deepEqual(fs.readdirSync(root).filter((n) => !['big.odt', 'state', 'ws', 'lo-default', 'lo'].includes(n) && !n.startsWith('lo-')), [], 'no output');
  assert.deepEqual(noStaging(root), []);
  const u = await S.convert(makeRichOdt(path.join(S.dirOf('parent-after'), 'next.odt')), 'pdf');
  assert.equal(u.state, 'completed', u.error);
});

test('a memory limit stops the engine: job failed with limit-memory, nothing left, the next conversion works', opts, async () => {
  startClean('libreoffice');
  const L = createStack('win-confine-limit');
  try {
    await L.tools.probe(); // normal limits for the probes
    const low = new Confinement({ ownedRoots: binRoots(), limits: { ...policy.limits, soffice: { jobMemoryMb: policy.test.lowSofficeMemoryMb } } });
    L.tools.confinement = low;
    const dir = L.dirOf('limit');
    const big = makeBigOdt(path.join(dir, 'big.odt'));
    const u = await L.convert(big, 'pdf').catch((e) => ({ state: 'threw', error: e.message }));
    assert.equal(u.state, 'failed', `state ${u.state}`);
    assert.match(u.error, /limit-memory:soffice/);
    assert.deepEqual(fs.readdirSync(dir), ['big.odt'], 'no output');
    assert.deepEqual(noStaging(dir), []);
    assert.deepEqual(await until(() => (processesUnder('libreoffice').length === 0 ? [] : null), 10000, 200), [], 'no LibreOffice process left');
    L.tools.confinement = new Confinement({ ownedRoots: binRoots() });
    const ok = await L.convert(makeRichOdt(path.join(L.dirOf('limit-after'), 'next.odt')), 'pdf');
    assert.equal(ok.state, 'completed', ok.error);
  } finally { L.stop(); }
});

test('Calibre\'s descendants belong to the job too', opts, async () => {
  startClean('calibre');
  const ws = await scratch('own-calibre');
  const { makeZip: mz } = require('../electron/helpers.cjs');
  const para = (i) => `<p>Paragraph ${i}: שורה בעברית and enough English words to fill a line.</p>`;
  const xhtml = (n) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>C${n}</title></head><body><h1>Chapter ${n}</h1>${Array.from({ length: 80 }, (_, i) => para(i)).join('')}</body></html>`;
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">b</dc:identifier><dc:title>B</dc:title><dc:language>en</dc:language></metadata>'
    + `<manifest>${ids.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`;
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const book = mz(ws.file('big.epub'), [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: container }, { name: 'content.opf', data: opf }, ...ids.map((n) => ({ name: `c${n}.xhtml`, data: xhtml(n) }))]);
  try {
    const p = run('calibre', [book, ws.file('out.pdf')], ws, { timeoutMs: 600000 }).catch((e) => e);
    const during = await until(() => { const l = processesUnder('calibre'); return l.some((x) => /calibre-parallel|QtWebEngine/i.test(x)) ? l : null; }, 180000, 50);
    assert.ok(during, 'Calibre started a worker process');
    execFileSync('taskkill', ['/pid', String(helpersOf(process.pid)[0]), '/F']);
    const left = await until(() => (processesUnder('calibre').length === 0 ? [] : null), 10000, 100);
    console.log('Calibre processes before the kill:', during.join(', '));
    assert.deepEqual(left, [], 'every Calibre process ended with the job');
    await p;
  } finally { await ws.cleanup(); }
});

// Measured, then documented (docs/ARCHITECTURE.md, D2): what the OS enforces on volumes without
// security (FAT32/exFAT have no ACLs and no integrity labels). Recorded as evidence either way.
const measurements = [];
const recordMeasurement = (m) => { measurements.push(m); fs.writeFileSync(path.join(process.cwd(), 'confinement-measurements.json'), JSON.stringify(measurements, null, 2)); console.log('MEASURED', JSON.stringify(m)); };

for (const [label, env] of [['FAT32', 'MORPH_TEST_FAT32'], ['exFAT', 'MORPH_TEST_EXFAT']]) {
  test(`${label}: can a confined engine write to a volume without ACLs? (measured and recorded)`, { ...opts, skip: opts.skip || (!process.env[env] && !required && `${env} not set`) }, async () => {
    const vol = process.env[env];
    assert.ok(vol, `${env} required in CI`);
    const dir = path.join(vol, `morph-confine-${Date.now()}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'canary.png'), 'CANARY');
    const ws = await scratch(`vol-${label}`);
    try {
      const ff = await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=d=1', '-frames:v', '1', '-f', 'image2', path.join(dir, 'canary.png')], ws).then(() => 'written', (e) => `refused: ${e.message.slice(0, 120)}`);
      const ffChanged = fs.readFileSync(path.join(dir, 'canary.png'), 'utf8') !== 'CANARY';
      fs.writeFileSync(path.join(dir, 'canary.png'), 'CANARY');
      fs.mkdirSync(ws.file('profile'));
      const odt = makeRichOdt(ws.file('in.odt'));
      const lo = await run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(ws.file('profile')).href}`, '--convert-to', 'pdf', '--outdir', dir, odt], ws, { write: [ws.file('profile')], timeoutMs: 60000 }).then(() => 'exited', (e) => e.code || e.message.slice(0, 80));
      const loWrote = fs.existsSync(path.join(dir, 'in.pdf'));
      recordMeasurement({ volume: label, ffmpegAppContainer: { result: ff, canaryChanged: ffChanged }, libreofficeLowIntegrity: { result: lo, wroteOutput: loWrote } });
      assert.equal(ffChanged, ff === 'written', 'the canary changed exactly when ffmpeg reported success');
    } finally { await ws.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

// Stress conversions per engine: the peak job memory is recorded and must leave 2x headroom under
// the engine's limit (domain/confinementPolicy.cjs), so the limits cannot break files like these.
const peakMiB = (r) => Math.ceil((r.confinement?.peakJobMemory || 0) / 1048576);
async function stress(name, tool, fn) {
  const ws = await scratch(`stress-${name}`);
  try {
    const r = await fn(ws);
    const mib = peakMiB(r);
    const lim = policy.limits[tool].jobMemoryMb;
    recordMeasurement({ stress: name, tool, peakMiB: mib, limitMiB: lim, processes: r.confinement?.totalProcesses, peakActive: r.confinement?.peakActiveProcesses, userMs: r.confinement?.userMs });
    assert.ok(mib > 0, `${name}: a peak was measured`);
    assert.ok(mib * 2 <= lim, `${name}: ${mib} MiB peak leaves less than 2x headroom under the ${lim} MiB limit`);
  } finally { await ws.cleanup(); }
}

test('stress: ffmpeg 4K H.264 encode (adapter settings)', opts, () => stress('ffmpeg-4k-h264', 'ffmpeg', (ws) => run('ffmpeg',
  ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30', '-frames:v', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', ws.file('4k.mp4')], ws, { timeoutMs: 540000 })));

test('stress: ffmpeg 4K VP9 encode (adapter settings)', opts, () => stress('ffmpeg-4k-vp9', 'ffmpeg', (ws) => run('ffmpeg',
  ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30', '-frames:v', '10', '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', ws.file('4k.webm')], ws, { timeoutMs: 540000 })));

test('stress: LibreOffice 40,000-paragraph document to PDF', opts, () => stress('soffice-big', 'soffice', (ws) => {
  fs.mkdirSync(ws.file('profile'));
  const big = makeBigOdt(ws.file('big.odt'));
  return run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(ws.file('profile')).href}`, '--convert-to', 'pdf', '--outdir', ws.file('lo'), big], ws, { timeoutMs: 540000, write: [ws.file('profile')] });
}));

test('stress: Poppler A0 page at 200 dpi', opts, () => stress('pdftoppm-a0-200dpi', 'pdftoppm', async (ws) => {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([2384, 3370]);
  fs.writeFileSync(ws.file('a0.pdf'), await doc.save());
  return run('pdftoppm', ['-png', '-r', '200', '-singlefile', ws.file('a0.pdf'), ws.file('a0')], ws, { timeoutMs: 300000 });
}));

test('stress: 7-Zip 128 MiB into .7z at the default level', opts, () => stress('sevenzip-128mib', 'sevenzip', (ws) => {
  const fd = fs.openSync(ws.file('rand.bin'), 'w');
  for (let i = 0; i < 128; i++) fs.writeSync(fd, require('crypto').randomBytes(1 << 20));
  fs.closeSync(fd);
  return run('sevenzip', ['a', '-t7z', ws.file('rand.7z'), ws.file('rand.bin')], ws, { timeoutMs: 540000 });
}));

test('stress: Calibre 120-chapter book to PDF', opts, () => stress('calibre-big-pdf', 'calibre', (ws) => {
  const { makeZip: mz } = require('../electron/helpers.cjs');
  const para = (i) => `<p>Paragraph ${i}: שורה בעברית and enough English words to fill a line.</p>`;
  const xhtml = (n) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>C${n}</title></head><body><h1>Chapter ${n}</h1>${Array.from({ length: 80 }, (_, i) => para(i)).join('')}</body></html>`;
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">b</dc:identifier><dc:title>B</dc:title><dc:language>en</dc:language></metadata>'
    + `<manifest>${ids.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`;
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const book = mz(ws.file('big.epub'), [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: container }, { name: 'content.opf', data: opf }, ...ids.map((n) => ({ name: `c${n}.xhtml`, data: xhtml(n) }))]);
  return run('calibre', [book, ws.file('big.pdf')], ws, { timeoutMs: 540000 });
}));
