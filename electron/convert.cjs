// Runs one conversion with the right tool and reports progress (0-100, or null when unknown).
//   video / audio / GIF / APNG   -> ffmpeg
//   images, SVG                  -> sharp (+ heic-convert for HEIC, imagetracerjs for SVG output, pdf-lib for PDF)
//   PDF -> images / text         -> Poppler (pdftoppm / pdftotext)
//   Office documents, PDF -> Word-> LibreOffice (soffice --headless)
//   e-books                      -> Calibre (ebook-convert)
//   archives                     -> 7-Zip
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const TOOLS = {
  ffmpeg: 'ffmpeg/ffmpeg.exe',
  ffprobe: 'ffmpeg/ffprobe.exe',
  sevenzip: '7zip/7z.exe',
  pdftoppm: 'poppler/pdftoppm.exe',
  pdftotext: 'poppler/pdftotext.exe',
  pdfinfo: 'poppler/pdfinfo.exe',
  // soffice.exe is a launcher that returns at once; soffice.com waits for the conversion.
  soffice: 'libreoffice/program/soffice.com',
  ebookConvert: 'calibre/ebook-convert.exe',
};

function binRoots() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'bin'));
  roots.push(path.join(__dirname, '..', 'bin'));
  return roots;
}
function tool(name) {
  for (const root of binRoots()) {
    const p = path.join(root, TOOLS[name]);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function toolStatus() {
  return {
    ffmpeg: !!tool('ffmpeg'),
    images: true,
    poppler: !!tool('pdftoppm'),
    libreoffice: !!tool('soffice'),
    calibre: !!tool('ebookConvert'),
    sevenzip: !!tool('sevenzip'),
  };
}

// LibreOffice needs its own profile folder so it never clashes with an installed copy.
// The profile's own folders nest deep, so a long base path pushes them past Windows' 260-char
// limit: first start then leaves a half-built profile and every later run exits 0 having
// converted nothing (measured: works at 146 chars, fails from ~150). Keep the path short.
const MAX_PROFILE_PATH = 100;
const shortProfileDir = () => path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'MorphLO');
let profileDir = shortProfileDir();
function setProfileDir(dir) { profileDir = dir.length <= MAX_PROFILE_PATH ? dir : shortProfileDir(); }

class Cancelled extends Error {}

function makeRunner(ctx) {
  return function run(name, args, { onLine, cwd } = {}) {
    if (ctx.cancelled) return Promise.reject(new Cancelled());
    const exe = tool(name);
    if (!exe) return Promise.reject(new Error(`missing-tool:${name}`));
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { cwd, windowsHide: true });
      ctx.child = child;
      let out = '';
      let err = '';
      const bufs = { out: '', err: '' };
      // ffmpeg, 7-Zip and Calibre redraw progress with \r (and \b), so split on all of them.
      const feed = (key, d) => {
        if (!onLine) return;
        bufs[key] += d;
        const lines = bufs[key].split(/[\r\n\b]+/);
        bufs[key] = lines.pop();
        lines.forEach((l) => l.trim() && onLine(l.trim()));
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => { out += d; feed('out', d); });
      child.stderr.on('data', (d) => { err += d; feed('err', d); });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        ctx.child = null;
        if (ctx.cancelled) return reject(new Cancelled());
        if (code === 0) resolve({ out, err });
        else reject(new Error(lastLine(err || out) || `${name} exited with ${code}`));
      });
    });
  };
}

function lastLine(text) {
  return String(text).trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 240) || '';
}

const extOf = (target) => target; // "tar.gz" stays a double extension
function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i}).${ext}`);
  return p;
}
function uniqueDir(dir, base) {
  let p = path.join(dir, base);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})`);
  return p;
}
async function tempDir(tag) {
  return fsp.mkdtemp(path.join(os.tmpdir(), `morph-${tag}-`));
}
const rmrf = (p) => fsp.rm(p, { recursive: true, force: true }).catch(() => {});

// ---------- ffmpeg: video, audio, GIF, APNG ----------

const CRF = { high: 20, medium: 24, small: 28 };

async function probeDuration(run, input) {
  try {
    const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input]);
    const d = parseFloat(out);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    return null;
  }
}

