// Local Windows validation of a packaged Morph (win-unpacked) on a desktop, driven over the
// DevTools protocol like packaged-smoke.cjs (no test hooks: the page's own window.morph API), in
// an isolated profile: APPDATA, LOCALAPPDATA, TEMP and TMP all point under --root, so the user's
// own Morph installation, settings and history are never read or written.
//
//   node e2e/local-windows-check.cjs <Morph.exe> [--root <dir>] [--report <file>] [--port <n>]
//
// Checks (each recorded pass / fail with its evidence):
//   startup: version, every engine verified, confinement enforced
//   detection: content classification of every fixture (incl. a renamed file); no Morph process
//     command line ever names the fixture folder (the confined detector and engines get copies or
//     byte ranges, never the original path)
//   conversions through intake + coordinator, outputs checked by content (not only exit code):
//     sharp, LibreOffice (Hebrew DOCX -> PDF, XLSX -> CSV), Calibre (EPUB -> MOBI, EPUB -> DOCX),
//     Poppler (PDF -> TXT, PDF -> PNG), FFmpeg (audio, video), 7-Zip (ZIP -> 7Z); Hebrew names,
//     spaces, a long path, an existing output name
//   cancellation (image worker, LibreOffice, Calibre): the worker seen running (PID + creation
//     time + executable), Stop through the app, no output, original unchanged, workspace removed,
//     the job's helper and descendants gone, the next conversion works
//   parent death: only Morph.exe killed during a LibreOffice conversion; its descendants end; the
//     next start sweeps the job and converts
//   show in Explorer for an output
// Exit code 1 when a check fails.
const { spawn, execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findPage, connect, wait } = require('./cdp.cjs');
const h = require('../test/electron/helpers.cjs');

const args = process.argv.slice(2);
const exe = path.resolve(args[0] || '');
const opt = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : null; };
const PORT = Number(opt('--port') || 9341);
const ROOT = path.resolve(opt('--root') || path.join(os.tmpdir(), `morph-local-check-${Date.now()}`));
const BIN = path.join(path.dirname(exe), 'resources', 'bin');
const FILES = path.join(ROOT, 'files');
const HE = path.join(FILES, 'קבצים עם רווחים');
const TMP = path.join(ROOT, 'tmp');
const ENV = { ...process.env, APPDATA: path.join(ROOT, 'appdata'), LOCALAPPDATA: path.join(ROOT, 'localappdata'), TEMP: TMP, TMP };
const CORPUS = path.join(__dirname, '..', 'test', 'corpus');
// Electron finds userData through the shell's known folder, not APPDATA: the switch is what isolates
// it (without it, a test run wrote into the user's own %APPDATA%\Morph; measured).
const USER_DATA = path.join(ENV.APPDATA, 'Morph');
const REAL_PROFILE = path.join(os.homedir(), 'AppData', 'Roaming', 'Morph');
const readJournal = () => { try { return JSON.parse(fs.readFileSync(path.join(USER_DATA, 'jobs.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { active: {} }; throw e; } };
function profileStamp() {
  if (!fs.existsSync(REAL_PROFILE)) return {};
  return Object.fromEntries(fs.readdirSync(REAL_PROFILE).map((n) => [n, fs.statSync(path.join(REAL_PROFILE, n)).mtimeMs]));
}

const results = [];
function record(id, name, status, detail = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ id, name, status, detail: d });
  console.log(`[${status}] ${id} ${name}${d ? ` :: ${d.slice(0, 600)}` : ''}`);
}
const pass = (id, name, ok, detail) => record(id, name, ok ? 'pass' : 'fail', detail);

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const bare = (s) => s.normalize('NFC').replace(/[֑-ׇ‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, '');
const POEM = { title: 'אנימאמין', byline: 'מאתשאולטשרניחובסקי', line1: 'שחקי,שחקיעלהחלומות', last: 'פרחיםילקטולזר' };
async function until(fn, ms, step = 250) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(step); }
}
const tool = (rel, a, o = {}) => execFileSync(path.join(BIN, rel), a, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...o });

// ---------- processes: identity = PID + creation time + executable ----------
const PS_PROCS = "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=$_.Name; exe=$_.ExecutablePath; created=$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }); cmd=$_.CommandLine } }) | ConvertTo-Json -Compress -Depth 2";
const seenCmdLines = new Map(); // every Morph descendant ever observed: key -> command line
function snapshot() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_PROCS], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const list = JSON.parse(out);
  return Array.isArray(list) ? list : [list];
}
const key = (p) => `${p.pid}|${p.created}|${String(p.exe || p.name).toLowerCase()}`;
const brief = (p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, created: p.created, exe: p.exe });
// The process and its descendants; a child must be newer than its parent (a reused PID is not one).
function tree(list, rootPid, rootCreated) {
  const byParent = new Map();
  for (const p of list) { if (!byParent.has(p.ppid)) byParent.set(p.ppid, []); byParent.get(p.ppid).push(p); }
  const root = list.find((p) => p.pid === rootPid && (!rootCreated || p.created === rootCreated));
  if (!root) return [];
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    for (const c of byParent.get(out[i].pid) || []) {
      if (c.pid === out[i].pid || (c.created && out[i].created && c.created < out[i].created)) continue;
      out.push(c);
    }
  }
  for (const p of out) seenCmdLines.set(key(p), p.cmd || '');
  return out;
}
const alive = (procs) => { const now = new Set(snapshot().map(key)); return procs.filter((p) => now.has(key(p))); };
const underDir = (p, dir) => !!p.exe && p.exe.toLowerCase().startsWith(dir.toLowerCase() + path.sep);

