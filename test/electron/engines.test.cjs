// Real engines, real worker processes, real files: the conversion matrix this machine can run.
// Directions whose engine is missing here are skipped (and reported); Windows-bundled engines
// still need the Windows run described in docs/TESTING.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, makePng, makePdf, makeWav, makeZip, sevenZip } = require('./helpers.cjs');

const sz = sevenZip();
if (sz) process.env.MORPH_TOOL_SEVENZIP = sz;

const limits = require('../../electron/domain/limits.cjs');
const { ToolRegistry } = require('../../electron/infra/ToolRegistry.cjs');
const { runProcess } = require('../../electron/infra/ProcessRunner.cjs');
const { PersistentWorker, runInFreshWorker } = require('../../electron/infra/WorkerHost.cjs');
const { JobRepository } = require('../../electron/infra/repositories.cjs');
const { OfficeProfileManager } = require('../../electron/infra/OfficeProfileManager.cjs');
const { FileIntakeService } = require('../../electron/app/FileIntakeService.cjs');
const { ConversionCoordinator } = require('../../electron/app/ConversionCoordinator.cjs');
const adapters = require('../../electron/adapters/index.cjs');

const root = tmpDir('engines');
const worker = new PersistentWorker();
const tools = new ToolRegistry({ probeImages: () => worker.request({ type: 'probe' }, { timeoutMs: 30000 }) });
const intake = new FileIntakeService({ detect: (f) => worker.request({ type: 'detect', file: f }, { timeoutMs: 15000 }), tools, limits: limits.intake });
const updates = [];
const history = [];
const coordinator = new ConversionCoordinator({
  intake,
  tools,
  settings: { get: () => ({ outputMode: 'beside', folder: root, quality: 'medium', maxHeight: null }) },
  history: { add: (e) => { history.push(e); return e; } },
  journal: new JobRepository(path.join(root, 'state')),
  adapters,
  officeProfiles: new OfficeProfileManager({ baseDir: path.join(root, 'lo') }),
  runTool: (name, args, o) => { const exe = tools.path(name); return exe ? runProcess(exe, args, { ...o, name }) : Promise.reject(new Error(`missing-tool:${name}`)); },
  runWorker: runInFreshWorker,
  emit: (u) => updates.push(u),
  workspaceRoot: path.join(root, 'ws'),
});

test.after(() => worker.stop());