function ffmpegArgs(target, { quality = 'high', maxHeight = null }) {
  const crf = CRF[quality] || CRF.high;
  const scale = maxHeight ? [`scale=-2:'min(${maxHeight},ih)'`] : [];
  const vf = (filters) => (filters.length ? ['-vf', filters.join(',')] : []);
  const gifWidth = { high: 720, medium: 540, small: 360 }[quality] || 720;
  switch (target) {
    case 'mp4':
    case 'mov':
    case 'mkv':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', ...vf([...scale, 'pad=ceil(iw/2)*2:ceil(ih/2)*2']),
        '-c:a', 'aac', '-b:a', '160k', ...(target === 'mkv' ? [] : ['-movflags', '+faststart'])];
    case 'webm':
      // GIF/APNG decode to palette/alpha pixel formats that VP9 rejects; force plain 4:2:0.
      return ['-c:v', 'libvpx-vp9', '-crf', String(crf + 10), '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...vf(scale), '-c:a', 'libopus', '-b:a', '128k'];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', String({ high: 3, medium: 5, small: 8 }[quality] || 3), ...vf(scale), '-c:a', 'libmp3lame', '-q:a', '4'];
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-q:a', String({ high: 2, medium: 4, small: 6 }[quality] || 2)];
    case 'm4a':
    case 'aac':
      return ['-vn', '-c:a', 'aac', '-b:a', { high: '192k', medium: '160k', small: '128k' }[quality] || '192k'];
    case 'wav':
      return ['-vn', '-c:a', 'pcm_s16le'];
    case 'ogg':
      return ['-vn', '-c:a', 'libvorbis', '-q:a', String({ high: 6, medium: 5, small: 3 }[quality] || 6)];
    case 'flac':
      return ['-vn', '-c:a', 'flac'];
    case 'opus':
      return ['-vn', '-c:a', 'libopus', '-b:a', { high: '160k', medium: '128k', small: '96k' }[quality] || '160k'];
    case 'gif':
      return ['-vf', `fps=12,scale='min(${gifWidth},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0'];
    case 'apng':
      return ['-vf', `fps=15,scale='min(${gifWidth},iw)':-2:flags=lanczos`, '-plays', '0', '-f', 'apng'];
    case 'png':
      return ['-frames:v', '1'];
    default:
      throw new Error(`unsupported-target:${target}`);
  }
}

async function viaFfmpeg(run, job, out, onProgress) {
  const duration = await probeDuration(run, job.input);
  const args = ['-hide_banner', '-y', '-i', job.input, ...ffmpegArgs(job.target, job), '-progress', 'pipe:1', '-nostats', out];
  await run('ffmpeg', args, {
    onLine: (line) => {
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (m && duration) onProgress(Math.min(99, (Number(m[1]) / 1e6 / duration) * 100));
    },
  });
  return out;
}

// ---------- images ----------

let sharpLib;
const sharp = () => (sharpLib = sharpLib || require('sharp'));

async function loadImage(run, job, tmp) {
  const ext = job.ext;
  if (ext === 'heic' || ext === 'heif') {
    const heicConvert = require('heic-convert');
    const png = await heicConvert({ buffer: await fsp.readFile(job.input), format: 'PNG' });
    return sharp()(Buffer.from(png));
  }
  if (ext === 'bmp' || ext === 'ico') {
    // libvips has no BMP/ICO reader; let ffmpeg turn it into a PNG first.
    const png = path.join(tmp, 'in.png');
    await run('ffmpeg', ['-hide_banner', '-y', '-i', job.input, '-frames:v', '1', png]);
    return sharp()(png);
  }
  if (ext === 'svg') return sharp()(job.input, { density: 300 });
  return sharp()(job.input, { animated: false });
}

async function viaImage(run, job, out, onProgress) {
  const tmp = await tempDir('img');
  try {
    const img = (await loadImage(run, job, tmp)).rotate(); // honour EXIF orientation
    onProgress(40);
    const q = { high: 92, medium: 82, small: 70 }[job.quality] || 92;
    switch (job.target) {
      case 'jpg': await img.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toFile(out); break;
      case 'png': await img.png({ compressionLevel: 9 }).toFile(out); break;
      case 'webp': await img.webp({ quality: q }).toFile(out); break;
      case 'avif': await img.avif({ quality: Math.max(40, q - 30) }).toFile(out); break;
      case 'tiff': await img.tiff({ quality: q }).toFile(out); break;
      case 'gif': await img.gif().toFile(out); break;
      case 'bmp':
      case 'ico': {
        const png = path.join(tmp, 'out.png');
        const base = job.target === 'ico' ? img.resize(256, 256, { fit: 'inside', withoutEnlargement: true }) : img;
        await base.png().toFile(png);
        await run('ffmpeg', ['-hide_banner', '-y', '-i', png, out]);
        break;
      }
      case 'pdf': {
        const { PDFDocument } = require('pdf-lib');
        const pngBuf = await img.png().toBuffer({ resolveWithObject: true });
        const pdf = await PDFDocument.create();
        const embedded = await pdf.embedPng(pngBuf.data);
        const w = pngBuf.info.width * 0.75; // px -> pt at 96 dpi
        const h = pngBuf.info.height * 0.75;
        pdf.addPage([w, h]).drawImage(embedded, { x: 0, y: 0, width: w, height: h });
        await fsp.writeFile(out, await pdf.save());
        break;
      }
      case 'svg': {
        const ImageTracer = require('imagetracerjs');
        const { data, info } = await img.resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const svg = ImageTracer.imagedataToSVG(
          { width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
          { numberofcolors: { high: 24, medium: 16, small: 8 }[job.quality] || 24, ltres: 1, qtres: 1, pathomit: 4, roundcoords: 1 },
        );
        await fsp.writeFile(out, svg);
        break;
      }
      default:
        throw new Error(`unsupported-target:${job.target}`);
    }
    return out;
  } finally {
    rmrf(tmp);
  }
}

// ---------- PDF ----------

async function pdfPages(run, input) {
  try {
    const { out } = await run('pdfinfo', [input]);
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : 1;
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    return 1;
  }
}

async function viaPdf(run, job, outDir, base, onProgress) {
  if (job.target === 'txt') {
    const out = uniquePath(outDir, base, 'txt');
    await run('pdftotext', ['-layout', '-enc', 'UTF-8', job.input, out]);
    return out;
  }
  // jpg / png: one image per page. A single page becomes one file; more pages go in a folder.
  const pages = await pdfPages(run, job.input);
  const fmt = job.target === 'jpg' ? '-jpeg' : '-png';
  const dpi = { high: '200', medium: '150', small: '100' }[job.quality] || '150';
  if (pages <= 1) {
    const out = uniquePath(outDir, base, job.target);
    await run('pdftoppm', [fmt, '-r', dpi, '-singlefile', job.input, out.slice(0, -(job.target.length + 1))]);
    return out;
  }
  const dir = uniqueDir(outDir, `${base} - עמודים`);
  await fsp.mkdir(dir, { recursive: true });
  await run('pdftoppm', [fmt, '-r', dpi, '-progress', job.input, path.join(dir, 'עמוד')], {
    onLine: (line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s/); // "<page> <total> <file>"
      if (m) onProgress((Number(m[1]) / Number(m[2])) * 100);
    },
  });
  return dir;
}

// ---------- LibreOffice ----------

const OFFICE_FILTERS = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  odt: 'odt',
  rtf: 'rtf',
  txt: 'txt:Text (encoded):UTF8',
  epub: 'epub',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  ods: 'ods',
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  odp: 'odp',
};

// A LibreOffice first start that gets interrupted leaves a half-built profile (a ~1 KB
// registrymodifications.xcu instead of ~9 KB). From then on every run exits 0 and silently
// converts nothing, so check the profile and rebuild it with a warm-up start when needed.
// (The interruption came from first-start registration of bundled extensions; fetch-bin now
// strips those, so this is a safety net.)
function profileHealthy() {
  try {
    return fs.statSync(path.join(profileDir, 'user', 'registrymodifications.xcu')).size > 4 * 1024;
  } catch {
    return false;
  }
}
async function ensureProfile(run, { rebuild = false } = {}) {
  if (!rebuild && profileHealthy()) return;
  await fsp.rm(profileDir, { recursive: true, force: true });
  await run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(profileDir).href}`, '--terminate_after_init']);
}

