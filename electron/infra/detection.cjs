// Content-first detection of one file (runs inside the engine worker, never in Electron main).
// detectSource works on byte ranges only: in the app the confined detection worker gets them from
// Morph (WorkerHost.ConfinedDetector) and never opens the original; detectFile reads a file
// directly (tests, and the unconfined worker when confinement is not available on the platform).
const fs = require('fs');
const { classify, normalizedExt } = require('../domain/formats.cjs');
const { gifFrameCountFrom, handleReader } = require('./gifFrames.cjs');

let fileTypeLib;
// file-type reads through a Blob: only `size` and `slice(start, end).arrayBuffer()` are used.
async function sniff(src) {
  fileTypeLib = fileTypeLib || (await import('file-type'));
  const blob = {
    size: src.size,
    type: '',
    slice: (start, end) => ({
      arrayBuffer: async () => {
        const b = await src.read(start, end - start);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
      },
    }),
  };
  return fileTypeLib.fileTypeFromBlob(blob);
}

/**
 * @param {{ ext: string, size: number, mtimeMs?: number, read: (position: number, length: number) => Promise<Buffer> }} src
 * @returns {Promise<object>} { ok: true, kind, label, ext, size, confidence, renamed, facts } or { ok: false, error }
 */
async function detectSource(src) {
  const { ext, size } = src;
  let sniffed = null;
  let sniffError = null;
  try { sniffed = (await sniff(src)) || null; } catch (e) { sniffError = String(e.message || e).slice(0, 120); }
  let animatedGif;
  const facts = {};
  if (sniffed?.ext === 'gif' || (!sniffed && ext === 'gif')) {
    try {
      const frames = await gifFrameCountFrom(src.read, size);
      animatedGif = frames > 1;
      facts.frames = frames > 1 ? '2+' : frames;
    } catch (e) {
      facts.gifError = String(e.message || e);
    }
  }
  const c = classify({ ext, sniffed, animatedGif });
  if (!c) return { ok: false, error: sniffError ? 'unreadable' : 'unsupported', ext, size };
  // An exception while reading the content is not the same as "nothing recognised".
  return { ok: true, ...c, size, mtimeMs: src.mtimeMs, confidence: sniffError ? 'extension-after-error' : c.confidence, facts };
}

async function detectFile(file) {
  const ext = normalizedExt(file);
  let st;
  try { st = fs.statSync(file); } catch { return { ok: false, error: 'missing' }; }
  if (!st.isFile()) return { ok: false, error: 'not-a-file', ext, size: 0 };
  const fh = await fs.promises.open(file, 'r');
  try {
    return await detectSource({ ext, size: st.size, mtimeMs: st.mtimeMs, read: handleReader(fh) });
  } finally {
    await fh.close();
  }
}

module.exports = { detectFile, detectSource };
