// Counts the frames of a GIF by walking its block structure (header, colour tables, extension and
// image blocks), reading through a small window instead of loading the file. Stops at `stopAt`
// frames. A byte-pair scan for 0x21 0xF9 is not enough: those bytes also occur inside image data
// and comments, which made single-frame GIFs look animated.
const fs = require('fs');

function gifFrameCount(file, { stopAt = 2 } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const win = Buffer.alloc(64 * 1024);
    let winStart = 0;
    let winLen = 0;
    let pos = 0;
    const byteAt = (p) => {
      if (p >= size) throw new Error('gif-truncated');
      if (p < winStart || p >= winStart + winLen) {
        winStart = p;
        winLen = fs.readSync(fd, win, 0, win.length, p);
      }
      return win[p - winStart];
    };
    const skipSubBlocks = () => {
      for (;;) {
        const n = byteAt(pos);
        pos += 1 + n;
        if (n === 0) return;
      }
    };
    const sig = Buffer.alloc(6);
    fs.readSync(fd, sig, 0, 6, 0);
    if (!/^GIF8[79]a$/.test(sig.toString('latin1'))) throw new Error('not-gif');
    const packed = byteAt(10);
    pos = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
    let frames = 0;
    for (;;) {
      const marker = byteAt(pos);
      if (marker === 0x3b) return frames; // trailer
      if (marker === 0x21) { // extension: label, then data sub-blocks
        pos += 2;
        skipSubBlocks();
      } else if (marker === 0x2c) { // image descriptor
        frames++;
        if (frames >= stopAt) return frames;
        const p = byteAt(pos + 9);
        pos += 10 + (p & 0x80 ? 3 * (1 << ((p & 0x07) + 1)) : 0);
        pos += 1; // LZW minimum code size
        skipSubBlocks();
      } else {
        return frames; // garbage after the last block: count what was parsed
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { gifFrameCount };
