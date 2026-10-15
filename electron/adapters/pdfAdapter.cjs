// PDF to images or text with Poppler. One page becomes one file; more pages become a folder.
const fsp = require('fs').promises;
const path = require('path');
const limits = require('../domain/limits.cjs');
const { isCancelled } = require('../infra/errors.cjs');

async function pageCount(ctx, input) {
  try {
    const { stdout } = await ctx.run('pdfinfo', [input], { timeoutMs: limits.deadlines.probe, captureStdout: true });
    const m = stdout.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : 1;
  } catch (e) {
    if (isCancelled(e)) throw e;
    return 1;
  }
}

async function run(ctx) {
  const { job } = ctx;
  const t = { timeoutMs: limits.deadlines.poppler };
  const input = await ctx.input();
  if (job.target === 'txt') {
    const out = ctx.workspace.file('out.txt');
    await ctx.run('pdftotext', ['-layout', '-enc', 'UTF-8', input, out], t);
    return { path: out, isDir: false };
  }
  const pages = await pageCount(ctx, input);
  const fmt = job.target === 'jpg' ? '-jpeg' : '-png';
  const dpi = { high: '200', medium: '150', small: '100' }[job.quality] || '150';
  if (pages <= 1) {
    const prefix = ctx.workspace.file('page');
    await ctx.run('pdftoppm', [fmt, '-r', dpi, '-singlefile', input, prefix], t);
    return { path: `${prefix}.${job.target}`, isDir: false };
  }
  const dir = ctx.workspace.file('pages');
  await fsp.mkdir(dir);
  await ctx.run('pdftoppm', [fmt, '-r', dpi, '-progress', input, path.join(dir, 'עמוד')], {
    ...t,
    onLine: (line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s/); // "<page> <total> <file>"
      if (m) ctx.progress((Number(m[1]) / Number(m[2])) * 100);
    },
  });
  return { path: dir, isDir: true, folderSuffix: ' - עמודים' };
}

module.exports = { run };
