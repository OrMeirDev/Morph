// TEMPORARY measurement script for D2 (removed once the policy is fixed): runs each bundled engine
// through native/out/morph-confine.exe with and without an AppContainer and reports what works,
// what the OS denies, and how much memory/how many processes each engine uses.
// Windows only; needs bin/ (fetch-engines) and the built helper.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const H = require('../test/electron/helpers.cjs');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const HELPER = path.join(ROOT, 'native', 'out', 'morph-confine.exe');
const AC = 'Morph.Engines.Experiment';
const results = [];
const OUT = path.join(ROOT, 'confine-experiment.json');
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

function run(exe, args, { ac = true, read = [], write = [], cwd, env = {}, limits = {}, timeoutMs = 300000, parent } = {}) {
  const stats = path.join(os.tmpdir(), `mc-stats-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const h = [];
  if (ac) h.push('--appcontainer', AC);
  for (const r of read) h.push('--read', r);
  for (const w of write) h.push('--write', w);
  if (limits.jobMemory) h.push('--job-memory', String(limits.jobMemory));
  if (limits.maxProcesses) h.push('--max-processes', String(limits.maxProcesses));
  h.push('--parent', String(parent || process.pid), '--stats', stats);
  if (cwd) h.push('--cwd', cwd);
  h.push('--', exe, ...args);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(HELPER, h, { env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    const timer = setTimeout(() => { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* gone */ } }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let s = null;
      try { s = JSON.parse(fs.readFileSync(stats, 'utf8')); fs.rmSync(stats); } catch { /* none */ }
      resolve({ code, ms: Date.now() - t0, stats: s, out: out.slice(-1500), err: err.slice(-1500) });
    });
  });
}

function workspace(name) {
  const d = path.join(os.tmpdir(), 'mc-exp', name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.join(d, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(d, 'appdata'), { recursive: true });
  return d;
}
const envFor = (ws) => ({ TEMP: path.join(ws, 'tmp'), TMP: path.join(ws, 'tmp'), APPDATA: path.join(ws, 'appdata'), LOCALAPPDATA: path.join(ws, 'appdata'),
  CALIBRE_CONFIG_DIRECTORY: path.join(ws, 'appdata', 'calibre'), CALIBRE_TEMP_DIR: path.join(ws, 'tmp'), CALIBRE_CACHE_DIRECTORY: path.join(ws, 'tmp', 'cache') });

async function record(name, p, check = () => true) {
  const r = await p;
  const ok = !!check(r);
  const brief = { name, ok, code: r.code, ms: r.ms, outcome: r.stats?.outcome, error: r.stats?.error, peakJobMB: r.stats ? Math.round(r.stats.peakJobMemory / 1048576) : null,
    peakProcMB: r.stats ? Math.round(r.stats.peakProcessMemory / 1048576) : null, totalProcesses: r.stats?.totalProcesses, peakActive: r.stats?.peakActiveProcesses,
    grantMs: r.stats?.grantMs, orphansKilled: r.stats?.orphansKilled, unprotected: r.stats?.unprotected, sid: r.stats?.sid };
  if (!ok) { brief.out = r.out; brief.err = r.err; }
  results.push(brief);
  save();
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} :: code=${r.code} outcome=${brief.outcome} peakJob=${brief.peakJobMB}MB procs=${brief.totalProcesses}/${brief.peakActive} ${r.ms}ms grant=${brief.grantMs}ms ${ok ? '' : `\n     err: ${r.err.slice(-600)}\n     out: ${r.out.slice(-300)}`}`);
  return r;
}

const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };

