// Resource budgets for one conversion job. Engineering defaults, not measured benchmarks: they
// stop runaway work (hangs, archive bombs, endless logs) without limiting normal desktop files.
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

module.exports = {
  // Wall-clock deadlines per engine call.
  deadlines: {
    probe: 60 * 1000,
    ffmpeg: 6 * 60 * 60 * 1000,
    image: 10 * 60 * 1000,
    poppler: 30 * 60 * 1000,
    office: 20 * 60 * 1000,
    calibre: 30 * 60 * 1000,
    sevenzip: 2 * 60 * 60 * 1000,
    detect: 15 * 1000,
  },
  // Diagnostics kept from an engine's stdout/stderr (the tail, for error messages).
  logTailBytes: 64 * 1024,
  // Stdout an engine may return when its whole output is needed (listings, probes).
  maxCapturedBytes: 32 * MiB,
  intake: {
    maxPathsPerRequest: 1000,
    maxPathLength: 4096,
    detectConcurrency: 4,
  },
  archive: {
    maxUnpackedBytes: 16 * GiB,
    maxEntries: 100000,
    maxDepth: 32,
    // A ratio above this is treated as a bomb once the unpacked size passes ratioFloorBytes.
    maxRatio: 200,
    ratioFloorBytes: 256 * MiB,
    // Free space that must remain on the work disk after extraction and repacking.
    freeSpaceReserveBytes: 1 * GiB,
  },
  history: { maxEntries: 1000 },
};
