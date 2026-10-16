// E-books (and PDF -> EPUB) through Calibre's ebook-convert, which picks formats by extension.
const limits = require('../domain/limits.cjs');

async function run(ctx) {
  const { job } = ctx;
  const src = ctx.workspace.file(`in.${job.ext}`);
  await require('fs').promises.copyFile(job.input, src);
  const out = ctx.workspace.file(`out.${job.target}`);
  await ctx.run('calibre', [src, out], {
    timeoutMs: limits.deadlines.calibre,
    onLine: (line) => {
      const m = line.match(/^(\d{1,3})%/);
      if (m) ctx.progress(Math.min(99, Number(m[1])));
    },
  });
  return { path: out, isDir: false };
}

module.exports = { run };
