// The gate every file passes before Morph converts it. The renderer supplies paths (from a drop or
// the picker); this service checks each is an ordinary file, detects it in the engine worker,
// computes the targets the verified engines can produce, and issues a file ID. Conversions are
// requested by that ID only, and the file is re-checked before work starts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KINDS } = require('../domain/formats.cjs');
const { targetsFor } = require('../domain/capabilities.cjs');

class IntakeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

class FileIntakeService {
  /**
   * @param {object} o
   * @param {(file: string) => Promise<object>} o.detect detection in the engine worker
   * @param {{ has(cap: string): boolean, probe(): Promise<unknown> }} o.tools
   * @param {object} o.limits domain/limits.cjs `intake`
   */
  constructor({ detect, tools, limits }) {
    this.detect = detect;
    this.tools = tools;
    this.limits = limits;
    this.files = new Map(); // fileId -> record
  }

  validatePaths(paths) {
    if (!Array.isArray(paths)) throw new IntakeError('bad-request');
    if (paths.length > this.limits.maxPathsPerRequest) throw new IntakeError('too-many-files');
    for (const p of paths) {
      if (typeof p !== 'string' || !p || p.length > this.limits.maxPathLength || p.includes('\0') || !path.isAbsolute(p)) throw new IntakeError('bad-path');
    }
  }

  async detectOne(p) {
    // path.resolve, not realpath: on Windows realpath turns mapped drives into UNC paths, and
    // outputs must land (and be shown) where the user dropped the file.
    const real = path.resolve(p);
    let st;
    try { st = fs.statSync(real); } catch { return { path: p, ok: false, error: 'missing' }; }
    if (!st.isFile()) return { path: p, ok: false, error: 'not-a-file', size: 0 };
    let d;
    try { d = await this.detect(real); } catch (e) { return { path: p, ok: false, error: e.code === 'timeout' ? 'detect-timeout' : 'unreadable', size: st.size }; }
    if (!d.ok) return { path: p, ok: false, error: d.error, size: d.size ?? st.size };
    const t = targetsFor(d, (cap) => this.tools.has(cap));
    if (!t.available.length) {
      return { path: p, ok: false, error: t.unavailable.length ? 'missing-tools' : 'unsupported', kind: d.kind, label: d.label, size: d.size,
        missing: [...new Set(t.unavailable.flatMap((u) => u.missing))] };
    }
    const id = crypto.randomUUID();
    this.files.set(id, { id, path: p, realPath: real, size: st.size, mtimeMs: st.mtimeMs, kind: d.kind, ext: d.ext });
    return {
      id, path: p, ok: true, kind: d.kind, label: KINDS[d.kind].label, ext: d.ext, size: d.size, renamed: d.renamed,
      confidence: d.confidence, targets: t.available, defaultTarget: t.available[0], fidelity: t.fidelity, limits: t.limits,
      unavailable: t.unavailable.map((u) => u.target),
    };
  }

  async detectPaths(paths) {
    this.validatePaths(paths);
    await this.tools.probe();
    return pool(paths, this.limits.detectConcurrency, (p) => this.detectOne(p));
  }

  get(fileId) { return typeof fileId === 'string' ? this.files.get(fileId) || null : null; }

  release(fileId) { this.files.delete(fileId); }

  // Before a job starts: the file must still be there, unchanged since it was detected.
  revalidate(fileId) {
    const f = this.get(fileId);
    if (!f) throw new IntakeError('unknown-file');
    let st;
    try { st = fs.statSync(f.realPath); } catch { throw new IntakeError('file-changed'); }
    if (!st.isFile() || st.size !== f.size || st.mtimeMs !== f.mtimeMs) throw new IntakeError('file-changed');
    return f;
  }
}

module.exports = { FileIntakeService, IntakeError };
