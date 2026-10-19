// Counts the frames of a GIF by walking its block structure (header, colour tables, extension and
// image blocks), reading through a small window instead of loading the file. Stops at `stopAt`
// frames. A byte-pair scan for 0x21 0xF9 is not enough: those bytes also occur inside image data
// and comments, which made single-frame GIFs look animated.
// The bytes come from `read(position, length)`, so the walker works on a file or on ranges that
// Morph reads for the confined detection worker (which never opens the original itself).
const fs = require('fs');

async function gifFrameCountFrom(read, size, { stopAt = 2, windowBytes = 64 * 1024 } = {}) {
  let win = Buffer.alloc(0);
  let winStart = 0;
  let pos = 0;
  const byteAt = async (p) => {
    if (p >= size) throw new Error('gif-truncated');
    if (p < winStart || p >= winStart + win.length) {
      winStart = p;
      win = await read(p, Math.min(windowBytes, size - p));
      if (!win.length) throw new Error('gif-truncated');
    }
    return win[p - winStart];
  };
  const skipSubBlocks = async () => {
    for (;;) {
      const n = await byteAt(pos);
      pos += 1 + n;
      if (n === 0) return;
    }
  };
  const sig = await read(0, Math.min(6, size));
  if (!/^GIF8[79]a$/.test(sig.toString('latin1'))) throw new Error('not-gif');
  const packed = await byteAt(10);
  pos = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
  let frames = 0;
  for (;;) {
    const marker = await byteAt(pos);
    if (marker === 0x3b) return frames; // trailer
    if (marker === 0x21) { // extension: label, then data sub-blocks
      pos += 2;
      await skipSubBlocks();
    } else if (marker === 0x2c) { // image descriptor
      frames++;
      if (frames >= stopAt) return frames;
      const p = await byteAt(pos + 9);
      pos += 10 + (p & 0x80 ? 3 * (1 << ((p & 0x07) + 1)) : 0);
      pos += 1; // LZW minimum code size
      await skipSubBlocks();
    } else {
      return frames; // garbage after the last block: count what was parsed
    }
  }
}

/** Reads `length` bytes at `position` from an open file handle (fewer at the end of the file). */
const handleReader = (fh) => async (position, length) => {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
};

async function gifFrameCount(file, opts) {
  const fh = await fs.promises.open(file, 'r');
  try {
    return await gifFrameCountFrom(handleReader(fh), (await fh.stat()).size, opts);
  } finally {
    await fh.close();
  }
}

module.exports = { gifFrameCount, gifFrameCountFrom, handleReader };
