// Fetches the conversion engines Morph bundles into bin/, exactly as pinned in
// scripts/engines.lock.json: every download is checked against its SHA-256 before anything is
// extracted, cached downloads are re-checked on every run, and an unpinned or mismatched payload
// stops with a message that says what to do.
//
//   node scripts/fetch-engines.cjs                    fetch + install all engines (Windows)
//   node scripts/fetch-engines.cjs --require-pinned   refuse anything without an exact URL + SHA-256
//   node scripts/fetch-engines.cjs --resolve-out f    (CI) resolve unpinned GitHub releases, write the
//                                                     resolved lock with computed hashes to f
//   node scripts/fetch-engines.cjs --download-only    download and verify, do not extract
//   options: --only <name>[,<name>], --cache <dir> (default .cache/engines), --bin <dir> (default bin)
//
// Extraction needs Windows (msiexec /a administrative extract, tar for zip): it copies files and
// installs nothing on the machine.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCK = path.join(__dirname, 'engines.lock.json');

class FetchError extends Error {}

// ---------- lock ----------

const SHA = /^[0-9a-f]{64}$/;

function validateLock(lock, { requirePinned }) {
  const problems = [];
  if (!lock || lock.version !== 1 || !Array.isArray(lock.engines)) return ['engines.lock.json: unknown format'];
  const names = new Set();
  for (const e of lock.engines) {
    if (!e.name || names.has(e.name)) problems.push(`engine name missing or duplicated: ${e.name}`);
    names.add(e.name);
    for (const k of ['version', 'license', 'source', 'install']) if (!e[k]) problems.push(`${e.name}: "${k}" is required`);
    const d = e.download || {};
    const pinned = typeof d.url === 'string' && /^https:\/\//.test(d.url) && SHA.test(d.sha256 || '');
    if (requirePinned && !pinned) problems.push(`${e.name}: not pinned (needs download.url (https) and download.sha256)`);
    if (!pinned && !d.url && !d.resolve) problems.push(`${e.name}: needs download.url or download.resolve`);
    if (d.sha256 && !SHA.test(d.sha256)) problems.push(`${e.name}: sha256 must be 64 lowercase hex characters`);
  }
  return problems;
}

// ---------- download + verify ----------

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

async function download(url, dest, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new FetchError(`download failed (${res.status}) ${url}`);
  const part = `${dest}.part`;
  const h = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  try {
    for await (const chunk of res.body) {
      h.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    await fsp.rm(part, { force: true });
    throw e;
  }
  await fsp.rename(part, dest);
  return h.digest('hex');
}

// Returns the verified local file. A cached file is trusted only if its hash still matches.
async function obtain(engine, { cacheDir, fetchImpl, log = () => {} }) {
  const { url, sha256 } = engine.download;
  const file = path.join(cacheDir, `${engine.name}-${engine.version}-${path.basename(new URL(url).pathname)}`);
  await fsp.mkdir(cacheDir, { recursive: true });
  if (fs.existsSync(file)) {
    const got = await sha256File(file);
    if (sha256 && got !== sha256) {
      throw new FetchError(`${engine.name}: cached download ${file} does not match the lock (expected ${sha256}, got ${got}). It is partial or was changed: delete it and run again.`);
    }
    log(`${engine.name}: cached download verified`);
    return { file, sha256: got, cached: true };
  }
  log(`${engine.name}: downloading ${url}`);
  const got = await download(url, file, fetchImpl);
  if (sha256 && got !== sha256) {
    await fsp.rm(file, { force: true });
    throw new FetchError(`${engine.name}: download does not match the lock (expected ${sha256}, got ${got}); nothing was installed. The source changed the file or the transfer was tampered with.`);
  }
  return { file, sha256: got, cached: false };
}

// ---------- resolving unpinned GitHub releases (CI only, never with --require-pinned) ----------

// Picks the newest non-draft, non-prerelease release at least minAgeDays old that has a matching
// asset. Pure over the release list, so it is unit-tested.
function pickRelease(releases, { asset, minAgeDays = 14, now = Date.now() }) {
  const re = new RegExp(asset);
  const cutoff = now - minAgeDays * 86400000;
  for (const r of [...releases].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))) {
    if (r.draft || r.prerelease || Date.parse(r.published_at) > cutoff) continue;
    const a = (r.assets || []).find((x) => re.test(x.name));
    if (a) return { tag: r.tag_name, publishedAt: r.published_at, url: a.browser_download_url, name: a.name };
  }
  return null;
}

async function resolveGithub(engine, fetchImpl = fetch) {
  const { github, asset, minAgeDays } = engine.download.resolve;
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetchImpl(`https://api.github.com/repos/${github}/releases?per_page=30`, { headers });
  if (!res.ok) throw new FetchError(`${engine.name}: cannot list releases of ${github} (${res.status})`);
  const pick = pickRelease(await res.json(), { asset, minAgeDays });
  if (!pick) throw new FetchError(`${engine.name}: no release of ${github} older than ${minAgeDays} days has an asset matching ${asset}`);
  return pick;
}

// ---------- extraction (Windows) ----------

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) throw new FetchError(`${cmd} ${args.join(' ')} failed (${r.status ?? r.error?.message})`);
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}

function extract(file, type, dest) {
  if (process.platform !== 'win32') throw new FetchError('extracting engines needs Windows (msiexec); use --download-only elsewhere');
  fs.mkdirSync(dest, { recursive: true });
  if (type === 'msi') run('msiexec.exe', ['/a', file, '/qn', `TARGETDIR=${dest}`]);
  else if (type === 'zip') run('tar.exe', ['-xf', file, '-C', dest]); // bsdtar ships with Windows 10+
  else throw new FetchError(`unknown download type ${type}`);
}

