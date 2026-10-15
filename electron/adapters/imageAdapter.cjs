// Images and SVG. The pixel work runs in a fresh engine worker per job; ffmpeg bridges the
// formats libvips cannot read or write (BMP, ICO).
const limits = require('../domain/limits.cjs');

async function run(ctx) {
  const { job } = ctx;
  let input = job.input;
  let ext = job.ext;
  if (ext === 'bmp' || ext === 'ico') {
    input = ctx.workspace.file('in.png');
    await ctx.run('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-i', await ctx.input(), '-frames:v', '1', '-update', '1', input], { timeoutMs: limits.deadlines.ffmpeg });
    ext = 'png';
  }
  ctx.throwIfCancelled();
  const viaPng = job.target === 'bmp' || job.target === 'ico';
  const out = ctx.workspace.file(viaPng ? 'out.png' : `out.${job.target}`);
  await ctx.worker({ type: 'image', task: { input, ext, target: job.target, quality: job.quality, out } }, { timeoutMs: limits.deadlines.image });
  ctx.throwIfCancelled();
  if (!viaPng) return { path: out, isDir: false };
  const final = ctx.workspace.file(`out.${job.target}`);
  await ctx.run('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-i', out, final], { timeoutMs: limits.deadlines.ffmpeg });
  return { path: final, isDir: false };
}

module.exports = { run };
