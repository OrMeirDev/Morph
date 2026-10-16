// Versioned, atomically written JSON stores for settings, history and the job journal. A corrupt
// file is set aside (".corrupt-<time>") and replaced by defaults instead of breaking startup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
  }

  read() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return this.fallback(); }
    try { return JSON.parse(text); } catch {
      try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* keep going */ }
      return this.fallback();
    }
  }

  // Write to a sibling temp file, flush, then rename over the old one: readers see the old or the
  // new content, never half of it.
  write(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tmp, this.file);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
}

// ---------- settings ----------

const QUALITIES = ['high', 'medium', 'small'];
const MAX_HEIGHTS = [null, 1080, 720, 480];
const SETTINGS_VERSION = 1;

class SettingsError extends Error {
  constructor(detail) { super(`invalid-setting:${detail}`); this.code = 'invalid-setting'; }
}

function validSettingValue(key, v) {
  switch (key) {
    case 'outputMode': return v === 'beside' || v === 'folder';
    case 'folder': return typeof v === 'string' && v.length > 0 && v.length <= 1024 && path.isAbsolute(v) && !v.includes('\0');
    case 'quality': return QUALITIES.includes(v);
    case 'maxHeight': return MAX_HEIGHTS.includes(v);
    default: return false;
  }
}

class SettingsRepository {
  constructor(dir, { defaultFolder }) {
    this.store = new JsonStore(path.join(dir, 'settings.json'), () => ({}));
    this.defaults = { outputMode: 'beside', folder: defaultFolder, quality: 'high', maxHeight: null };
  }

  get() {
    const raw = this.store.read();
    const out = { ...this.defaults };
    // Version 0 (Morph <= 1.0.3) had the same keys without a version; unknown or invalid values
    // fall back to the defaults one by one.
    for (const k of Object.keys(this.defaults)) if (raw && k in raw && validSettingValue(k, raw[k])) out[k] = raw[k];
    return out;
  }

  patch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('patch');
    for (const [k, v] of Object.entries(patch)) if (!validSettingValue(k, v)) throw new SettingsError(k);
    const next = { ...this.get(), ...patch };
    this.store.write({ version: SETTINGS_VERSION, ...next });
    return next;
  }
}

// ---------- history ----------

const HISTORY_VERSION = 1;

class HistoryRepository {
  constructor(dir, { maxEntries = 1000 } = {}) {
    this.store = new JsonStore(path.join(dir, 'history.json'), () => ({ version: HISTORY_VERSION, entries: [] }));
    this.maxEntries = maxEntries;
  }

  list() {
    const raw = this.store.read();
    const entries = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : []; // v0 was a bare array
    return entries.filter((e) => e && typeof e.output === 'string' && typeof e.name === 'string')
      .map((e, i) => ({ id: e.id || `legacy-${i}`, name: e.name, from: e.from, to: e.to, output: e.output, convertedAt: e.convertedAt }));
  }

  add({ name, from, to, output, jobId }) {
    const entry = { id: jobId || crypto.randomUUID(), name, from, to, output, convertedAt: new Date().toISOString() };
    this.store.write({ version: HISTORY_VERSION, entries: [entry, ...this.list()].slice(0, this.maxEntries) });
    return entry;
  }

  clear() { this.store.write({ version: HISTORY_VERSION, entries: [] }); }

  // Only outputs Morph itself published may be opened or revealed on request from the renderer.
  hasOutput(p) {
    const key = process.platform === 'win32' ? String(p).toLowerCase() : String(p);
    return this.list().some((e) => (process.platform === 'win32' ? e.output.toLowerCase() : e.output) === key);
  }
}

// ---------- job journal ----------

// Records non-terminal jobs and every path they could leave behind, so a crash or forced quit is
// cleaned up on the next start. Jobs are never restarted automatically.
class JobRepository {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'jobs.json'), () => ({ version: 1, active: {} }));
  }

  all() { const r = this.store.read(); return r && r.active && typeof r.active === 'object' ? r.active : {}; }

  put(jobId, record) {
    const active = this.all();
    active[jobId] = { ...(active[jobId] || {}), ...record, leftovers: [...new Set([...(active[jobId]?.leftovers || []), ...(record.leftovers || [])])] };
    this.store.write({ version: 1, active });
  }

  addLeftover(jobId, p) { this.put(jobId, { leftovers: [p] }); }

  remove(jobId) {
    const active = this.all();
    if (!(jobId in active)) return;
    delete active[jobId];
    this.store.write({ version: 1, active });
  }

  // Returns the interrupted records and clears the journal.
  takeInterrupted() {
    const active = this.all();
    this.store.write({ version: 1, active: {} });
    return Object.entries(active).map(([jobId, r]) => ({ jobId, ...r }));
  }
}

module.exports = { JsonStore, SettingsRepository, HistoryRepository, JobRepository, SettingsError, validSettingValue };
