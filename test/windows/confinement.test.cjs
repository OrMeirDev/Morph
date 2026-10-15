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
const opts = { skip: !available && 'needs Windows, the bundled engines in bin/ and the built helper', timeout: 600000 };

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

let S;
test.before(async () => { if (!available) return; S = createStack('win-confine'); await S.tools.probe(); });
test.after(() => S?.stop());

// A scratch workspace like a job's, for calling engines directly through the registry.
const scratch = async (tag) => createWorkspace(`${tag}-${Date.now()}`, { root: path.join(S.root, 'ws') });
const run = (name, args, ws, o = {}) => S.tools.run(name, args, { timeoutMs: 120000, workspace: ws.dir, ...o });

test('confinement is enforced and every engine passed its probe confined', opts, () => {
  const st = S.tools.status();
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
      await assert.rejects(run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=d=1', '-frames:v', '1', '-f', 'image2', canary], ws), /denied|Permission|Error opening/i);
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
    if (policy.tools.soffice.isolation === 'appcontainer') {
      const odt = makeRichOdt(ws.file('in.odt'));
      await run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(ws.file('profile')).href}`, '--convert-to', 'pdf', '--outdir', outside, odt], ws).catch(() => {});
      assert.deepEqual(fs.readdirSync(outside).sort(), ['canary.png'], 'LibreOffice wrote nothing outside the workspace');
    }
  } finally { await ws.cleanup(); }
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
