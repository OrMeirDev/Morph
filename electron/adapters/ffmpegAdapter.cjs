// Video, audio, GIF and APNG through ffmpeg. Writes straight into the same-disk staging file so a
// large video is never copied twice.
const limits = require('../domain/limits.cjs');
const { isCancelled } = require('../infra/errors.cjs');

const CRF = { high: 20, medium: 24, small: 28 };

async function probeDuration(ctx) {
  try {
    const { stdout } = await ctx.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', ctx.job.input], { timeoutMs: limits.deadlines.probe, captureStdout: true });
    const d = parseFloat(stdout);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch (e) {
    if (isCancelled(e)) throw e;
    return null;
  }
}

function ffmpegArgs(target, { quality = 'high', maxHeight = null }) {
  const crf = CRF[quality] || CRF.high;
  const scale = maxHeight ? [`scale=-2:'min(${Number(maxHeight)},ih)'`] : [];
  const vf = (filters) => (filters.length ? ['-vf', filters.join(',')] : []);
  const gifWidth = { high: 720, medium: 540, small: 360 }[quality] || 720;
  switch (target) {
    case 'mp4':
    case 'mov':
    case 'mkv':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', ...vf([...scale, 'pad=ceil(iw/2)*2:ceil(ih/2)*2']),
        '-c:a', 'aac', '-b:a', '160k', ...(target === 'mkv' ? [] : ['-movflags', '+faststart'])];
    case 'webm':
      // GIF/APNG decode to palette/alpha pixel formats that VP9 rejects; force plain 4:2:0.
      return ['-c:v', 'libvpx-vp9', '-crf', String(crf + 10), '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...vf(scale), '-c:a', 'libopus', '-b:a', '128k'];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', String({ high: 3, medium: 5, small: 8 }[quality] || 3), ...vf(scale), '-c:a', 'libmp3lame', '-q:a', '4'];
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-q:a', String({ high: 2, medium: 4, small: 6 }[quality] || 2)];
    case 'm4a':
    case 'aac':
      return ['-vn', '-c:a', 'aac', '-b:a', { high: '192k', medium: '160k', small: '128k' }[quality] || '192k'];
    case 'wav':
      return ['-vn', '-c:a', 'pcm_s16le'];
    case 'ogg':
      return ['-vn', '-c:a', 'libvorbis', '-q:a', String({ high: 6, medium: 5, small: 3 }[quality] || 6)];
    case 'flac':
      return ['-vn', '-c:a', 'flac'];
    case 'opus':
      return ['-vn', '-c:a', 'libopus', '-b:a', { high: '160k', medium: '128k', small: '96k' }[quality] || '160k'];
    case 'gif':
      return ['-vf', `fps=12,scale='min(${gifWidth},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0'];
    case 'apng':
      return ['-vf', `fps=15,scale='min(${gifWidth},iw)':-2:flags=lanczos`, '-plays', '0', '-f', 'apng'];
    case 'png':
      return ['-frames:v', '1', '-update', '1'];
    default:
      throw new Error(`unsupported-target:${target}`);
  }
}

async function run(ctx) {
  const { job } = ctx;
  const duration = await probeDuration(ctx);
  const out = ctx.stagingFile(job.target);
  // -n: never overwrite (the staging name is new for every job; this guards against surprises).
  const args = ['-hide_banner', '-nostdin', '-n', '-i', job.input, ...ffmpegArgs(job.target, job), '-progress', 'pipe:1', '-nostats', out];
  await ctx.run('ffmpeg', args, {
    timeoutMs: limits.deadlines.ffmpeg,
    onLine: (line) => {
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (m && duration) ctx.progress(Math.min(99, (Number(m[1]) / 1e6 / duration) * 100));
    },
  });
  return { path: out, isDir: false };
}

module.exports = { run, ffmpegArgs };
