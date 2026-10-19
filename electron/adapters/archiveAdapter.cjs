// Archives through 7-Zip: list and check every entry first (paths, links, sizes, ratio, depth,
// free space), extract into the job workspace, verify what actually landed there, then repack.
const fsp = require('fs').promises;
const path = require('path');
const limits = require('../domain/limits.cjs');
const { parseSltListing, evaluateListing, ArchivePolicyError } = require('../domain/archivePolicy.cjs');

// 7-Zip prompts for a password on encrypted archives; with no console that would hang until the
// deadline. A dummy password makes it fail at once with "Wrong password" instead.
const NO_PASSWORD = '-pmorph-no-password';

async function preflight(ctx, archivePath, inputSize) {
  const { stdout } = await ctx.run('sevenzip', ['l', '-slt', '-ba', NO_PASSWORD, archivePath], {
    timeoutMs: limits.deadlines.sevenzip, captureStdout: true, maxCaptureBytes: limits.maxCapturedBytes,
  });
  const verdict = evaluateListing(parseSltListing(stdout), { inputSize, limits: limits.archive });
  const free = await ctx.workspace.freeBytes();
  // Room for the extracted content and the repacked result, plus a reserve for the system.
  if (free < verdict.totalBytes * 2 + limits.archive.freeSpaceReserveBytes) throw new ArchivePolicyError('no-space');
  return verdict;
}

// What is on disk must match the policy too: no links, nothing outside `root`, within budget.
async function verifyTree(root) {
  let bytes = 0;
  let entries = 0;
  const walk = async (dir, depth) => {
    if (depth > limits.archive.maxDepth) throw new ArchivePolicyError('archive-too-deep');
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (!path.resolve(p).startsWith(path.resolve(root) + path.sep)) throw new ArchivePolicyError('archive-unsafe-path', 'escaped');
      const st = await fsp.lstat(p);
      entries++;
      if (st.isSymbolicLink()) throw new ArchivePolicyError('archive-link');
      if (st.isDirectory()) await walk(p, depth + 1);
      else if (st.isFile()) bytes += st.size;
      else throw new ArchivePolicyError('archive-special-file');
    }
  };
  await walk(root, 0);
  if (entries > limits.archive.maxEntries) throw new ArchivePolicyError('archive-too-many-files');
  if (bytes > limits.archive.maxUnpackedBytes) throw new ArchivePolicyError('archive-too-large');
  return { bytes, entries };
}

async function run(ctx) {
  const { job } = ctx;
  const input = await ctx.input();
  const inputSize = (await fsp.stat(input)).size;
  const content = ctx.workspace.file('content');
  const pct = (lo, hi) => (line) => {
    const m = line.match(/(\d{1,3})%/);
    if (m) ctx.progress(lo + (Number(m[1]) / 100) * (hi - lo));
  };
  const t = { timeoutMs: limits.deadlines.sevenzip };

  await preflight(ctx, input, inputSize);
  await ctx.run('sevenzip', ['x', '-y', '-bsp1', NO_PASSWORD, `-o${content}`, input], { ...t, onLine: pct(0, 45) });
  // .tar.gz / .tgz unpack to a single .tar first; check and open that too.
  const inner = await fsp.readdir(content);
  if (inner.length === 1 && /\.tar$/i.test(inner[0])) {
    const tarPath = path.join(content, inner[0]);
    await preflight(ctx, tarPath, inputSize);
    await ctx.run('sevenzip', ['x', '-y', '-bsp1', NO_PASSWORD, `-o${content}`, tarPath], t);
    await fsp.rm(tarPath, { force: true });
  }
  await verifyTree(content);
  ctx.throwIfCancelled();

  const out = ctx.workspace.file(`out.${job.target}`);
  if (job.target === 'tar.gz') {
    const tarFile = ctx.workspace.file('packed.tar');
    await ctx.run('sevenzip', ['a', '-ttar', '-bsp1', tarFile, '*'], { ...t, cwd: content, onLine: pct(45, 80) });
    await ctx.run('sevenzip', ['a', '-tgzip', '-bsp1', out, tarFile], { ...t, onLine: pct(80, 99) });
  } else {
    const type = { zip: 'zip', '7z': '7z', tar: 'tar' }[job.target];
    await ctx.run('sevenzip', ['a', `-t${type}`, '-bsp1', out, '*'], { ...t, cwd: content, onLine: pct(45, 99) });
  }
  return { path: out, isDir: false };
}

module.exports = { run, verifyTree };
