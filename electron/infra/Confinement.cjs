// Runs engines confined on Windows (backlog D2), through native/confine/morph-confine.exe.
//
// Separate guarantees, reported separately:
//   - lifetime and resources (Job Object, every engine): every process an engine starts belongs to
//     one job that is killed on cancel, when Morph dies, when the engine exits leaving processes
//     behind, or when a memory/process limit is hit;
//   - file and network access, per engine (domain/confinementPolicy.cjs, chosen from measurements):
//       'appcontainer'   AppContainer with no capabilities: reads only its own install folder,
//                        writes only to the job workspace, no network (loopback included);
//       'low-integrity'  restricted Low-integrity token, for engines measured not to run in an
//                        AppContainer: writes only where Morph labelled Low (the workspace, the
//                        LibreOffice profile), but may READ the user's files and use the network.
// Nothing falls back silently: if confinement is required and unavailable, engines are refused
// with the reason, and the status lists each engine's isolation.
//
// Modes (status().mode):
//   enforced     Windows, helper present: as above
//   unavailable  Windows, helper missing or broken: engines refused (reason in the status)
//   disabled     MORPH_CONFINEMENT=off: engines run unconfined; shown as such (diagnostics only)
//   unsupported  not Windows (development and CI hosts): unconfined, shown as such
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ToolError } = require('./errors.cjs');
const policy = require('../domain/confinementPolicy.cjs');

const HELPER_NAME = 'morph-confine.exe';
// Before per-job identities, every job shared this AppContainer profile; the uninstaller still
// deletes it for installs that created it.
const PROFILE = 'Morph.Engines';
// Read access to Morph's own folders (engines, the worker's runtime and code) is granted once to
// this custom capability; every job's AppContainer carries it. Write access is granted only to the
// job's own AppContainer SID, derived from the job workspace, so jobs cannot reach each other.
const READ_CAPABILITY = 'morph.engines.read';
const jobName = (prefix, workspace) => `${prefix}.${crypto.createHash('sha256').update(path.resolve(workspace).toLowerCase()).digest('hex').slice(0, 24)}`;