// Install recipes: lay files out where electron/infra/ToolRegistry.cjs looks for them.
const RECIPES = {
  // copy the named files from the folder holding the anchor
  files: (x, e, bin) => {
    const anchor = findFile(x, e.install.anchor);
    if (!anchor) throw new FetchError(`${e.name}: ${e.install.anchor} not found in the download`);
    const to = path.join(bin, e.install.to);
    fs.mkdirSync(to, { recursive: true });
    for (const f of e.install.files) {
      const src = path.join(path.dirname(anchor), f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, f));
      else if (!(e.install.optional || []).includes(f)) throw new FetchError(`${e.name}: ${f} missing next to ${e.install.anchor}`);
    }
  },
  // copy the whole folder holding the anchor (levelsUp: 0 = that folder, 1 = its parent, ...)
  folder: (x, e, bin) => {
    const anchor = findFile(x, e.install.anchor);
    if (!anchor) throw new FetchError(`${e.name}: ${e.install.anchor} not found in the download`);
    let from = path.dirname(anchor);
    for (let i = 0; i < (e.install.levelsUp || 0); i++) from = path.dirname(from);
    fs.cpSync(from, path.join(bin, e.install.to), { recursive: true });
  },
};

// Headless conversion needs neither the bundled extensions (~600 MB of dictionaries, whose first-
// start registration left half-built profiles) nor UI languages other than English and Hebrew.
function trimLibreOffice(lo) {
  const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
  const ext = path.join(lo, 'share', 'extensions');
  if (fs.existsSync(ext)) { rm(ext); fs.mkdirSync(ext); }
  const res = path.join(lo, 'program', 'resource');
  if (fs.existsSync(res)) for (const d of fs.readdirSync(res)) if (!['common', 'he'].includes(d)) rm(path.join(res, d));
  const reg = path.join(lo, 'share', 'registry');
  const regRes = path.join(reg, 'res');
  if (fs.existsSync(regRes)) for (const f of fs.readdirSync(regRes)) if (!/_(en-US|he)\.xcd$/.test(f)) rm(path.join(regRes, f));
  if (fs.existsSync(reg)) for (const f of fs.readdirSync(reg)) if (/^Langpack-.*\.xcd$/.test(f) && !['Langpack-en-US.xcd', 'Langpack-he.xcd'].includes(f)) rm(path.join(reg, f));
  const cfg = path.join(lo, 'share', 'config');
  if (fs.existsSync(cfg)) for (const f of fs.readdirSync(cfg)) if (/^images_.*\.zip$/.test(f) && f !== 'images_colibre.zip') rm(path.join(cfg, f));
}
const POST = { trimLibreOffice };

// ---------- main ----------

function parseArgs(argv) {
  const o = { requirePinned: false, downloadOnly: false, only: null, cache: path.join(ROOT, '.cache', 'engines'), bin: path.join(ROOT, 'bin'), resolveOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--require-pinned') o.requirePinned = true;
    else if (a === '--download-only') o.downloadOnly = true;
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--cache') o.cache = path.resolve(argv[++i]);
    else if (a === '--bin') o.bin = path.resolve(argv[++i]);
    else if (a === '--resolve-out') o.resolveOut = path.resolve(argv[++i]);
    else throw new FetchError(`unknown option ${a}`);
  }
  return o;
}

async function main(argv) {
  const o = parseArgs(argv);
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const problems = validateLock(lock, { requirePinned: o.requirePinned });
  if (problems.length) throw new FetchError(`engines.lock.json:\n  ${problems.join('\n  ')}`);
  const engines = lock.engines.filter((e) => !o.only || o.only.includes(e.name));
  const resolved = JSON.parse(JSON.stringify(lock));
  const installed = [];
  for (const e of engines) {
    const entry = resolved.engines.find((x) => x.name === e.name);
    if (!e.download.url) {
      const pick = await resolveGithub(e);
      console.log(`${e.name}: resolved ${e.download.resolve.github} ${pick.tag} (${pick.publishedAt.slice(0, 10)}) ${pick.name}`);
      e.download = { ...e.download, url: pick.url, tag: pick.tag };
      entry.version = pick.tag;
      e.version = pick.tag;
    } else if (!e.download.sha256) {
      console.warn(`WARNING ${e.name}: no sha256 in the lock; the hash below is only recorded, not verified`);
    }
    const got = await obtain(e, { cacheDir: o.cache, log: (m) => console.log(m) });
    entry.download = { url: e.download.url, sha256: got.sha256, type: e.download.type };
    console.log(`${e.name} ${e.version}: sha256 ${got.sha256}${got.cached ? ' (cache)' : ''}`);
    if (o.downloadOnly) continue;
    const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), `morph-engine-${e.name}-`));
    try {
      extract(got.file, e.download.type, scratch);
      fs.rmSync(path.join(o.bin, e.install.to), { recursive: true, force: true });
      RECIPES[e.install.recipe](scratch, e, o.bin);
      for (const step of e.install.post || []) POST[step](path.join(o.bin, e.install.to));
      installed.push({ name: e.name, version: e.version, url: e.download.url, sha256: got.sha256, license: e.license, source: e.source, sourceCode: e.sourceCode || null });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  if (o.resolveOut) fs.writeFileSync(o.resolveOut, `${JSON.stringify(resolved, null, 2)}\n`);
  if (installed.length) {
    fs.mkdirSync(o.bin, { recursive: true });
    fs.writeFileSync(path.join(o.bin, 'ENGINES.json'), `${JSON.stringify({ engines: installed }, null, 2)}\n`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof FetchError ? `fetch-engines: ${e.message}` : e);
    process.exit(1);
  });
}

module.exports = { validateLock, obtain, download, sha256File, pickRelease, trimLibreOffice, FetchError, main };