async function main() {
  const ffmpeg = path.join(BIN, 'ffmpeg', 'ffmpeg.exe');
  const ffprobe = path.join(BIN, 'ffmpeg', 'ffprobe.exe');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-outside-'));
  const canary = path.join(outside, 'canary.txt');
  fs.writeFileSync(canary, 'CANARY');
  const original = path.join(outside, 'original.mp4');

  for (const ac of [true, false]) {
    const tag = ac ? 'ac' : 'job';
    // ---- ffmpeg ----
    let ws = workspace(`ffmpeg-${tag}`);
    const base = { ac, read: [path.join(BIN, 'ffmpeg')], write: [ws], cwd: ws, env: envFor(ws) };
    await record(`${tag} ffmpeg -version`, run(ffmpeg, ['-hide_banner', '-version'], base), (r) => r.code === 0);
    await record(`${tag} ffmpeg make test video`, run(ffmpeg, ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'testsrc=d=3:s=640x360', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path.join(ws, 'in.mp4')], base), () => exists(path.join(ws, 'in.mp4')));
    if (ac && exists(path.join(ws, 'in.mp4'))) fs.copyFileSync(path.join(ws, 'in.mp4'), original);
    await record(`${tag} ffmpeg mp4 -> webm`, run(ffmpeg, ['-hide_banner', '-nostdin', '-i', path.join(ws, 'in.mp4'), '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', path.join(ws, 'out.webm')], base), () => exists(path.join(ws, 'out.webm')));
    if (ac) {
      await record('ac ffmpeg cannot overwrite a canary outside the workspace', run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=d=1', '-frames:v', '1', '-f', 'image2', canary], base), (r) => r.code !== 0 && fs.readFileSync(canary, 'utf8') === 'CANARY');
      await record('ac ffprobe cannot read a file outside the workspace', run(ffprobe, ['-v', 'error', '-show_format', original], { ...base, read: [path.join(BIN, 'ffmpeg')] }), (r) => r.code !== 0 && /denied|Permission/i.test(r.err));
      await record('ac cmd.exe cannot append to the canary', run('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', `echo x>>"${canary}"`], base), (r) => r.code !== 0 && fs.readFileSync(canary, 'utf8') === 'CANARY');
      await record('ac cmd.exe can write inside its workspace', run('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', `echo x>"${path.join(ws, 'inside.txt')}"`], base), () => exists(path.join(ws, 'inside.txt')));
      // network: a local server that counts connections; and the internet
      let hits = 0;
      const server = http.createServer((req, res) => { hits++; res.writeHead(404); res.end(); });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      await record('ac ffmpeg cannot reach 127.0.0.1 (loopback)', run(ffmpeg, ['-hide_banner', '-nostdin', '-rw_timeout', '5000000', '-i', `http://127.0.0.1:${port}/x.mp4`, '-f', 'null', '-'], base), (r) => r.code !== 0 && hits === 0);
      const jobOnlyHits = hits;
      await record('job-only ffmpeg reaches 127.0.0.1 (control: proves the server works)', run(ffmpeg, ['-hide_banner', '-nostdin', '-rw_timeout', '5000000', '-i', `http://127.0.0.1:${port}/x.mp4`, '-f', 'null', '-'], { ...base, ac: false }), () => hits > jobOnlyHits);
      server.close();
      await record('ac ffmpeg cannot reach the internet (https://www.example.com)', run(ffmpeg, ['-hide_banner', '-nostdin', '-rw_timeout', '8000000', '-i', 'https://www.example.com/', '-f', 'null', '-'], base), (r) => r.code !== 0 && !/Invalid data found|Server returned 4/i.test(r.err));
      await record('job-only ffmpeg reaches the internet (control)', run(ffmpeg, ['-hide_banner', '-nostdin', '-rw_timeout', '8000000', '-i', 'https://www.example.com/', '-f', 'null', '-'], { ...base, ac: false }), (r) => /Invalid data found|Server returned|Stream|Input #0/i.test(r.err));
      for (const [label, dir] of [['FAT32', process.env.MORPH_TEST_FAT32], ['exFAT', process.env.MORPH_TEST_EXFAT]]) {
        if (!dir) continue;
        const c = path.join(dir, 'mc-canary.txt');
        fs.writeFileSync(c, 'CANARY');
        const r = await record(`ac cmd.exe append to a canary on ${label} (no ACLs on that volume)`, run('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', `echo x>>"${c}"`], base), () => true);
        results.at(-1).canaryChanged = fs.readFileSync(c, 'utf8') !== 'CANARY';
        console.log(`     ${label} canary changed: ${results.at(-1).canaryChanged} (code ${r.code})`);
        save();
      }
      await record('ac memory limit 64 MiB stops ffmpeg (limit-memory)', run(ffmpeg, ['-hide_banner', '-nostdin', '-i', path.join(ws, 'in.mp4'), '-c:v', 'libvpx-vp9', '-row-mt', '1', path.join(ws, 'limit.webm')], { ...base, limits: { jobMemory: 64 } }), (r) => r.stats?.outcome === 'limit-memory' && !exists(path.join(ws, 'limit.webm')) === false || r.stats?.outcome === 'limit-memory');
    }

    // ---- poppler ----
    ws = workspace(`poppler-${tag}`);
    const pdf = await H.makePdf(path.join(ws, 'in.pdf'), 3, 'Morph confine');
    const pb = { ac, read: [path.join(BIN, 'poppler')], write: [ws], cwd: ws, env: envFor(ws) };
    await record(`${tag} pdfinfo`, run(path.join(BIN, 'poppler', 'pdfinfo.exe'), [pdf], pb), (r) => r.code === 0 && /Pages:\s+3/.test(r.out));
    await record(`${tag} pdftotext`, run(path.join(BIN, 'poppler', 'pdftotext.exe'), ['-enc', 'UTF-8', pdf, path.join(ws, 'out.txt')], pb), () => exists(path.join(ws, 'out.txt')));
    await record(`${tag} pdftoppm`, run(path.join(BIN, 'poppler', 'pdftoppm.exe'), ['-png', '-r', '100', pdf, path.join(ws, 'page')], pb), () => fs.readdirSync(ws).some((n) => /^page.*\.png$/.test(n)));

    // ---- 7-Zip ----
    ws = workspace(`7zip-${tag}`);
    H.makeZip(path.join(ws, 'in.zip'), [{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: 'world' }]);
    const zb = { ac, read: [path.join(BIN, '7zip')], write: [ws], cwd: ws, env: envFor(ws) };
    await record(`${tag} 7z list`, run(path.join(BIN, '7zip', '7z.exe'), ['l', '-slt', '-ba', path.join(ws, 'in.zip')], zb), (r) => r.code === 0 && /a\.txt/.test(r.out));
    await record(`${tag} 7z extract`, run(path.join(BIN, '7zip', '7z.exe'), ['x', '-y', `-o${path.join(ws, 'content')}`, path.join(ws, 'in.zip')], zb), () => exists(path.join(ws, 'content', 'dir', 'b.txt')));
    await record(`${tag} 7z pack 7z`, run(path.join(BIN, '7zip', '7z.exe'), ['a', '-t7z', path.join(ws, 'out.7z'), '*'], { ...zb, cwd: path.join(ws, 'content') }), () => exists(path.join(ws, 'out.7z')));

    // ---- LibreOffice ----
    ws = workspace(`lo-${tag}`);
    const prof = path.join(ws, 'profile');
    fs.mkdirSync(prof);
    const soffice = path.join(BIN, 'libreoffice', 'program', 'soffice.com');
    const lb = { ac, read: [path.join(BIN, 'libreoffice')], write: [ws], cwd: ws, env: envFor(ws) };
    const purl = `-env:UserInstallation=${pathToFileURL(prof).href}`;
    await record(`${tag} soffice --version`, run(soffice, ['--headless', '--version'], lb), (r) => /LibreOffice/.test(r.out));
    await record(`${tag} soffice first start (profile)`, run(soffice, ['--headless', '--norestore', '--nologo', purl, '--terminate_after_init'], lb), () => exists(path.join(prof, 'user', 'registrymodifications.xcu')));
    H.makeRichOdt(path.join(ws, 'in.odt'));
    fs.mkdirSync(path.join(ws, 'out'));
    await record(`${tag} soffice odt -> pdf`, run(soffice, ['--headless', '--norestore', '--nologo', purl, '--convert-to', 'pdf', '--outdir', path.join(ws, 'out'), path.join(ws, 'in.odt')], lb), () => exists(path.join(ws, 'out', 'in.pdf')));
    await record(`${tag} soffice odt -> docx`, run(soffice, ['--headless', '--norestore', '--nologo', purl, '--convert-to', 'docx:MS Word 2007 XML', '--outdir', path.join(ws, 'out'), path.join(ws, 'in.odt')], lb), () => exists(path.join(ws, 'out', 'in.docx')));
    H.makeBigOdt(path.join(ws, 'big.odt'), 40000);
    await record(`${tag} soffice big odt (40000 paragraphs) -> pdf (peak memory)`, run(soffice, ['--headless', '--norestore', '--nologo', purl, '--convert-to', 'pdf', '--outdir', path.join(ws, 'out'), path.join(ws, 'big.odt')], lb), () => exists(path.join(ws, 'out', 'big.pdf')));

    // ---- Calibre ----
    ws = workspace(`calibre-${tag}`);
    const book = H.makeRichEpub(path.join(ws, 'in.epub'));
    const cb = { ac, read: [path.join(BIN, 'calibre')], write: [ws], cwd: ws, env: envFor(ws) };
    const ec = path.join(BIN, 'calibre', 'ebook-convert.exe');
    await record(`${tag} ebook-convert --version`, run(ec, ['--version'], cb), (r) => /calibre/.test(r.out));
    for (const t of ['txt', 'docx', 'azw3', 'mobi', 'pdf']) {
      await record(`${tag} ebook-convert epub -> ${t}`, run(ec, [book, path.join(ws, `out.${t}`)], cb), () => exists(path.join(ws, `out.${t}`)));
    }
    if (ac) {
      // The same with Chromium's own sandbox off: Qt WebEngine inside an AppContainer.
      await record('ac ebook-convert epub -> pdf with QTWEBENGINE_DISABLE_SANDBOX=1', run(ec, [book, path.join(ws, 'out-nosb.pdf')], { ...cb, env: { ...envFor(ws), QTWEBENGINE_DISABLE_SANDBOX: '1' } }), () => exists(path.join(ws, 'out-nosb.pdf')));
    }
  }

  // Parent death: the helper's parent is a short-lived node; LibreOffice must be gone after it dies.
  const ws = workspace('parent');
  const prof = path.join(ws, 'profile');
  fs.mkdirSync(prof);
  H.makeBigOdt(path.join(ws, 'big.odt'), 40000);
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
  const p = run(path.join(BIN, 'libreoffice', 'program', 'soffice.com'), ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(prof).href}`, '--convert-to', 'pdf', '--outdir', ws, path.join(ws, 'big.odt')],
    { ac: true, read: [path.join(BIN, 'libreoffice')], write: [ws], cwd: ws, env: envFor(ws), parent: sleeper.pid });
  const lo = () => execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${path.join(BIN, 'libreoffice')}*' } | ForEach-Object { $_.Name }`], { encoding: 'utf8' }).trim();
  let seen = '';
  for (let i = 0; i < 100 && !/soffice\.bin/.test(seen); i++) { await new Promise((r) => setTimeout(r, 300)); seen = lo(); }
  execFileSync('taskkill', ['/pid', String(sleeper.pid), '/F']);
  const r = await p;
  await new Promise((res) => setTimeout(res, 1000));
  const left = lo();
  results.push({ name: 'parent killed -> job ended', ok: /soffice\.bin/.test(seen) && !left && r.stats?.outcome === 'parent-gone', seen, left, outcome: r.stats?.outcome });
  console.log(JSON.stringify(results.at(-1)));
  save();
}

main().catch((e) => { console.error(e); results.push({ name: 'script', ok: false, error: e.stack }); save(); process.exitCode = 1; });
