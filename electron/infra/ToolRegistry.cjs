// Finds the bundled engines and verifies what they can actually do. A tool counts as available
// only after it ran and answered a version/feature probe, never because a file exists.
//
// Resolution order for each tool:
//   1. MORPH_TOOL_<NAME> environment override (absolute path; development and tests)
//   2. resources/bin and <repo>/bin, Windows layout (fetch-bin.ps1)
//   3. off Windows only: the same tool on PATH (development on Linux/macOS)
const fs = require('fs');
const path = require('path');
const { runProcess } = require('./ProcessRunner.cjs');
const limits = require('../domain/limits.cjs');

const IS_WIN = process.platform === 'win32';

const TOOLS = {
  ffmpeg: { win: 'ffmpeg/ffmpeg.exe', posix: ['ffmpeg'] },
  ffprobe: { win: 'ffmpeg/ffprobe.exe', posix: ['ffprobe'] },
  sevenzip: { win: '7zip/7z.exe', posix: ['7z', '7zz', '7za'] },
  pdftoppm: { win: 'poppler/pdftoppm.exe', posix: ['pdftoppm'] },
  pdftotext: { win: 'poppler/pdftotext.exe', posix: ['pdftotext'] },
  pdfinfo: { win: 'poppler/pdfinfo.exe', posix: ['pdfinfo'] },
  // soffice.exe is a launcher that returns at once; soffice.com waits for the conversion.
  soffice: { win: 'libreoffice/program/soffice.com', posix: ['soffice', 'libreoffice'] },
  calibre: { win: 'calibre/ebook-convert.exe', posix: ['ebook-convert'] },
};

const envName = (name) => `MORPH_TOOL_${name.toUpperCase()}`;

function binRoots() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'bin'));
  roots.push(path.join(__dirname, '..', '..', 'bin'));
  return roots;
}

function onPath(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}

function resolveTool(name) {
  const spec = TOOLS[name];
  if (!spec) return null;
  const override = process.env[envName(name)];
  if (override) return fs.existsSync(override) ? override : null;
  for (const root of binRoots()) {
    const p = path.join(root, spec.win);
    if (fs.existsSync(p)) return p;
  }
  if (!IS_WIN) for (const cmd of spec.posix) { const p = onPath(cmd); if (p) return p; }
  return null;
}

// Probes, each returning { version } or throwing. Short deadlines: a probe must never block intake.
const PROBES = {
  ffmpeg: async (exe, run) => {
    const v = await run(exe, ['-hide_banner', '-version']);
    const enc = await run(exe, ['-hide_banner', '-encoders'], { captureStdout: true });
    const encoders = new Set([...enc.stdout.matchAll(/^\s[A-Z.]{6}\s+(\S+)/gm)].map((m) => m[1]));
    return { version: (v.stdout.match(/version (\S+)/) || [])[1] || 'unknown', encoders };
  },
  ffprobe: async (exe, run) => ({ version: ((await run(exe, ['-hide_banner', '-version'])).stdout.match(/version (\S+)/) || [])[1] || 'unknown' }),
  sevenzip: async (exe, run) => {
    // `7z` with no command prints its banner and exits 0 (7-Zip, p7zip and 7za alike).
    const r = await run(exe, []);
    return { version: ((r.stdout.match(/7-Zip[^\n]*?(\d+\.\d+)/) || [])[1]) || 'unknown' };
  },
  pdftoppm: async (exe, run) => ({ version: (((await run(exe, ['-v'])).stderrTail.match(/version (\S+)/)) || [])[1] || 'unknown' }),
  pdftotext: async (exe, run) => ({ version: (((await run(exe, ['-v'])).stderrTail.match(/version (\S+)/)) || [])[1] || 'unknown' }),
  pdfinfo: async (exe, run) => ({ version: (((await run(exe, ['-v'])).stderrTail.match(/version (\S+)/)) || [])[1] || 'unknown' }),
  soffice: async (exe, run) => ({ version: (((await run(exe, ['--headless', '--version'])).stdout.match(/LibreOffice (\S+)/)) || [])[1] || 'unknown' }),
  calibre: async (exe, run) => ({ version: (((await run(exe, ['--version'])).stdout.match(/calibre ([\d.]+)/)) || [])[1] || 'unknown' }),
};

class ToolRegistry {
  /** @param {{ probeImages?: () => Promise<{ sharp: string|null, heic: boolean }> }} [o] */
  constructor({ probeImages } = {}) {
    this.probeImages = probeImages;
    this.tools = {}; // name -> { path, ok, version, reason }
    this.images = { ok: false, heic: false, reason: 'not-probed' };
    this.ready = null;
  }

  path(name) {
    const t = this.tools[name];
    return t && t.ok ? t.path : null;
  }

  probe() {
    if (this.ready) return this.ready;
    const run = (exe, args, o = {}) => runProcess(exe, args, { timeoutMs: limits.deadlines.probe, name: path.basename(exe), ...o });
    const tasks = Object.keys(TOOLS).map(async (name) => {
      const exe = resolveTool(name);
      if (!exe) { this.tools[name] = { path: null, ok: false, reason: 'missing' }; return; }
      try {
        const info = await PROBES[name](exe, run);
        this.tools[name] = { path: exe, ok: true, ...info };
      } catch (e) {
        this.tools[name] = { path: exe, ok: false, reason: String(e.message || e).slice(0, 200) };
      }
    });
    if (this.probeImages) {
      tasks.push(this.probeImages().then(
        (r) => { this.images = { ok: !!r.sharp, heic: !!r.heic, version: r.sharp, reason: r.sharp ? null : 'sharp-unavailable' }; },
        (e) => { this.images = { ok: false, heic: false, reason: String(e.message || e).slice(0, 200) }; },
      ));
    }
    this.ready = Promise.all(tasks).then(() => this);
    return this.ready;
  }

  // Capability IDs used by domain/capabilities.cjs.
  has(cap) {
    const ok = (n) => !!this.tools[n]?.ok;
    if (cap.startsWith('ffmpeg:enc:')) return ok('ffmpeg') && !!this.tools.ffmpeg.encoders?.has(cap.slice(11));
    switch (cap) {
      case 'images': return this.images.ok;
      case 'images:heic': return this.images.ok && this.images.heic;
      case 'ffmpeg': return ok('ffmpeg') && ok('ffprobe');
      case 'calibre': return ok('calibre');
      default: return ok(cap);
    }
  }

  // The per-family summary the settings page and sidebar show.
  status() {
    const ok = (n) => !!this.tools[n]?.ok;
    return {
      ffmpeg: ok('ffmpeg') && ok('ffprobe'),
      images: this.images.ok,
      poppler: ok('pdftoppm') && ok('pdftotext') && ok('pdfinfo'),
      libreoffice: ok('soffice'),
      calibre: ok('calibre'),
      sevenzip: ok('sevenzip'),
      details: Object.fromEntries([...Object.entries(this.tools).map(([k, v]) => [k, { ok: v.ok, version: v.version || null, reason: v.reason || null }]),
        ['images', { ok: this.images.ok, version: this.images.version || null, heic: this.images.heic, reason: this.images.reason || null }]]),
    };
  }
}

module.exports = { ToolRegistry, resolveTool, TOOLS };
