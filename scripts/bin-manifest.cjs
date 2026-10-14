// Records and verifies the exact engine payload Morph bundles (bin/), so a release ships the
// binaries that were tested, and a tampered, partial or swapped payload stops packaging.
//
//   node scripts/bin-manifest.cjs record   after fetch-bin + a passing test run: writes bin-manifest.json
//   node scripts/bin-manifest.cjs verify   before packaging (npm run dist / release): exits 1 on any
//                                          missing, changed or unexpected file, or no manifest
//
// The manifest is committed; review its diff like code (a changed hash is a changed engine).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function hashFile(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`symbolic link in payload: ${path.relative(base, p)}`);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

function snapshot(binDir) {
  const files = {};
  for (const rel of listFiles(binDir)) {
    const p = path.join(binDir, rel);
    files[rel] = { size: fs.statSync(p).size, sha256: hashFile(p) };
  }
  return files;
}

function record({ binDir, manifestFile, tools = {} }) {
  const files = snapshot(binDir);
  const manifest = { version: 1, recordedAt: new Date().toISOString(), tools, fileCount: Object.keys(files).length, files };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// Returns a list of problems (empty = payload matches the manifest exactly).
function verify({ binDir, manifestFile }) {
  if (!fs.existsSync(manifestFile)) return [`no manifest at ${path.relative(ROOT, manifestFile)}: run "node scripts/bin-manifest.cjs record" after fetch-bin and a passing test run`];
  if (!fs.existsSync(binDir)) return ['no bin/ folder: run npm run fetch-bin'];
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const expected = manifest.files || {};
  const problems = [];
  let actual;
  try { actual = listFiles(binDir); } catch (e) { return [e.message]; }
  const actualSet = new Set(actual);
  for (const rel of Object.keys(expected)) if (!actualSet.has(rel)) problems.push(`missing: ${rel}`);
  for (const rel of actual) {
    const want = expected[rel];
    if (!want) { problems.push(`unexpected: ${rel}`); continue; }
    const p = path.join(binDir, rel);
    if (fs.statSync(p).size !== want.size || hashFile(p) !== want.sha256) problems.push(`changed: ${rel}`);
  }
  return problems;
}

if (require.main === module) {
  const cmd = process.argv[2];
  const binDir = path.join(ROOT, 'bin');
  const manifestFile = path.join(ROOT, 'bin-manifest.json');
  if (cmd === 'record') {
    const m = record({ binDir, manifestFile });
    console.log(`Recorded ${m.fileCount} files in bin-manifest.json. Commit it with the release.`);
  } else if (cmd === 'verify') {
    const problems = verify({ binDir, manifestFile });
    if (problems.length) {
      console.error(`bin/ does not match bin-manifest.json (${problems.length}):\n  ${problems.slice(0, 50).join('\n  ')}`);
      process.exit(1);
    }
    console.log('bin/ matches bin-manifest.json.');
  } else {
    console.error('usage: node scripts/bin-manifest.cjs record|verify');
    process.exit(2);
  }
}

module.exports = { record, verify, snapshot };