const lastUpdate = (fileId) => updates.filter((u) => u.fileId === fileId).at(-1);
async function convert(file, target) {
  const [d] = await intake.detectPaths([file]);
  assert.ok(d.ok, `detected ${path.basename(file)}: ${d.error}`);
  assert.ok(d.targets.includes(target), `${d.kind} offers ${target} (offers ${d.targets})`);
  const r = coordinator.enqueue({ fileId: d.id, target });
  assert.ok(r.ok, r.error);
  await coordinator.whenIdle();
  return lastUpdate(d.id);
}
const has = (cap) => tools.has(cap);
const dirOf = (tag) => { const d = path.join(root, tag); fs.mkdirSync(d, { recursive: true }); return d; };
const ffprobe = async (file) => JSON.parse((await runProcess(tools.path('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeoutMs: 30000, captureStdout: true })).stdout);

test('tool probes ran', async () => {
  await tools.probe();
  const s = tools.status();
  console.log('engines here:', JSON.stringify(Object.fromEntries(Object.entries(s.details).map(([k, v]) => [k, v.ok ? v.version : `missing (${v.reason})`]))));
  assert.equal(s.images, true, 'sharp loads in the worker');
});

test('MOR-01: an image cancelled at once ends cancelled and writes nothing', async () => {
  await tools.probe();
  const d = dirOf('cancel');
  const file = await makePng(path.join(d, 'tiny.png'));
  const [det] = await intake.detectPaths([file]);
  coordinator.enqueue({ fileId: det.id, target: 'webp' });
  coordinator.cancel(det.id);
  await coordinator.whenIdle();
  assert.equal(lastUpdate(det.id).state, 'cancelled');
  assert.deepEqual(fs.readdirSync(d), ['tiny.png']);
});

test('MOR-01: cancelling during native image work kills the worker; no output, next job fine', async () => {
  await tools.probe();
  const d = dirOf('cancel2');
  const big = await makePng(path.join(d, 'big.png'), { width: 3000, height: 3000 });
  const small = await makePng(path.join(d, 'small.png'));
  const [a, b] = await intake.detectPaths([big, small]);
  coordinator.enqueue({ fileId: a.id, target: 'svg' }); // tracing a large image takes a while
  coordinator.enqueue({ fileId: b.id, target: 'jpg' });
  while (lastUpdate(a.id)?.state !== 'converting') await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 150));
  coordinator.cancel(a.id);
  await coordinator.whenIdle();
  assert.equal(lastUpdate(a.id).state, 'cancelled');
  assert.equal(lastUpdate(b.id).state, 'completed');
  assert.deepEqual(fs.readdirSync(d).sort(), ['big.png', 'small.jpg', 'small.png']);
});

test('image matrix: PNG to every image target', async (t) => {
  await tools.probe();
  const sharp = require('sharp');
  for (const target of ['jpg', 'webp', 'avif', 'tiff', 'gif', 'pdf', 'svg', 'bmp', 'ico']) {
    await t.test(target, { skip: (['bmp', 'ico'].includes(target) && !has('ffmpeg')) && 'no ffmpeg' }, async () => {
      const d = dirOf(`img-${target}`);
      const file = await makePng(path.join(d, 'pic.png'), { width: 40, height: 30, alpha: true });
      const u = await convert(file, target);
      assert.equal(u.state, 'completed', u.error);
      assert.equal(path.basename(u.output), `pic.${target}`);
      if (['jpg', 'webp', 'avif', 'tiff', 'gif'].includes(target)) {
        const m = await sharp(u.output).metadata();
        assert.deepEqual([m.width, m.height], [40, 30]);
      }
      if (target === 'jpg') {
        const { data } = await sharp(u.output).raw().toBuffer({ resolveWithObject: true });
        assert.ok(data[0] > 100 && data[1] > 150, 'transparency flattened onto white');
      }
    });
  }
});

test('BMP input goes through ffmpeg', async (t) => {
  await tools.probe();
  if (!has('ffmpeg')) return t.skip('no ffmpeg');
  const d = dirOf('bmp-in');
  const png = await makePng(path.join(d, 'src.png'));
  await runProcess(tools.path('ffmpeg'), ['-hide_banner', '-i', png, path.join(d, 'in.bmp')], { timeoutMs: 30000 });
  fs.rmSync(png);
  const u = await convert(path.join(d, 'in.bmp'), 'png');
  assert.equal(u.state, 'completed', u.error);
});

test('audio matrix', async (t) => {
  await tools.probe();
  if (!has('ffmpeg')) return t.skip('no ffmpeg');
  for (const target of ['mp3', 'm4a', 'ogg', 'flac', 'opus', 'aac']) {
    await t.test(target, { skip: !coordinator.tools.has(`ffmpeg:enc:${{ mp3: 'libmp3lame', m4a: 'aac', ogg: 'libvorbis', flac: 'flac', opus: 'libopus', aac: 'aac' }[target]}`) && 'encoder missing' }, async () => {
      const d = dirOf(`aud-${target}`);
      const u = await convert(makeWav(path.join(d, 'tone.wav'), { seconds: 1 }), target);
      assert.equal(u.state, 'completed', u.error);
      const info = await ffprobe(u.output);
      assert.equal(info.streams.filter((s) => s.codec_type === 'audio').length, 1);
      assert.ok(Math.abs(Number(info.format.duration) - 1) < 0.2, `duration ${info.format.duration}`);
    });
  }
});

test('video matrix (odd dimensions, audio track)', async (t) => {
  await tools.probe();
  if (!has('ffmpeg')) return t.skip('no ffmpeg');
  const src = path.join(dirOf('vid-src'), 'clip.mkv');
  await runProcess(tools.path('ffmpeg'), ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc=size=65x49:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-shortest', src], { timeoutMs: 60000 });
  for (const target of ['mp4', 'mov', 'webm', 'avi', 'mp3', 'wav', 'gif', 'apng']) {
    const enc = require('../../electron/domain/capabilities.cjs').FFMPEG_ENCODERS[target];
    await t.test(target, { skip: !enc.every((e) => has(`ffmpeg:enc:${e}`)) && 'encoder missing' }, async () => {
      const d = dirOf(`vid-${target}`);
      const file = path.join(d, 'clip.mkv');
      fs.copyFileSync(src, file);
      const u = await convert(file, target);
      assert.equal(u.state, 'completed', u.error);
      const info = await ffprobe(u.output);
      const v = info.streams.find((s) => s.codec_type === 'video');
      const a = info.streams.find((s) => s.codec_type === 'audio');
      if (['mp4', 'mov', 'webm', 'avi'].includes(target)) {
        assert.ok(v && a, 'video and audio kept');
        if (target !== 'avi' && target !== 'webm') assert.deepEqual([v.width % 2, v.height % 2], [0, 0], 'padded to even size for yuv420p');
      }
      if (['mp3', 'wav'].includes(target)) assert.ok(a && !v, 'audio only');
      if (['gif', 'apng'].includes(target)) assert.ok(v && Number(v.nb_frames || 2) > 1, 'still animated');
    });
  }
});

test('animated GIF to video, APNG and a single frame', async (t) => {
  await tools.probe();
  if (!has('ffmpeg')) return t.skip('no ffmpeg');
  const src = path.join(dirOf('gif-src'), 'anim.gif');
  await runProcess(tools.path('ffmpeg'), ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc=size=48x32:rate=5:duration=1', src], { timeoutMs: 60000 });
  for (const target of ['mp4', 'webm', 'apng', 'png']) {
    await t.test(target, async () => {
      const d = dirOf(`gif-${target}`);
      fs.copyFileSync(src, path.join(d, 'anim.gif'));
      const [det] = await intake.detectPaths([path.join(d, 'anim.gif')]);
      assert.equal(det.kind, 'gif', 'detected as animated');
      if (target === 'png') assert.equal(det.fidelity.png, 'single-frame');
      const u = await convert(path.join(d, 'anim.gif'), target);
      assert.equal(u.state, 'completed', u.error);
    });
  }
});

test('PDF: one page to one image, several pages to a folder, text', async (t) => {
  await tools.probe();
  if (!has('pdftoppm')) return t.skip('no poppler');
  const d1 = dirOf('pdf1');
  const u1 = await convert(await makePdf(path.join(d1, 'one.pdf'), 1), 'png');
  assert.equal(u1.state, 'completed', u1.error);
  assert.equal(path.basename(u1.output), 'one.png');
  const d3 = dirOf('pdf3');
  const u3 = await convert(await makePdf(path.join(d3, 'three.pdf'), 3), 'jpg');
  assert.equal(u3.state, 'completed', u3.error);
  assert.equal(path.basename(u3.output), 'three - עמודים');
  assert.equal(fs.readdirSync(u3.output).filter((n) => n.endsWith('.jpg')).length, 3);
  const dt = dirOf('pdft');
  const ut = await convert(await makePdf(path.join(dt, 'words.pdf'), 2), 'txt');
  assert.equal(ut.state, 'completed', ut.error);
  const text = fs.readFileSync(ut.output, 'utf8');
  assert.match(text, /Morph test 1/);
  assert.match(text, /Morph test 2/);
});

test('Office: Hebrew RTL text survives text -> DOCX -> PDF, and a spreadsheet converts', { timeout: 240000 }, async (t) => {
  await tools.probe();
  if (!has('soffice')) return t.skip('no LibreOffice');
  const d = dirOf('office');
  const hebrew = 'שלום עולם — בדיקת המרה של Morph';
  fs.writeFileSync(path.join(d, 'letter.txt'), `${hebrew}\nשורה שנייה\n`);
  const docx = await convert(path.join(d, 'letter.txt'), 'docx');
  assert.equal(docx.state, 'completed', docx.error);
  const pdf = await convert(docx.output, 'pdf');
  assert.equal(pdf.state, 'completed', pdf.error);
  if (has('pdftotext')) {
    const out = path.join(d, 'check.txt');
    await runProcess(tools.path('pdftotext'), ['-enc', 'UTF-8', pdf.output, out], { timeoutMs: 30000 });
    const text = fs.readFileSync(out, 'utf8');
    for (const word of ['שלום', 'עולם', 'Morph']) assert.ok(text.includes(word), `PDF text contains ${word}: ${JSON.stringify(text.slice(0, 120))}`);
  }
  fs.writeFileSync(path.join(d, 'table.csv'), 'name,count\nאבג,3\nxyz,4\n');
  const xlsx = await convert(path.join(d, 'table.csv'), 'xlsx');
  assert.equal(xlsx.state, 'completed', xlsx.error);
  const back = await convert(xlsx.output, 'ods');
  assert.equal(back.state, 'completed', back.error);
});

test('Office: PDF -> Word uses the PDF import filter', { timeout: 240000 }, async (t) => {
  await tools.probe();
  if (!has('soffice')) return t.skip('no LibreOffice');
  const d = dirOf('pdfdocx');
  const u = await convert(await makePdf(path.join(d, 'scan.pdf'), 1), 'docx');
  assert.equal(u.state, 'completed', u.error);
});

test('archives: zip repacks to 7z, tar and tar.gz with the same contents', async (t) => {
  await tools.probe();
  if (!has('sevenzip')) return t.skip('no 7-Zip');
  const list = async (f) => (await runProcess(tools.path('sevenzip'), ['l', '-slt', '-ba', f], { timeoutMs: 30000, captureStdout: true })).stdout;
  for (const target of ['7z', 'tar', 'tar.gz']) {
    await t.test(target, async () => {
      const d = dirOf(`arc-${target}`);
      const file = makeZip(path.join(d, 'bundle.zip'), [{ name: 'a.txt', data: 'alpha' }, { name: 'sub/b.txt', data: 'beta beta' }]);
      const u = await convert(file, target);
      assert.equal(u.state, 'completed', u.error);
      assert.equal(path.basename(u.output), `bundle.${target}`);
      if (target === 'tar.gz') return; // a gzip wrapper: listed contents are the inner tar
      const listing = await list(u.output);
      assert.match(listing, /Path = a\.txt/);
      assert.match(listing, /Path = sub[/\\]b\.txt/);
    });
  }
  await t.test('tar.gz back to zip (inner tar opened)', async () => {
    const d = dirOf('arc-tgz-zip');
    const file = makeZip(path.join(d, 'pack.zip'), [{ name: 'x.txt', data: 'x' }]);
    const tgz = await convert(file, 'tar.gz');
    assert.equal(tgz.state, 'completed', tgz.error);
    fs.rmSync(file);
    const zip = await convert(tgz.output, 'zip');
    assert.equal(zip.state, 'completed', zip.error);
    assert.match(await list(zip.output), /Path = x\.txt/);
  });
});

test('archives: traversal and link entries are refused before extraction', async (t) => {
  await tools.probe();
  if (!has('sevenzip')) return t.skip('no 7-Zip');
  const d = dirOf('arc-evil');
  const evil = makeZip(path.join(d, 'evil.zip'), [{ name: 'ok.txt', data: 'fine' }, { name: '../escaped.txt', data: 'pwned' }]);
  const u = await convert(evil, '7z');
  assert.equal(u.state, 'failed');
  assert.match(u.error, /archive-unsafe-path/);
  assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false);
  assert.deepEqual(fs.readdirSync(d), ['evil.zip']);
  const link = makeZip(path.join(d, 'link.zip'), [{ name: 'passwd', data: '/etc/passwd', symlink: true }]);
  const ul = await convert(link, 'tar');
  assert.equal(ul.state, 'failed');
  assert.match(ul.error, /archive-link/);
});

test('missing engines are not offered (calibre)', async () => {
  await tools.probe();
  const d = dirOf('ebook');
  fs.writeFileSync(path.join(d, 'book.epub'), fs.readFileSync(makeZip(path.join(d, 'tmp.zip'), [{ name: 'mimetype', data: 'application/epub+zip' }])));
  const [det] = await intake.detectPaths([path.join(d, 'book.epub')]);
  if (has('calibre')) assert.ok(det.ok);
  else {
    assert.equal(det.ok, false);
    assert.equal(det.error, 'missing-tools');
    assert.deepEqual(det.missing, ['calibre']);
  }
});

test('nothing is left in the job workspaces', async () => {
  await coordinator.whenIdle();
  const ws = path.join(root, 'ws');
  assert.deepEqual(fs.existsSync(ws) ? fs.readdirSync(ws) : [], []);
  const stray = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith('.~morph-')) stray.push(path.join(dir, e.name)); else if (e.isDirectory()) walk(path.join(dir, e.name)); } };
  walk(root);
  assert.deepEqual(stray, []);
});
