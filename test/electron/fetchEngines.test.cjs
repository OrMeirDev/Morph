const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { validateLock, obtain, pickRelease, trimLibreOffice, stripAdminImage } = require('../../scripts/fetch-engines.cjs');
const { tmpDir } = require('./helpers.cjs');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const engine = (over = {}) => ({
  name: 'tool', version: '1.0', license: 'MIT', source: 'https://example.org', install: { recipe: 'files' },
  download: { url: 'https://example.org/tool.zip', sha256: 'a'.repeat(64), type: 'zip' }, ...over,
});

test('the committed lock is valid and every engine is pinned to an https URL and a SHA-256', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/engines.lock.json'), 'utf8'));
  assert.deepEqual(validateLock(lock, { requirePinned: true }), []);
  assert.deepEqual(lock.engines.map((e) => e.name).sort(), ['7zip', 'calibre', 'ffmpeg', 'libreoffice', 'poppler']);
});

test('lock validation: unpinned entries fail only with --require-pinned; bad hashes always fail', () => {
  const unpinned = { version: 1, engines: [engine({ download: { resolve: { github: 'o/r', asset: 'x' }, type: 'zip' } })] };
  assert.deepEqual(validateLock(unpinned, { requirePinned: false }), []);
  assert.match(validateLock(unpinned, { requirePinned: true })[0], /not pinned/);
  assert.match(validateLock({ version: 1, engines: [engine({ download: { url: 'https://x/y', sha256: 'XYZ', type: 'zip' } })] }, { requirePinned: false })[0], /64 lowercase hex/);
  assert.match(validateLock({ version: 1, engines: [engine({ download: { url: 'http://x/y', sha256: 'a'.repeat(64), type: 'zip' } })] }, { requirePinned: true })[0], /not pinned/);
  assert.match(validateLock({ version: 1, engines: [engine(), engine()] }, { requirePinned: false })[0], /duplicated/);
});

// A local server standing in for the download host.
async function serve(bodies) {
  const hits = {};
  const server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    const b = bodies[req.url];
    if (!b) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': b.length });
    res.end(b);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, hits, close: () => new Promise((r) => server.close(r)) };
}

test('a fresh download is verified, cached, and the cache is re-verified on the next run', async () => {
  const body = Buffer.from('engine payload v1');
  const s = await serve({ '/tool.zip': body });
  const cacheDir = tmpDir('cache');
  try {
    const e = engine({ download: { url: `${s.base}/tool.zip`, sha256: sha(body), type: 'zip' } });
    const first = await obtain(e, { cacheDir });
    assert.equal(first.cached, false);
    assert.equal(first.sha256, sha(body));
    const second = await obtain(e, { cacheDir });
    assert.equal(second.cached, true);
    assert.equal(s.hits['/tool.zip'], 1, 'the cache was used');
    // The cached file is changed (partial copy, tampering): refuse, do not silently refetch.
    fs.appendFileSync(second.file, 'x');
    await assert.rejects(obtain(e, { cacheDir }), /cached download .* does not match the lock/);
  } finally {
    await s.close();
  }
});

test('a download that does not match the pinned hash is rejected and not kept', async () => {
  const s = await serve({ '/tool.zip': Buffer.from('something else') });
  const cacheDir = tmpDir('cache');
  try {
    const e = engine({ download: { url: `${s.base}/tool.zip`, sha256: sha(Buffer.from('the pinned bytes')), type: 'zip' } });
    await assert.rejects(obtain(e, { cacheDir }), /does not match the lock .* nothing was installed/);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  } finally {
    await s.close();
  }
});

test('a missing file on the host is a clear error', async () => {
  const s = await serve({});
  try {
    await assert.rejects(obtain(engine({ download: { url: `${s.base}/gone.zip`, sha256: 'a'.repeat(64), type: 'zip' } }), { cacheDir: tmpDir('cache') }), /download failed \(404\)/);
  } finally {
    await s.close();
  }
});