function appContainerJobProfiles() {
  const ps = "$m='HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings'; @(Get-ChildItem $m -ErrorAction SilentlyContinue | ForEach-Object { (Get-ItemProperty $_.PSPath).Moniker } | Where-Object { $_ -like 'Morph.Job.*' }).Count";
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim());
}

// ---------- the app ----------
async function launch() {
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`], { env: ENV, stdio: 'ignore' });
  const page = await findPage(PORT, { timeoutMs: 90000 });
  if (!page) throw new Error('the app window did not open');
  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  for (let i = 0; i < 300 && !(await c.evaluate('!!document.querySelector(".nav-item")')); i++) await wait(100);
  await c.evaluate('window.__u = {}; window.morph.onJobUpdate((u) => { (window.__u[u.fileId] = window.__u[u.fileId] || []).push(u); }); true');
  const me = snapshot().find((p) => p.pid === child.pid);
  return { child, c, created: me?.created };
}
async function quit(app) {
  try { app.c.close(); } catch { /* closed */ }
  spawnSync('taskkill', ['/PID', String(app.child.pid), '/T', '/F'], { stdio: 'ignore' });
  await until(() => findPage(PORT, { timeoutMs: 500 }).then((p) => !p), 15000, 500);
}
const js = (v) => JSON.stringify(v);
const detect = (app, paths) => app.c.evaluate(`window.morph.detect(${js(paths)})`);
const updates = (app, id) => app.c.evaluate(`window.__u[${js(id)}] || []`);
const TERMINAL = ['completed', 'failed', 'cancelled'];
async function waitTerminal(app, id, from, ms = 600000) {
  return until(async () => { const u = (await updates(app, id)).slice(from); const l = u[u.length - 1]; return l && TERMINAL.includes(l.state) ? l : null; }, ms, 300);
}
async function convert(app, file, target) {
  const [d] = await detect(app, [file]);
  if (!d.ok) return { d, final: { state: 'not-detected', error: `${d.error} ${(d.missing || []).join(',')}` } };
  if (!d.targets.includes(target)) return { d, final: { state: 'not-offered', error: `${target} not in ${d.targets.join(',')}` } };
  const from = (await updates(app, d.id)).length;
  const r = await app.c.evaluate(`window.morph.enqueue(${js(d.id)}, ${js(target)})`);
  if (!r.ok) return { d, final: { state: 'refused', error: r.error } };
  return { d, final: (await waitTerminal(app, d.id, from)) || { state: 'timeout' } };
}

// ---------- fixtures (copies only; hashes recorded before and after) ----------
function longDir() {
  let dir = path.join(FILES, 'נתיב ארוך');
  while (dir.length < 175) dir = path.join(dir, 'תיקייה עם שם ארוך לבדיקה');
  return dir;
}
async function makeFixtures() {
  for (const d of [HE, TMP, ENV.APPDATA, ENV.LOCALAPPDATA]) fs.mkdirSync(d, { recursive: true });
  const f = {};
  f.png = await h.makePng(path.join(HE, 'תמונה לבדיקה.png'), { width: 64, height: 48, alpha: true });
  f.renamed = path.join(HE, 'תמונה בשם אחר.jpg');
  fs.copyFileSync(f.png, f.renamed);
  const cp = (name, as) => { const to = path.join(HE, as); fs.copyFileSync(path.join(CORPUS, name), to); return to; };
  f.docx = cp('benyehuda-5452-ani-maamin.docx', 'שיר בעברית.docx');
  f.xlsx = cp('census-nst-est2024-pop.xlsx', 'נתוני אוכלוסייה.xlsx');
  f.epub = cp('gutenberg-11-alice.epub', 'אליס בארץ הפלאות.epub');
  f.hebEpub = cp('benyehuda-5452-ani-maamin.epub', 'ספר שירה.epub');
  f.pdf = cp('irs-form-w9-2024.pdf', 'טופס W9.pdf');
  f.hebPdf = cp('benyehuda-5452-ani-maamin.pdf', 'שיר כ-PDF.pdf');
  f.wav = h.makeWav(path.join(HE, 'צליל קצר.wav'), { seconds: 2, rate: 22050 });
  f.mp4 = path.join(HE, 'סרטון קצר.mp4');
  tool('ffmpeg/ffmpeg.exe', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f.mp4]);
  f.zip = h.makeZip(path.join(HE, 'ארכיון לבדיקה.zip'), [{ name: 'קובץ.txt', data: 'שלום' }, { name: 'folder/b.txt', data: 'b' }]);
  const ld = longDir();
  fs.mkdirSync(ld, { recursive: true });
  f.longPng = await h.makePng(path.join(ld, 'תמונה בנתיב ארוך.png'), { width: 32, height: 32 });
  // long work, for cancellation
  const big = path.join(FILES, 'ארוכים');
  fs.mkdirSync(big, { recursive: true });
  const sharp = require('sharp');
  f.bigPng = path.join(big, 'תמונה גדולה.png');
  await sharp({ create: { width: 6000, height: 6000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png({ compressionLevel: 1 }).toFile(f.bigPng);
  f.bigOdt = h.makeBigOdt(path.join(big, 'מסמך ארוך.odt'));
  f.bigOdt2 = h.makeBigOdt(path.join(big, 'מסמך ארוך להריגה.odt'));
  f.bigEpub = makeBigEpub(path.join(big, 'ספר ארוך.epub'));
  return f;
}
function makeBigEpub(file, chapters = 120) {
  const para = (i) => `<p>Paragraph ${i}: שורה בעברית and enough English words to fill a line of the rendered page with text.</p>`;
  const xhtml = (n) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>C${n}</title></head><body><h1>Chapter ${n}</h1>${Array.from({ length: 80 }, (_, i) => para(i)).join('')}</body></html>`;
  const ids = Array.from({ length: chapters }, (_, i) => i + 1);
  const opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">big-book</dc:identifier><dc:title>Big Book</dc:title><dc:language>en</dc:language></metadata>'
    + `<manifest>${ids.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`;
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  return h.makeZip(file, [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: container }, { name: 'content.opf', data: opf }, ...ids.map((n) => ({ name: `c${n}.xhtml`, data: xhtml(n) }))]);
}

