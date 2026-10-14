// The in-process image work (sharp, heic-convert, pdf-lib, imagetracerjs). Only the engine worker
// loads this module; Electron main never does, so a crash or hang in a native image library ends
// the worker, not the app.
const fsp = require('fs').promises;

let sharpLib;
const sharp = () => (sharpLib = sharpLib || require('sharp'));

const QUALITY = { high: 92, medium: 82, small: 70 };

async function load({ input, ext }) {
  if (ext === 'heic' || ext === 'heif') {
    const heicConvert = require('heic-convert');
    const png = await heicConvert({ buffer: await fsp.readFile(input), format: 'PNG' });
    return sharp()(Buffer.from(png));
  }
  if (ext === 'svg') return sharp()(input, { density: 300 });
  return sharp()(input, { animated: false });
}

// task: { input, ext, target, quality, out }. For bmp/ico targets `out` is a PNG that the
// adapter hands to ffmpeg (libvips has no BMP/ICO writer).
async function convertImage(task, progress = () => {}) {
  const img = (await load(task)).rotate(); // honour EXIF orientation
  progress(40);
  const q = QUALITY[task.quality] || QUALITY.high;
  const { out } = task;
  switch (task.target) {
    case 'jpg': await img.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toFile(out); break;
    case 'png': await img.png({ compressionLevel: 9 }).toFile(out); break;
    case 'webp': await img.webp({ quality: q }).toFile(out); break;
    case 'avif': await img.avif({ quality: Math.max(40, q - 30) }).toFile(out); break;
    case 'tiff': await img.tiff({ quality: q }).toFile(out); break;
    case 'gif': await img.gif().toFile(out); break;
    case 'bmp': await img.png().toFile(out); break;
    case 'ico': await img.resize(256, 256, { fit: 'inside', withoutEnlargement: true }).png().toFile(out); break;
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
      progress(60);
      const svg = ImageTracer.imagedataToSVG(
        { width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
        { numberofcolors: { high: 24, medium: 16, small: 8 }[task.quality] || 24, ltres: 1, qtres: 1, pathomit: 4, roundcoords: 1 },
      );
      await fsp.writeFile(out, svg);
      break;
    }
    default:
      throw new Error(`unsupported-target:${task.target}`);
  }
  progress(90);
  return out;
}

function probeImages() {
  let version = null;
  let heic = false;
  try { version = require('sharp').versions?.sharp || 'unknown'; } catch { version = null; }
  try { require.resolve('heic-convert'); heic = true; } catch { heic = false; }
  return { sharp: version, heic };
}

module.exports = { convertImage, probeImages };
