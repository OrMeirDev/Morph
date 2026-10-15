// How each engine is confined on Windows (infra/Confinement.cjs, backlog D2), chosen from
// measurements with the pinned engines on Windows Server 2025 (GitHub windows-latest), not assumed.
// Measurement: run 38680593398 (scripts/confine-experiment.cjs, removed after use) and the
// "Bundled engines" CI job (test/windows/confinement.test.cjs logs every peak it measures).
//
// isolation:
//   'appcontainer'   no network, reads only its own folder, writes only the job workspace
//   'low-integrity'  writes only where Morph labelled Low; reads and network NOT restricted
// Every engine also runs in a Job Object (kill-on-close, parent watch, the limits below).
const tools = {
  ffmpeg: { isolation: 'appcontainer' },
  ffprobe: { isolation: 'appcontainer' },
  sevenzip: { isolation: 'appcontainer' },
  pdftoppm: { isolation: 'appcontainer' },
  pdftotext: { isolation: 'appcontainer' },
  pdfinfo: { isolation: 'appcontainer' },
  soffice: {
    isolation: 'low-integrity',
    // Write restriction to the job's own SID is measured by isolation.test but not shipped: in
    // CI diagnostics a write-restricted Calibre hung and Low-IL starts failed outside the test
    // path (runs 38713426740, 38714316057). Until it converts there, Low-IL engines can write into
    // other Low-labelled folders (e.g. LocalLow).
    restrictWrites: false,
    reason: 'LibreOffice 26.2.6.3 in an AppContainer: --version works, but the first start of a profile never returns (killed after 300 s, run 38680593398); it needs named pipes and objects an AppContainer does not give it.',
  },
  // The per-job image worker (sharp/libvips, heic-convert, pdf-lib, imagetracerjs) as Electron in
  // node mode: AppContainer, reads Morph's runtime and code, writes the job workspace.
  imageworker: { isolation: 'appcontainer' },
  calibre: {
    isolation: 'low-integrity',
    restrictWrites: false, // as above
    reason: 'Calibre 9.15.0 in an AppContainer stops at once: "RuntimeError: NUL file missing in windows" (calibre/utils/ipc/launch.py checks os.devnull, which an AppContainer cannot open; run 38680593398).',
  },
};

// Limits per Job Object, from the stress fixtures in test/windows/confinement.test.cjs (peak
// job-wide committed memory, run 38684568676 on windows-latest). Rule: 4 x the stress peak, rounded
// up to 512 MiB, at least 1024 MiB; processes: at least 4 x the most seen at once. The test fails if
// any stress peak leaves less than 2x headroom. Override for diagnostics or unusually large files:
// MORPH_CONFINE_LIMITS='{"soffice":{"jobMemoryMb":4096}}'.
const limits = {
  // 4K H.264 encode 1634 MiB (VP9 1200 MiB); 2 processes
  ffmpeg: { jobMemoryMb: 6656, maxProcesses: 16 },
  ffprobe: { jobMemoryMb: 1024, maxProcesses: 16 },
  // 128 MiB into .7z: 380 MiB. Floor set by the format instead: LZMA/LZMA2 decompression needs the
  // archive's dictionary, up to 1536 MiB for 7-Zip's own Ultra preset.
  sevenzip: { jobMemoryMb: 2048, maxProcesses: 16 },
  // A0 page at 200 dpi: 242 MiB
  pdftoppm: { jobMemoryMb: 1024, maxProcesses: 16 },
  pdftotext: { jobMemoryMb: 1024, maxProcesses: 16 },
  pdfinfo: { jobMemoryMb: 1024, maxProcesses: 16 },
  // 40,000-paragraph document to PDF: 395 MiB; 3 processes at once
  soffice: { jobMemoryMb: 2048, maxProcesses: 16 },
  // Image worker (sharp, AVIF the heaviest target): 24 MP photo 1139 MiB, 64 MP RGBA 4129 MiB
  // (run 38722315865; a 4096 MiB provisional limit stopped the 64 MP case cleanly). Rule here:
  // max(4 x the 24 MP peak, 2 x the 64 MP peak) = 8258 -> 8704 MiB, so very large photos convert.
  imageworker: { jobMemoryMb: 8704, maxProcesses: 8 },
  // 120-chapter book to PDF (Qt WebEngine): 1218 MiB, 7 processes at once
  calibre: { jobMemoryMb: 5120, maxProcesses: 32 },
};

const defaults = { jobMemoryMb: 2048, maxProcesses: 16 };

// What the status shows next to the mode: the gaps, stated.
const notes = [
  'LibreOffice and Calibre run at Low integrity: they cannot write to your files, but can read them and use the network.',
  'File detection (file-type and Morph\'s GIF reader, no native code) runs in a separate worker process that is not OS-confined.',
  'FAT32/exFAT drives have no permissions: an engine can write anywhere on such a drive (measured, run 38684568676).',
];

// Test-only values (test/windows/confinement.test.cjs): a LibreOffice limit far below the
// 394 MiB the 40,000-paragraph document needs, to prove a limit hit ends the job cleanly.
const test = { lowSofficeMemoryMb: 192 };

module.exports = { tools, defaults, limits, notes, test };