// ---------- output checks (by content) ----------
const pdfText = (f) => tool('poppler/pdftotext.exe', ['-enc', 'UTF-8', f, '-']).toString('utf8');
function ffprobe(f) { return JSON.parse(tool('ffmpeg/ffprobe.exe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString('utf8')); }
const VERIFY = {
  async webp(out, src) {
    const sharp = require('sharp');
    const [m, s] = [await sharp(out).metadata(), await sharp(src).metadata()];
    if (m.format !== 'webp' || m.width !== s.width || m.height !== s.height) throw new Error(`webp ${m.format} ${m.width}x${m.height} vs ${s.width}x${s.height}`);
    return `webp ${m.width}x${m.height} alpha=${m.hasAlpha}`;
  },
  hebrewPdf(out) {
    const text = bare(pdfText(out));
    const missing = Object.entries(POEM).filter(([, v]) => !text.includes(v)).map(([k]) => k);
    if (missing.length) throw new Error(`Hebrew lines missing from the PDF text: ${missing.join(', ')}`);
    if (text.indexOf(POEM.line1) > text.indexOf(POEM.last)) throw new Error('Hebrew lines out of order');
    return 'every poem line present, in order';
  },
  csv(out) {
    const t = fs.readFileSync(out, 'utf8');
    if (!/Alabama/.test(t) || !/\d{6,}/.test(t.replace(/,/g, ''))) throw new Error(`CSV content: ${t.slice(0, 200)}`);
    return `${t.split(/\r?\n/).length} lines, Alabama with population figures`;
  },
  mobi(out) {
    const b = fs.readFileSync(out);
    if (b.subarray(60, 68).toString('latin1') !== 'BOOKMOBI') throw new Error('no BOOKMOBI header');
    const meta = tool('calibre/ebook-meta.exe', [out]).toString('utf8');
    if (!/Alice/i.test(meta)) throw new Error(`ebook-meta: ${meta.slice(0, 200)}`);
    return `BOOKMOBI, ${b.length} bytes, title read back: ${(meta.match(/Title\s*:\s*(.*)/) || [])[1]}`;
  },
  hebDocx(out) {
    const xml = h.zipText(out, 'word/document.xml');
    if (!bare(xml.replace(/<[^>]+>/g, ' ')).includes(POEM.line1)) throw new Error('Hebrew text missing from document.xml');
    return `Hebrew text present; paragraph RTL (w:bidi) ${/<w:bidi\b/.test(xml) ? 'present' : 'absent: the documented Calibre limitation (E4)'}`;
  },
  txt(out) {
    const t = fs.readFileSync(out, 'utf8');
    if (!/Request for Taxpayer/i.test(t)) throw new Error(`text: ${t.slice(0, 200)}`);
    return `${t.length} chars, "Request for Taxpayer" present`;
  },
  async png(out) {
    const files = fs.statSync(out).isDirectory() ? fs.readdirSync(out).map((n) => path.join(out, n)) : [out];
    const sharp = require('sharp');
    const dims = [];
    for (const f of files) { const m = await sharp(f).metadata(); if (m.format !== 'png' || !m.width) throw new Error(`${f}: ${m.format}`); dims.push(`${m.width}x${m.height}`); }
    return `${files.length} PNG page(s) ${dims.join(',')}`;
  },
  mp3(out) {
    const p = ffprobe(out);
    const a = p.streams.find((s) => s.codec_type === 'audio');
    const dur = Number(p.format.duration);
    if (a?.codec_name !== 'mp3' || Math.abs(dur - 2) > 0.3) throw new Error(`${a?.codec_name} ${dur}s`);
    return `mp3 ${a.sample_rate} Hz, ${dur.toFixed(2)} s`;
  },
  webm(out) {
    const p = ffprobe(out);
    const v = p.streams.find((s) => s.codec_type === 'video');
    const a = p.streams.find((s) => s.codec_type === 'audio');
    const dur = Number(p.format.duration);
    if (v?.codec_name !== 'vp9' || a?.codec_name !== 'opus' || v.width !== 320 || Math.abs(dur - 3) > 0.3) throw new Error(`${v?.codec_name} ${a?.codec_name} ${v?.width} ${dur}`);
    return `vp9 ${v.width}x${v.height} + opus, ${dur.toFixed(2)} s`;
  },
  sevenZ(out) {
    const list = tool('7zip/7z.exe', ['l', '-slt', '-sccUTF-8', out]).toString('utf8');
    if (!/Path = קובץ\.txt/.test(list)) throw new Error(`listing: ${list.slice(-300)}`);
    const body = tool('7zip/7z.exe', ['e', '-so', '-sccUTF-8', out, 'קובץ.txt']).toString('utf8');
    if (body !== 'שלום') throw new Error(`content: ${body}`);
    if (fs.readFileSync(out).subarray(0, 6).toString('hex') !== '377abcaf271c') throw new Error('not a 7z signature');
    return '7z signature, Hebrew entry name and content intact';
  },
};

// ---------- main ----------
async function main() {
  if (!fs.existsSync(exe)) throw new Error(`usage: node e2e/local-windows-check.cjs <Morph.exe> (not found: ${exe})`);
  fs.mkdirSync(ROOT, { recursive: true });
  console.log('root', ROOT);
  const f = await makeFixtures();
  const before = Object.fromEntries(Object.entries(f).map(([k, p]) => [k, { path: path.relative(ROOT, p), sha256: sha(p) }]));
  const profilesAtStart = appContainerJobProfiles();
  const realBefore = profileStamp();

  let app = await launch();
  try {
    // --- startup ---
    const version = await app.c.evaluate('window.morph.appVersion()');
    const tools = await app.c.evaluate('window.morph.toolStatus()');
    record('S1', 'app started (non-elevated session)', 'pass', `version ${version}, pid ${app.child.pid}`);
    for (const k of ['ffmpeg', 'images', 'poppler', 'libreoffice', 'calibre', 'sevenzip']) pass('S2', `engine verified: ${k}`, tools?.[k], tools?.details?.[k] ?? tools?.details);
    pass('S3', 'confinement enforced', tools?.confinement?.mode === 'enforced', tools?.confinement);

    // --- detection ---
    const expect = { png: ['image', 'png'], renamed: ['image', 'png'], docx: ['doc', 'docx'], xlsx: ['sheet', 'xlsx'], epub: ['ebook', 'epub'], hebEpub: ['ebook', 'epub'], pdf: ['pdf', 'pdf'], wav: ['audio', 'wav'], mp4: ['video', 'mp4'], zip: ['archive', 'zip'] };
    const det = await detect(app, Object.keys(expect).map((k) => f[k]));
    const t = tree(snapshot(), app.child.pid, app.created);
    const detector = t.filter((p) => /^morph\.exe$/i.test(p.name) && t.find((q) => q.pid === p.ppid && /morph-confine/i.test(q.name)));
    pass('D1', 'detection worker runs under morph-confine.exe', detector.length > 0, detector.map(brief));
    Object.keys(expect).forEach((k, i) => {
      const d = det[i];
      pass('D2', `classified by content: ${path.basename(f[k])}`, d.ok && d.kind === expect[k][0] && d.ext === expect[k][1], { ok: d.ok, kind: d.kind, ext: d.ext, confidence: d.confidence, renamed: d.renamed, targets: d.targets });
    });
    pass('D3', 'renamed PNG (.jpg) flagged as renamed from .jpg', det[1].renamed === 'jpg' && det[1].ext === 'png', { renamed: det[1].renamed, ext: det[1].ext });

    // --- conversions ---
    const cases = [
      ['C1', 'sharp: PNG -> WEBP (Hebrew name, spaces)', f.png, 'webp', (o) => VERIFY.webp(o, f.png)],
      ['C2', 'LibreOffice: Hebrew DOCX -> PDF', f.docx, 'pdf', VERIFY.hebrewPdf],
      ['C3', 'LibreOffice: XLSX -> CSV', f.xlsx, 'csv', VERIFY.csv],
      ['C4', 'Calibre: EPUB -> MOBI', f.epub, 'mobi', VERIFY.mobi],
      ['C5', 'Calibre: Hebrew EPUB -> DOCX', f.hebEpub, 'docx', VERIFY.hebDocx],
      ['C6', 'Poppler: PDF -> TXT', f.pdf, 'txt', VERIFY.txt],
      ['C7', 'Poppler: Hebrew PDF -> PNG pages', f.hebPdf, 'png', VERIFY.png],
      ['C8', 'FFmpeg: WAV -> MP3', f.wav, 'mp3', VERIFY.mp3],
      ['C9', 'FFmpeg: MP4 -> WEBM', f.mp4, 'webm', VERIFY.webm],
      ['C10', '7-Zip: ZIP -> 7Z (Hebrew entry)', f.zip, '7z', VERIFY.sevenZ],
      ['C11', `sharp: PNG -> WEBP in a long path (${f.longPng.length} chars)`, f.longPng, 'webp', (o) => VERIFY.webp(o, f.longPng)],
    ];
    const outputs = {};
    for (const [id, name, file, target, verify] of cases) {
      const t0 = Date.now();
      const r = await convert(app, file, target);
      tree(snapshot(), app.child.pid, app.created);
      if (r.final.state !== 'completed') { record(id, name, 'fail', `${r.final.state} ${r.final.error || ''}`); continue; }
      outputs[id] = r.final.output;
      try {
        const what = await verify(r.final.output);
        record(id, name, 'pass', `${path.basename(r.final.output)} in ${Date.now() - t0} ms: ${what}${r.final.warnings?.length ? ` (warnings: ${r.final.warnings.join(',')})` : ''}`);
      } catch (e) { record(id, name, 'fail', `${r.final.output}: ${e.message}`); }
    }
    if (outputs.C5) record('C5b', 'Calibre Hebrew -> DOCX paragraph direction', 'expected-limitation', 'E4: Calibre keeps the Hebrew text but not paragraph RTL; the app shows the limit note for this target');

    // --- existing output name ---
    if (outputs.C1) {
      const h1 = sha(outputs.C1);
      const r = await convert(app, f.png, 'webp');
      pass('C12', 'existing output name: a new free name, the old output untouched', r.final.state === 'completed' && /\(1\)\.webp$/.test(r.final.output) && sha(outputs.C1) === h1,
        `${r.final.state} ${path.basename(r.final.output || '')}`);
    }

    // --- show output in Explorer ---
    if (outputs.C6) {
      const ok = await app.c.evaluate(`window.morph.showOutput(${js(outputs.C6)})`);
      const dir = path.dirname(outputs.C6).toLowerCase();
      const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; @((New-Object -ComObject Shell.Application).Windows() | ForEach-Object { try { $_.Document.Folder.Self.Path } catch {} }) -join \"`n\"";
      const shown = await until(() => execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim().toLowerCase()).includes(dir), 15000, 1000);
      pass('U1', 'show output: an Explorer window opens on the output folder', ok !== false && shown, { returned: ok, folder: dir });
      // close only the window we opened (matched by its folder)
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `@((New-Object -ComObject Shell.Application).Windows()) | Where-Object { try { $_.Document.Folder.Self.Path -eq '${path.dirname(outputs.C6).replace(/'/g, "''")}' } catch { $false } } | ForEach-Object { $_.Quit() }`], { stdio: 'ignore' });
    }
    const refused = await app.c.evaluate(`window.morph.openOutput(${js(f.pdf)})`);
    pass('U2', 'open refuses a file Morph did not produce (an original)', refused === 'not-a-morph-output', refused);

    // --- cancellation ---
    const confineAncestor = (t, p) => { let q = p; while (q && !/morph-confine/i.test(q.name)) q = t.find((x) => x.pid === q.ppid); return q; };
    async function cancelCase(id, name, file, target, isWorker, followup) {
      const dir = path.dirname(file);
      const listing = fs.readdirSync(dir).sort();
      const h0 = sha(file);
      const [d] = await detect(app, [file]);
      const tgt = typeof target === 'function' ? target(d.targets || []) : target;
      if (!d.ok || !d.targets.includes(tgt)) { record(id, name, 'fail', `not offered: ${d.error || ''} ${tgt} ${d.targets}`); return; }
      const from = (await updates(app, d.id)).length;
      const startedAt = new Date().toISOString();
      const r = await app.c.evaluate(`window.morph.enqueue(${js(d.id)}, ${js(tgt)})`);
      if (!r.ok) { record(id, name, 'fail', `refused ${r.error}`); return; }
      let seen = null;
      await until(async () => {
        const t = tree(snapshot(), app.child.pid, app.created);
        const w = t.filter((p) => isWorker(p, t, startedAt));
        if (w.length) { seen = { t, w }; return true; }
        const u = (await updates(app, d.id)).slice(from);
        return u.some((x) => TERMINAL.includes(x.state));
      }, 180000, 200);
      if (!seen) { const u = (await updates(app, d.id)).slice(from); record(id, name, 'fail', `worker never seen; states ${u.map((x) => x.state).join('>')}`); return; }
      const cur = (await updates(app, d.id)).slice(from);
      const stateAtStop = (cur[cur.length - 1] || {}).state;
      const liveJobId = (cur.find((x) => x.jobId) || {}).jobId;
      const wsSeen = !!liveJobId && fs.existsSync(path.join(TMP, 'morph-jobs', liveJobId));
      const helper = confineAncestor(seen.t, seen.w[0]);
      const owned = helper ? tree(seen.t, helper.pid, helper.created) : seen.w;
      await app.c.evaluate(`window.morph.cancel(${js(d.id)})`);
      const fin = await waitTerminal(app, d.id, from, 120000);
      const left = (await until(() => { const a = alive(owned); return a.length ? null : []; }, 20000, 500)) ?? alive(owned);
      const ws = path.join(TMP, 'morph-jobs', String(fin?.jobId));
      const wsGone = await until(() => !fs.existsSync(ws), 10000, 250);
      const after = fs.readdirSync(dir).sort();
      const detail = { target: tgt, state: fin?.state, stateAtStop, worker: seen.w.map(brief), helper: helper && brief(helper), owned: owned.map((p) => `${p.name}:${p.pid}`), left: left.map(brief), newFiles: after.filter((n) => !listing.includes(n)), workspaceSeenDuringJob: wsSeen, workspaceRemoved: !!wsGone, originalUnchanged: sha(file) === h0 };
      pass(id, name, fin?.state === 'cancelled' && left.length === 0 && detail.newFiles.length === 0 && wsSeen && wsGone && detail.originalUnchanged, detail);
      const nx = await convert(app, followup[0], followup[1]);
      pass(`${id}b`, `${name}: the next conversion works`, nx.final.state === 'completed', `${nx.final.state} ${nx.final.error || ''} ${path.basename(nx.final.output || '')}`);
    }
    const slowImageTarget = (targets) => ['avif', 'tiff', 'webp'].find((x) => targets.includes(x));
    await cancelCase('X1', 'Stop during image conversion (confined image worker)', f.bigPng, slowImageTarget,
      (p, t, since) => /^morph\.exe$/i.test(p.name) && p.created > since && /morph-confine/i.test((t.find((q) => q.pid === p.ppid) || {}).name || ''), [f.longPng, 'jpg']);
    await cancelCase('X2', 'Stop during LibreOffice conversion', f.bigOdt, 'pdf',
      (p) => /^soffice\.bin$/i.test(p.name) && underDir(p, path.join(BIN, 'libreoffice')), [f.docx, 'odt']);
    await cancelCase('X3', 'Stop during Calibre conversion', f.bigEpub, 'pdf',
      (p) => /^(ebook-convert|calibre-parallel)\.exe$/i.test(p.name) && underDir(p, path.join(BIN, 'calibre')), [f.hebEpub, 'txt']);

    // --- parent death (only the dedicated test instance) ---
    {
      const [d] = await detect(app, [f.bigOdt2]);
      const startedAt = new Date().toISOString();
      await app.c.evaluate(`window.morph.enqueue(${js(d.id)}, 'pdf')`);
      let t = null;
      await until(() => { const x = tree(snapshot(), app.child.pid, app.created); if (x.some((p) => /^soffice\.bin$/i.test(p.name) && p.created > startedAt)) { t = x; return true; } return false; }, 180000, 300);
      if (!t) record('P1', 'parent killed during LibreOffice: descendants end', 'fail', 'soffice.bin never seen');
      else {
        const descendants = t.filter((p) => p.pid !== app.child.pid);
        try { app.c.close(); } catch { /* */ }
        execFileSync('taskkill', ['/PID', String(app.child.pid), '/F'], { stdio: 'ignore' }); // Morph.exe only, not /T
        const left = (await until(() => { const a = alive(descendants); return a.length ? null : []; }, 30000, 500)) ?? alive(descendants);
        pass('P1', 'parent killed during LibreOffice: every descendant ends (helper parent watch)', left.length === 0,
          { killed: app.child.pid, descendants: descendants.map((p) => `${p.name}:${p.pid}`), left: left.map(brief) });
        const staging = fs.readdirSync(path.dirname(f.bigOdt2)).filter((n) => n.startsWith('.~morph-'));
        const journal = readJournal();
        const wsBefore = fs.existsSync(path.join(TMP, 'morph-jobs')) ? fs.readdirSync(path.join(TMP, 'morph-jobs')) : [];
        const profilesBeforeRelaunch = appContainerJobProfiles();
        app = await launch();
        await wait(3000);
        const profilesAfterRelaunch = appContainerJobProfiles();
        const wsAfter = fs.existsSync(path.join(TMP, 'morph-jobs')) ? fs.readdirSync(path.join(TMP, 'morph-jobs')) : [];
        const journalAfter = readJournal();
        const leftoversAfter = fs.readdirSync(path.dirname(f.bigOdt2)).filter((n) => n.startsWith('.~morph-') || n.endsWith('.pdf'));
        const nx = await convert(app, f.docx, 'pdf');
        pass('P2', 'next start recovers: journal cleared, workspaces swept, no partial output, converts', Object.keys(journalAfter.active || {}).length === 0 && wsAfter.length === 0 && leftoversAfter.length === 0 && nx.final.state === 'completed',
          { journalBefore: Object.keys(journal.active || {}).length, journalAfter: Object.keys(journalAfter.active || {}).length, workspacesBefore: wsBefore.length, workspacesAfter: wsAfter, stagingBefore: staging, leftoversAfter, jobProfiles: { beforeRelaunch: profilesBeforeRelaunch, afterRelaunch: profilesAfterRelaunch }, next: `${nx.final.state} ${nx.final.error || ''}` });
      }
    }

    // --- original paths never on a Morph process command line ---
    const leaks = [...seenCmdLines.entries()].filter(([, cmd]) => cmd.toLowerCase().includes(FILES.toLowerCase()));
    pass('D4', `no Morph process (${seenCmdLines.size} observed) was given an original path on its command line`, leaks.length === 0, leaks.slice(0, 5));
  } finally {
    await quit(app);
  }
  await wait(2000);
  const profilesAtEnd = appContainerJobProfiles();
  pass('R1', 'no AppContainer job profile left behind', profilesAtEnd <= profilesAtStart, { atStart: profilesAtStart, atEnd: profilesAtEnd });
  const changed = Object.entries(before).filter(([, v]) => sha(path.join(ROOT, v.path)) !== v.sha256).map(([k]) => k);
  const realAfter = profileStamp();
  const touched = Object.keys({ ...realBefore, ...realAfter }).filter((n) => realBefore[n] !== realAfter[n]);
  pass('R3', `the user's own Morph profile was not touched (${REAL_PROFILE})`, touched.length === 0, touched);
  pass('R2', `every original kept its SHA-256 (${Object.keys(before).length} files)`, changed.length === 0, changed);
  return Object.fromEntries(Object.entries(before).map(([k, v]) => [k, { ...v, after: sha(path.join(ROOT, v.path)) }]));
}

main().then((fixtures) => finish(fixtures), (e) => { record('RUN', 'run', 'fail', e.stack); finish(null); });
function finish(fixtures) {
  const failed = results.filter((r) => r.status === 'fail');
  const report = { exe, root: ROOT, finishedAt: new Date().toISOString(), passed: results.filter((r) => r.status === 'pass').length, failed: failed.length, fixtures, results };
  const out = opt('--report');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`passed ${report.passed}, failed ${report.failed}`);
  process.exit(failed.length ? 1 : 0);
}
