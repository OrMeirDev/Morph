// Owns LibreOffice's user profile. One profile per LibreOffice build (a different bundled version
// gets a fresh profile instead of reusing an incompatible one), used by one conversion at a time,
// initialised deterministically and marked ready only after a complete first start.
//
// The profile path must stay short: its folders nest deep and a long base path pushes them past
// Windows' 260-character limit, after which LibreOffice exits 0 having converted nothing
// (measured: works at 146 characters, fails from about 150).
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const limits = require('../domain/limits.cjs');

const MAX_PROFILE_PATH = 100;
const READY_MARKER = '.morph-ready';

class OfficeProfileManager {
  constructor({ baseDir } = {}) {
    const fallback = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'MorphLO');
    this.baseDir = baseDir && baseDir.length <= MAX_PROFILE_PATH - 8 ? baseDir : fallback;
    this.lock = Promise.resolve();
  }

  // Short, stable tag for the LibreOffice build in use (its launcher's size and modification time).
  profileDirFor(sofficePath) {
    let tag = 'default';
    try {
      const st = fs.statSync(sofficePath);
      tag = crypto.createHash('sha1').update(`${sofficePath}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 6);
    } catch { /* keep default */ }
    return `${this.baseDir}-${tag}`;
  }

  // Healthy = finished first start (marker) and a full registry (an interrupted first start leaves
  // a ~1 KB registrymodifications.xcu instead of ~9 KB).
  static healthy(dir) {
    try {
      return fs.existsSync(path.join(dir, READY_MARKER))
        && fs.statSync(path.join(dir, 'user', 'registrymodifications.xcu')).size > 4 * 1024;
    } catch {
      return false;
    }
  }

  async initialise(ctx, dir) {
    await fsp.rm(dir, { recursive: true, force: true });
    await ctx.run('soffice', ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(dir).href}`, '--terminate_after_init'], { timeoutMs: limits.deadlines.office });
    if (fs.existsSync(path.join(dir, 'user'))) await fsp.writeFile(path.join(dir, READY_MARKER), new Date().toISOString());
  }

  /**
   * Runs `convert(profileUrl)` with exclusive use of a healthy profile. `convert` returns whether
   * LibreOffice produced its file; if not, the profile is rebuilt once and the conversion retried.
   */
  withProfile(ctx, convert) {
    const turn = this.lock.then(async () => {
      const dir = this.profileDirFor(ctx.toolPath('soffice'));
      const url = pathToFileURL(dir).href;
      if (!OfficeProfileManager.healthy(dir)) await this.initialise(ctx, dir);
      if (await convert(url)) return;
      ctx.throwIfCancelled();
      await this.initialise(ctx, dir); // one retry on a freshly built profile
      await convert(url);
    });
    this.lock = turn.catch(() => {});
    return turn;
  }
}

module.exports = { OfficeProfileManager, MAX_PROFILE_PATH };