async function viaOffice(run, job, outDir, base) {
  const tmp = await tempDir('office');
  try {
    // LibreOffice names its output after the input, so work on a copy with a plain name.
    const src = path.join(tmp, `in.${job.ext}`);
    await fsp.copyFile(job.input, src);
    const args = ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(profileDir).href}`];
    if (job.ext === 'pdf') args.push('--infilter=writer_pdf_import');
    args.push('--convert-to', OFFICE_FILTERS[job.target], '--outdir', tmp, src);
    const produced = path.join(tmp, `in.${job.target}`);
    await ensureProfile(run);
    await run('soffice', args);
    if (!fs.existsSync(produced)) {
      await ensureProfile(run, { rebuild: true }); // one retry on a freshly built profile
      await run('soffice', args);
    }
    if (!fs.existsSync(produced)) throw new Error('LibreOffice did not produce a file');
    const out = uniquePath(outDir, base, job.target);
    await fsp.copyFile(produced, out);
    return out;
  } finally {
    rmrf(tmp);
  }
}

// ---------- Calibre ----------

async function viaCalibre(run, job, out, onProgress) {
  await run('ebookConvert', [job.input, out], {
    onLine: (line) => {
      const m = line.match(/^(\d{1,3})%/);
      if (m) onProgress(Math.min(99, Number(m[1])));
    },
  });
  return out;
}

// ---------- 7-Zip ----------

async function viaArchive(run, job, out, onProgress) {
  const tmp = await tempDir('arc');
  const content = path.join(tmp, 'content');
  try {
    const pct = (lo, hi) => (line) => {
      const m = line.match(/(\d{1,3})%/);
      if (m) onProgress(lo + (Number(m[1]) / 100) * (hi - lo));
    };
    await run('sevenzip', ['x', '-y', '-bsp1', `-o${content}`, job.input], { onLine: pct(0, 45) });
    // .tar.gz / .tgz unpack to a single .tar first; open that too.
    const inner = await fsp.readdir(content);
    if (inner.length === 1 && /\.tar$/i.test(inner[0])) {
      const tarPath = path.join(content, inner[0]);
      await run('sevenzip', ['x', '-y', '-bsp1', `-o${content}`, tarPath]);
      await fsp.rm(tarPath, { force: true });
    }
    if (job.target === 'tar.gz') {
      const tarFile = path.join(tmp, 'packed.tar');
      await run('sevenzip', ['a', '-ttar', '-bsp1', tarFile, '*'], { cwd: content, onLine: pct(45, 80) });
      await run('sevenzip', ['a', '-tgzip', '-bsp1', out, tarFile], { onLine: pct(80, 99) });
    } else {
      const type = { zip: 'zip', '7z': '7z', tar: 'tar' }[job.target];
      await run('sevenzip', ['a', `-t${type}`, '-bsp1', out, '*'], { cwd: content, onLine: pct(45, 99) });
    }
    return out;
  } finally {
    rmrf(tmp);
  }
}

// ---------- dispatch ----------

const FFMPEG_KINDS = new Set(['video', 'audio', 'gif', 'apng']);
const OFFICE_KINDS = new Set(['doc', 'sheet', 'slides']);

function convert(job, onProgress = () => {}) {
  const ctx = { cancelled: false, child: null };
  const run = makeRunner(ctx);
  const outDir = job.outDir || path.dirname(job.input);
  const base = path.basename(job.input).replace(/\.(tar\.)?[^.]+$/i, '');
  const outFile = () => uniquePath(outDir, base, extOf(job.target));

  const work = async () => {
    await fsp.mkdir(outDir, { recursive: true });
    if (FFMPEG_KINDS.has(job.kind)) return viaFfmpeg(run, job, outFile(), onProgress);
    if (job.kind === 'image' || job.kind === 'svg') return viaImage(run, job, outFile(), onProgress);
    if (job.kind === 'pdf') {
      if (job.target === 'docx') return viaOffice(run, job, outDir, base);
      if (job.target === 'epub') return viaCalibre(run, job, outFile(), onProgress);
      return viaPdf(run, job, outDir, base, onProgress);
    }
    if (OFFICE_KINDS.has(job.kind)) return viaOffice(run, job, outDir, base);
    if (job.kind === 'ebook') return viaCalibre(run, job, outFile(), onProgress);
    if (job.kind === 'archive') return viaArchive(run, job, outFile(), onProgress);
    throw new Error(`unsupported-kind:${job.kind}`);
  };

  const done = work().then(
    (output) => ({ ok: true, output }),
    (e) => (e instanceof Cancelled
      ? { ok: false, cancelled: true }
      : { ok: false, error: String(e.message || e) }),
  );
  return {
    cancel() {
      ctx.cancelled = true;
      if (ctx.child) ctx.child.kill();
    },
    done,
  };
}

module.exports = { convert, toolStatus, setProfileDir };
