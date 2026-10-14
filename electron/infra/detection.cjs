// Content-first detection of one file (runs inside the engine worker, never in Electron main).
const fs = require('fs');
const { classify, normalizedExt } = require('../domain/formats.cjs');
const { gifFrameCount } = require('./gifFrames.cjs');

let fileTypeLib;
async function sniff(file) {
  fileTypeLib = fileTypeLib || (await import('file-type'));
  return fileTypeLib.fileTypeFromFile(file);
}

// Returns { ok: true, kind, label, ext, size, confidence, renamed, facts } or { ok: false, error }.
async function detectFile(file) {
  const ext = normalizedExt(file);
  let st;
  try { st = fs.statSync(file); } catch { return { ok: false, error: 'missing' }; }
  if (!st.isFile()) return { ok: false, error: 'not-a-file', ext, size: 0 };
  let sniffed = null;
  let sniffError = null;
  try { sniffed = (await sniff(file)) || null; } catch (e) { sniffError = String(e.message || e).slice(0, 120); }
  let animatedGif;
  const facts = {};
  if (sniffed?.ext === 'gif' || (!sniffed && ext === 'gif')) {
    try {
      const frames = gifFrameCount(file);
      animatedGif = frames > 1;
      facts.frames = frames > 1 ? '2+' : frames;
    } catch (e) {
      facts.gifError = String(e.message || e);
    }
  }
  const c = classify({ ext, sniffed, animatedGif });
  if (!c) return { ok: false, error: sniffError ? 'unreadable' : 'unsupported', ext, size: st.size };
  // An exception while reading the content is not the same as "nothing recognised".
  return { ok: true, ...c, size: st.size, mtimeMs: st.mtimeMs, confidence: sniffError ? 'extension-after-error' : c.confidence, facts };
}

module.exports = { detectFile };
