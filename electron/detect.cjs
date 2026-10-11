// Works out what a dropped file is (by content first, extension second) and which formats it
// can be converted to. The UI only ever offers targets from this table.
const fs = require('fs');
const path = require('path');

// kind -> Hebrew label, what can be produced from it, and the usual first choice.
const KINDS = {
  video: { label: 'וידאו', targets: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'ogg', 'flac', 'gif', 'apng'] },
  audio: { label: 'אודיו', targets: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'opus', 'aac'] },
  image: { label: 'תמונה', targets: ['jpg', 'png', 'webp', 'avif', 'tiff', 'bmp', 'ico', 'gif', 'pdf', 'svg'] },
  gif: { label: 'GIF', targets: ['mp4', 'webm', 'apng', 'png'] },
  apng: { label: 'APNG', targets: ['gif', 'mp4', 'webm', 'png'] },
  svg: { label: 'SVG', targets: ['png', 'jpg', 'webp', 'pdf'] },
  pdf: { label: 'PDF', targets: ['docx', 'jpg', 'png', 'epub', 'txt'] },
  doc: { label: 'מסמך', targets: ['pdf', 'docx', 'odt', 'rtf', 'txt', 'epub'] },
  sheet: { label: 'גיליון', targets: ['pdf', 'xlsx', 'ods', 'csv'] },
  slides: { label: 'מצגת', targets: ['pdf', 'pptx', 'odp'] },
  ebook: { label: 'ספר', targets: ['pdf', 'epub', 'mobi', 'azw3', 'docx', 'txt'] },
  archive: { label: 'ארכיון', targets: ['zip', '7z', 'tar', 'tar.gz'] },
};

const BY_EXT = {
  video: ['mp4', 'm4v', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'flv', '3gp', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', 'ogv'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'aif', 'amr'],
  image: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'ico'],
  gif: ['gif'],
  svg: ['svg'],
  pdf: ['pdf'],
  doc: ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm'],
  sheet: ['xlsx', 'xls', 'ods', 'csv'],
  slides: ['pptx', 'ppt', 'odp'],
  ebook: ['epub', 'mobi', 'azw', 'azw3', 'fb2'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
};
const EXT_KIND = Object.fromEntries(Object.entries(BY_EXT).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));

// file-type extension -> kind, for formats where the content says more than the name.
function kindFromSniff(ft) {
  if (!ft) return null;
  if (ft.ext === 'apng') return 'apng';
  if (ft.ext === 'gif') return 'gif';
  if (ft.ext === 'pdf') return 'pdf';
  if (ft.ext === 'epub' || ft.ext === 'mobi') return 'ebook';
  if (['docx', 'doc', 'odt', 'rtf'].includes(ft.ext)) return 'doc';
  if (['xlsx', 'xls', 'ods'].includes(ft.ext)) return 'sheet';
  if (['pptx', 'ppt', 'odp'].includes(ft.ext)) return 'slides';
  if (['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz'].includes(ft.ext)) return 'archive';
  if (ft.mime.startsWith('video/')) return 'video';
  if (ft.mime.startsWith('audio/')) return 'audio';
  if (ft.mime.startsWith('image/')) return 'image';
  return null;
}

let fileTypeLib;
async function sniff(file) {
  try {
    fileTypeLib = fileTypeLib || (await import('file-type'));
    return await fileTypeLib.fileTypeFromFile(file);
  } catch {
    return null;
  }
}

function normalizedExt(file) {
  const lower = file.toLowerCase();
  if (/\.tar\.(gz|bz2|xz)$/.test(lower)) return 'tar.' + lower.split('.').pop();
  return path.extname(lower).slice(1);
}

// A GIF with a single frame is really just an image; offer image targets for it.
function isAnimatedGif(file) {
  try {
    const buf = fs.readFileSync(file);
    let frames = 0;
    for (let i = 0; i < buf.length - 1 && frames < 2; i++) {
      if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++; // graphic control extension = one frame
    }
    return frames > 1;
  } catch {
    return false;
  }
}

async function detect(file) {
  const ext = normalizedExt(file);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return { ok: false, error: 'missing' }; }

  const ft = await sniff(file);
  let kind = kindFromSniff(ft) || EXT_KIND[ext.split('.').pop()] || null;
  // Zip-based office files can sniff as plain zip; trust a clear office/e-book extension then.
  if (kind === 'archive' && EXT_KIND[ext] && EXT_KIND[ext] !== 'archive') kind = EXT_KIND[ext];
  if (kind === 'gif' && !isAnimatedGif(file)) kind = 'image';
  if (!kind) return { ok: false, error: 'unsupported', ext, size };

  const actualExt = ft?.ext && kindFromSniff(ft) === kind ? ft.ext : ext;
  const same = (t) => t === actualExt || (t === 'jpg' && ['jpeg', 'jfif'].includes(actualExt)) || (t === 'tiff' && actualExt === 'tif');
  const targets = KINDS[kind].targets.filter((t) => !same(t));
  return {
    ok: true,
    kind,
    label: KINDS[kind].label,
    ext: actualExt,
    size,
    targets,
    defaultTarget: targets[0],
    renamed: ext && actualExt && ext !== actualExt && !same(ext) ? ext : null, // e.g. a ".jpg" that is really WEBP
  };
}

module.exports = { detect, KINDS };
