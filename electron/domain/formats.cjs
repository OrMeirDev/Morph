// What Morph recognises and what it can produce. Pure data and functions: no Electron, no I/O.

// kind -> Hebrew label and the targets offered for it, in the order the UI lists them (first =
// default choice).
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
const MOBI_FAMILY = new Set(['azw', 'azw3']);
const EXT_KIND = Object.fromEntries(Object.entries(BY_EXT).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));

// file-type result -> kind, for formats where the content says more than the name.
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

// "photo.tar.gz" -> "tar.gz"; otherwise the last extension, lower case.
function normalizedExt(file) {
  const lower = String(file).toLowerCase();
  if (/\.tar\.(gz|bz2|xz)$/.test(lower)) return `tar.${lower.split('.').pop()}`;
  const m = lower.match(/\.([^./\\]+)$/);
  return m ? m[1] : '';
}

// Whether `target` names the format the file already is (jpg = jpeg = jfif, tiff = tif).
const sameFormat = (target, ext) => target === ext
  || (target === 'jpg' && ['jpeg', 'jfif'].includes(ext)) || (target === 'tiff' && ext === 'tif');

// Decide the kind from the sniffed content and the name. `confidence` says how much to trust it:
//   'content'   - the bytes identify the format;
//   'extension' - nothing in the content was recognised, the name alone decided;
//   'container' - the content is a generic container (zip) and a clear office/e-book name decided.
function classify({ ext, sniffed, animatedGif }) {
  let kind = kindFromSniff(sniffed);
  let confidence = kind ? 'content' : null;
  if (!kind) {
    kind = EXT_KIND[ext.split('.').pop()] || null;
    confidence = kind ? 'extension' : null;
  }
  // Zip-based office files can sniff as plain zip; trust a clear office/e-book extension then.
  if (kind === 'archive' && EXT_KIND[ext] && EXT_KIND[ext] !== 'archive') {
    kind = EXT_KIND[ext];
    confidence = 'container';
  }
  // A GIF with a single frame is really just an image; offer image targets for it.
  if (kind === 'gif' && animatedGif === false) kind = 'image';
  if (!kind) return null;
  let actualExt = sniffed?.ext && kindFromSniff(sniffed) === kind ? sniffed.ext : ext;
  // file-type calls the whole Mobipocket container family "mobi"; AZW and AZW3 (KF8) are members,
  // so an .azw/.azw3 name is right, not a rename.
  if (actualExt === 'mobi' && MOBI_FAMILY.has(ext)) actualExt = ext;
  return {
    kind,
    label: KINDS[kind].label,
    ext: actualExt,
    confidence,
    renamed: ext && actualExt && ext !== actualExt && !sameFormat(ext, actualExt) ? ext : null, // e.g. a ".jpg" that is WEBP
  };
}

module.exports = { KINDS, BY_EXT, EXT_KIND, kindFromSniff, normalizedExt, sameFormat, classify };