function helperCandidates() {
  const c = [];
  if (process.env.MORPH_CONFINE_HELPER) c.push(process.env.MORPH_CONFINE_HELPER);
  if (process.resourcesPath) c.push(path.join(process.resourcesPath, 'native', HELPER_NAME));
  c.push(path.join(__dirname, '..', '..', 'native', 'out', HELPER_NAME));
  return c;
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// MORPH_CONFINE_LIMITS='{"soffice":{"jobMemoryMb":4096}}' raises or lowers a limit (diagnostics,
// unusually large files). Unknown tools or non-numeric values are ignored.
function withOverrides(base, raw = process.env.MORPH_CONFINE_LIMITS) {
  if (!raw) return base;
  let o;
  try { o = JSON.parse(raw); } catch { return base; }
  const out = { ...base };
  for (const [tool, v] of Object.entries(o || {})) {
    if (!policy.tools[tool] || !v || typeof v !== 'object') continue;
    const clean = {};
    for (const k of ['jobMemoryMb', 'maxProcesses']) if (Number.isInteger(v[k]) && v[k] > 0) clean[k] = v[k];
    out[tool] = { ...(out[tool] || {}), ...clean };
  }
  return out;
}

class Confinement {
  /**
   * @param {object} o
   * @param {string} [o.platform]
   * @param {string|null} [o.helper] helper path (found automatically when omitted)
   * @param {boolean} [o.disabled] MORPH_CONFINEMENT=off
   * @param {string[]} [o.ownedRoots] folders Morph owns (bin roots): only these get read grants
   * @param {Record<string, object>} [o.limits] per-tool limits, default domain/confinementPolicy.cjs
   */
  constructor({ platform = process.platform, helper, disabled = process.env.MORPH_CONFINEMENT === 'off', ownedRoots = [], limits = withOverrides(policy.limits), tools = policy.tools } = {}) {
    this.ownedRoots = ownedRoots.map((r) => path.resolve(r));
    this.limits = limits;
    this.tools = tools;
    this.helper = null;
    if (platform !== 'win32') { this.mode = 'unsupported'; this.reason = 'process confinement is implemented for Windows only'; return; }
    if (disabled) { this.mode = 'disabled'; this.reason = 'MORPH_CONFINEMENT=off: engines run without confinement'; return; }
    const found = helper || helperCandidates().find((p) => fs.existsSync(p));
    if (!found || !fs.existsSync(found)) { this.mode = 'unavailable'; this.reason = `${HELPER_NAME} not found (build it: node native/confine/build.cjs)`; return; }
    this.helper = found;
    this.mode = 'enforced';
    this.reason = null;
  }

  /** What the settings page and the tests show. */
  status() {
    return {
      mode: this.mode,
      reason: this.reason,
      tools: Object.fromEntries(Object.keys(this.tools).map((t) => [t, this.mode === 'enforced' ? this.tools[t].isolation : 'none'])),
      notes: this.mode === 'enforced' ? policy.notes : [],
    };
  }

  // The engine's own folder (e.g. bin/libreoffice for bin/libreoffice/program/soffice.com), when it
  // is inside a folder Morph owns. Elsewhere (a MORPH_TOOL_* override) nothing is granted.
  engineRoot(exe) {
    const abs = path.resolve(exe);
    for (const root of this.ownedRoots) {
      if (!isInside(abs, root)) continue;
      return path.join(root, path.relative(root, abs).split(path.sep)[0]);
    }
    return null;
  }

  /**
   * Prepares one confined call. Returns what to spawn, or the original call when not enforced.
   * @param {string} tool ToolRegistry name ('soffice', 'ffmpeg', ...)
   * @param {string} exe
   * @param {string[]} args
   * @param {{ workspace?: string, cwd?: string, write?: string[], read?: string[] }} o `read`: extra
   *   folders to read (the image worker's runtime and code); only folders Morph owns are granted
   */
  prepare(tool, exe, args, { workspace, cwd, write = [], read = [] } = {}) {
    if (this.mode === 'unavailable') throw new ToolError(`confinement-unavailable:${tool}:${this.reason}`, 'confinement-unavailable');
    if (this.mode !== 'enforced') return { exe, args, cwd, env: undefined, confined: false, readStats: () => null };
    const t = this.tools[tool];
    if (!t) throw new ToolError(`confinement-policy-missing:${tool}`, 'confinement-unavailable');
    if (!workspace) throw new ToolError(`confinement-no-workspace:${tool}`, 'confinement-unavailable');
    for (const sub of ['tmp', 'appdata']) fs.mkdirSync(path.join(workspace, sub), { recursive: true });
    const lim = { ...policy.defaults, ...(this.limits[tool] || {}) };
    const stats = path.join(os.tmpdir(), `morph-confine-${process.pid}-${crypto.randomUUID()}.json`);
    const h = [];
    if (t.isolation === 'appcontainer') {
      h.push('--appcontainer', jobName('Morph.Job', workspace), '--capability', READ_CAPABILITY);
      const roots = [this.engineRoot(exe), ...read.filter((r) => this.ownedRoots.some((o) => r === o || isInside(path.resolve(r), o)))].filter(Boolean);
      for (const r of [...new Set(roots)]) h.push('--read', r);
      for (const w of [workspace, ...write]) h.push('--write', w);
    } else if (t.isolation === 'low-integrity') {
      h.push('--low-integrity');
      if (t.restrictWrites) h.push('--restrict-writes', jobName('Morph.Writes', workspace));
      for (const w of [workspace, ...write]) h.push('--write', w);
    }
    if (lim.jobMemoryMb) h.push('--job-memory', String(lim.jobMemoryMb));
    if (lim.maxProcesses) h.push('--max-processes', String(lim.maxProcesses));
    h.push('--parent', String(process.pid), '--stats', stats, '--cwd', cwd || workspace, '--', exe, ...args);
    const tmp = path.join(workspace, 'tmp');
    const appdata = path.join(workspace, 'appdata');
    // Engines keep their scratch, caches and settings inside the workspace, the only place they may write.
    const env = { ...process.env, TEMP: tmp, TMP: tmp, APPDATA: appdata, LOCALAPPDATA: appdata,
      CALIBRE_CONFIG_DIRECTORY: path.join(appdata, 'calibre'), CALIBRE_TEMP_DIR: tmp, CALIBRE_CACHE_DIRECTORY: path.join(tmp, 'calibre-cache'),
      ...(t.env || {}) };
    return {
      exe: this.helper,
      args: h,
      cwd: cwd || workspace,
      env,
      confined: true,
      isolation: t.isolation,
      readStats: () => {
        try { const s = JSON.parse(fs.readFileSync(stats, 'utf8')); fs.rmSync(stats, { force: true }); return s; } catch { return null; }
      },
    };
  }
}

/** Maps the helper's outcome to an error, or null when the engine simply exited. */
function outcomeError(stats, name) {
  if (!stats) return null;
  switch (stats.outcome) {
    case 'limit-memory': return new ToolError(`limit-memory:${name}`, 'limit-memory');
    case 'limit-processes': return new ToolError(`limit-processes:${name}`, 'limit-processes');
    case 'setup-failed': return new ToolError(`confinement-failed:${name}:${stats.error}`.slice(0, 300), 'confinement-failed');
    case 'parent-gone': return new ToolError(`parent-gone:${name}`, 'cancelled');
    default: return null;
  }
}

module.exports = { Confinement, outcomeError, withOverrides, jobName, PROFILE, READ_CAPABILITY, HELPER_NAME };
