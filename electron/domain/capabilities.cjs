// The conversion registry: for a detected file and a target, which adapter runs it, which engine
// capabilities it needs, and what the user should expect to lose. One table drives the targets the
// UI offers, the backend's validation of a requested conversion, and the adapter contract tests.
const { KINDS, sameFormat } = require('./formats.cjs');

const FFMPEG_KINDS = new Set(['video', 'audio', 'gif', 'apng']);
const OFFICE_KINDS = new Set(['doc', 'sheet', 'slides']);

// The encoder each ffmpeg target needs (checked against `ffmpeg -encoders`).
const FFMPEG_ENCODERS = {
  mp4: ['libx264', 'aac'], mov: ['libx264', 'aac'], mkv: ['libx264', 'aac'],
  webm: ['libvpx-vp9', 'libopus'], avi: ['mpeg4', 'libmp3lame'],
  mp3: ['libmp3lame'], m4a: ['aac'], aac: ['aac'], wav: ['pcm_s16le'], ogg: ['libvorbis'], flac: ['flac'], opus: ['libopus'],
  gif: ['gif'], apng: ['apng'], png: ['png'],
};

// Fidelity categories. Only the ones that change what the user gets beyond "smaller/larger file"
// carry a note in the UI (see src/presentation/fidelityNotes.js).
const FIDELITY = {
  LOSSLESS: 'lossless', // pixels/samples/content preserved
  LOSSY: 'lossy', // re-encoded with the quality setting
  FLATTEN: 'flatten', // transparency filled with white
  SINGLE_FRAME: 'single-frame', // only the first frame of an animation/video
  RASTER: 'rasterize', // vector/document pages become pixels
  VECTOR_APPROX: 'vector-approx', // pixels traced into a limited-colour vector drawing
  RECONSTRUCT: 'reconstruct', // layout rebuilt by another engine (PDF -> Word, office <-> office)
  TEXT_ONLY: 'text-only', // text kept, formatting dropped
  FIRST_SHEET: 'first-sheet', // CSV: first sheet only, values only
  REPACK: 'repack', // archive contents preserved, container/compression changes
  AUDIO_ONLY: 'audio-only', // the video track is dropped
  RESIZED: 'resized', // ICO: at most 256x256
  RESAMPLED: 'resampled', // animations: frame rate and width reduced (GIF 12 fps, APNG 15 fps, <= 720 px)
};

function fidelityOf(kind, ext, target) {
  if (kind === 'archive') return FIDELITY.REPACK;
  if (target === 'csv') return FIDELITY.FIRST_SHEET;
  if (target === 'txt') return FIDELITY.TEXT_ONLY;
  if (kind === 'pdf') return target === 'docx' || target === 'epub' ? FIDELITY.RECONSTRUCT : FIDELITY.RASTER;
  if (OFFICE_KINDS.has(kind) || kind === 'ebook') return target === 'pdf' ? FIDELITY.LOSSLESS : FIDELITY.RECONSTRUCT;
  if (kind === 'svg') return FIDELITY.RASTER;
  if (FFMPEG_KINDS.has(kind)) {
    if (target === 'png') return FIDELITY.SINGLE_FRAME;
    if (kind === 'video' && ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'opus', 'aac'].includes(target)) return FIDELITY.AUDIO_ONLY;
    if (target === 'gif' || target === 'apng') return FIDELITY.RESAMPLED;
    if (['wav', 'flac'].includes(target)) return FIDELITY.LOSSLESS;
    return FIDELITY.LOSSY;
  }
  if (kind === 'image') {
    if (target === 'svg') return FIDELITY.VECTOR_APPROX;
    if (target === 'ico') return FIDELITY.RESIZED;
    if (target === 'jpg') return FIDELITY.FLATTEN;
    if (['png', 'bmp', 'pdf'].includes(target)) return FIDELITY.LOSSLESS;
    return FIDELITY.LOSSY;
  }
  return FIDELITY.LOSSY;
}

// The adapter and the engine requirements of one conversion, or null if Morph has none for it.
// Requirements are capability IDs reported by the ToolRegistry: 'ffmpeg', 'ffprobe',
// 'ffmpeg:enc:<name>', 'images', 'images:heic', 'pdftoppm', 'pdftotext', 'pdfinfo', 'soffice',
// 'calibre', 'sevenzip'.
function capabilityFor(kind, ext, target) {
  if (!KINDS[kind] || !KINDS[kind].targets.includes(target)) return null;
  const fidelity = fidelityOf(kind, ext, target);
  if (FFMPEG_KINDS.has(kind)) {
    return { adapter: 'ffmpeg', requires: ['ffmpeg', ...(FFMPEG_ENCODERS[target] || []).map((e) => `ffmpeg:enc:${e}`)], fidelity };
  }
  if (kind === 'image' || kind === 'svg') {
    const requires = ['images'];
    if (ext === 'heic' || ext === 'heif') requires.push('images:heic');
    // libvips has no BMP/ICO codec: ffmpeg converts those through PNG.
    if (['bmp', 'ico'].includes(ext) || ['bmp', 'ico'].includes(target)) requires.push('ffmpeg');
    return { adapter: 'image', requires, fidelity };
  }
  if (kind === 'pdf') {
    if (target === 'docx') return { adapter: 'office', requires: ['soffice'], fidelity };
    if (target === 'epub') return { adapter: 'ebook', requires: ['calibre'], fidelity };
    if (target === 'txt') return { adapter: 'pdf', requires: ['pdftotext'], fidelity };
    return { adapter: 'pdf', requires: ['pdftoppm', 'pdfinfo'], fidelity };
  }
  if (OFFICE_KINDS.has(kind)) return { adapter: 'office', requires: ['soffice'], fidelity };
  if (kind === 'ebook') return { adapter: 'ebook', requires: ['calibre'], fidelity };
  if (kind === 'archive') return { adapter: 'archive', requires: ['sevenzip'], fidelity };
  return null;
}

// Targets for a detected file, split into what the installed, verified engines can do now and
// what they cannot (with the missing capability IDs). `has(capId)` answers from the ToolRegistry.
function targetsFor({ kind, ext }, has) {
  const available = [];
  const unavailable = [];
  const fidelity = {};
  for (const target of KINDS[kind]?.targets || []) {
    if (sameFormat(target, ext)) continue;
    const cap = capabilityFor(kind, ext, target);
    if (!cap) continue;
    const missing = cap.requires.filter((r) => !has(r));
    if (missing.length) unavailable.push({ target, missing });
    else {
      available.push(target);
      fidelity[target] = cap.fidelity;
    }
  }
  return { available, unavailable, fidelity };
}

module.exports = { capabilityFor, targetsFor, fidelityOf, FIDELITY, FFMPEG_ENCODERS };