test('release resolution picks the newest stable release old enough, with a matching asset', () => {
  const now = Date.parse('2026-10-14T00:00:00Z');
  const rel = (tag, date, names, extra = {}) => ({ tag_name: tag, published_at: date, assets: names.map((n) => ({ name: n, browser_download_url: `https://dl/${tag}/${n}` })), ...extra });
  const releases = [
    rel('v3', '2026-10-10T00:00:00Z', ['Release-3.zip']), // too new
    rel('v2b', '2026-09-20T00:00:00Z', ['Release-2b.zip'], { prerelease: true }),
    rel('v2', '2026-09-15T00:00:00Z', ['source.tar.gz']), // no matching asset
    rel('v1', '2026-08-01T00:00:00Z', ['Release-1.zip']),
  ];
  assert.deepEqual(pickRelease(releases, { asset: '^Release-.*\\.zip$', minAgeDays: 14, now }), { tag: 'v1', publishedAt: '2026-08-01T00:00:00Z', url: 'https://dl/v1/Release-1.zip', name: 'Release-1.zip' });
  assert.equal(pickRelease(releases, { asset: 'nothing', now }), null);
});

test('LibreOffice trimming keeps English and Hebrew and the default icon theme', () => {
  const lo = tmpDir('lo');
  const mk = (rel) => { fs.mkdirSync(path.dirname(path.join(lo, rel)), { recursive: true }); fs.writeFileSync(path.join(lo, rel), 'x'); };
  ['program/resource/common/a', 'program/resource/he/a', 'program/resource/fr/a', 'share/extensions/dict-fr/x',
    'share/registry/res/fcfg_langpack_en-US.xcd', 'share/registry/res/fcfg_langpack_he.xcd', 'share/registry/res/fcfg_langpack_fr.xcd',
    'share/registry/Langpack-en-US.xcd', 'share/registry/Langpack-he.xcd', 'share/registry/Langpack-de.xcd', 'share/registry/main.xcd',
    'share/config/images_colibre.zip', 'share/config/images_sifr.zip', 'program/soffice.com'].forEach(mk);
  trimLibreOffice(lo);
  const exists = (rel) => fs.existsSync(path.join(lo, rel));
  for (const kept of ['program/resource/common', 'program/resource/he', 'share/registry/res/fcfg_langpack_en-US.xcd', 'share/registry/res/fcfg_langpack_he.xcd',
    'share/registry/Langpack-en-US.xcd', 'share/registry/Langpack-he.xcd', 'share/registry/main.xcd', 'share/config/images_colibre.zip', 'program/soffice.com']) assert.ok(exists(kept), kept);
  for (const gone of ['program/resource/fr', 'share/extensions/dict-fr', 'share/registry/res/fcfg_langpack_fr.xcd', 'share/registry/Langpack-de.xcd', 'share/config/images_sifr.zip']) assert.ok(!exists(gone), gone);
  assert.ok(exists('share/extensions'), 'empty extensions folder kept');
});

test('the copy of the package an administrative install leaves at the top is removed, nothing else', () => {
  const x = tmpDir('adm');
  fs.writeFileSync(path.join(x, 'LibreOffice_26.2.6.3_Win_x86-64.msi'), 'admin image copy');
  fs.mkdirSync(path.join(x, 'program'));
  fs.writeFileSync(path.join(x, 'program', 'soffice.exe'), 'x');
  fs.writeFileSync(path.join(x, 'program', 'inner.msi'), 'part of the engine, kept');
  assert.deepEqual(stripAdminImage(x), ['LibreOffice_26.2.6.3_Win_x86-64.msi']);
  assert.deepEqual(fs.readdirSync(x), ['program']);
  assert.deepEqual(fs.readdirSync(path.join(x, 'program')).sort(), ['inner.msi', 'soffice.exe']);
});

test('the committed payload manifest contains no administrative-install package copy', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bin-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(m.files).filter((k) => /^[^/]+\/[^/]+\.msi$/i.test(k)), []);
  assert.equal(m.fileCount, Object.keys(m.files).length);
});
