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
    reason: 'LibreOffice 26.2.6.3 in an AppContainer: --version works, but the first start of a profile never returns (killed after 300 s, run 38680593398); it needs named pipes and objects an AppContainer does not give it.',
  },
  calibre: {
    isolation: 'low-integrity',
    reason: 'Calibre 9.15.0 in an AppContainer stops at once: "RuntimeError: NUL file missing in windows" (calibre/utils/ipc/launch.py checks os.devnull, which an AppContainer cannot open; run 38680593398).',
  },
};

// Limits per Job Object. Rule: 8 x the largest peak measured on the stress fixtures, rounded up
// to 256 MiB, at least 1024 MiB; processes: at least 6 x the most seen at once. The measured peaks
// (job-wide committed memory) are recorded with each value. Override for diagnostics with
// MORPH_CONFINE_LIMITS='{"soffice":{"jobMemoryMb":4096}}'.
const limits = {
  // ffmpeg: 159 MiB (640x360 H.264 + AAC encode), 143 MiB (VP9 + Opus); 4K stress: see test log
  ffmpeg: { jobMemoryMb: 4096, maxProcesses: 16 },
  ffprobe: { jobMemoryMb: 1024, maxProcesses: 16 },
  // 7-Zip: 14 MiB measured; LZMA/LZMA2 decompression needs the archive's dictionary size, up to
  // 1536 MiB for 7-Zip's own Ultra preset, so the floor is set by the format, not the fixture.
  sevenzip: { jobMemoryMb: 2048, maxProcesses: 16 },
  // Poppler: 4-6 MiB measured on letter-size pages; a large page at 200 dpi is a few hundred MiB.
  pdftoppm: { jobMemoryMb: 1024, maxProcesses: 16 },
  pdftotext: { jobMemoryMb: 1024, maxProcesses: 16 },
  pdfinfo: { jobMemoryMb: 1024, maxProcesses: 16 },
  // LibreOffice: 87-93 MiB small documents, 394 MiB for a 40,000-paragraph document -> 3328 MiB.
  soffice: { jobMemoryMb: 3328, maxProcesses: 24 },
  // Calibre: 72-81 MiB, 174 MiB EPUB -> PDF (Qt WebEngine, 5 processes at once) -> 1536 MiB.
  calibre: { jobMemoryMb: 1536, maxProcesses: 32 },
};

const defaults = { jobMemoryMb: 2048, maxProcesses: 16 };

// What the status shows next to the mode: the gaps, stated.
const notes = [
  'LibreOffice and Calibre run at Low integrity: they cannot write to your files, but can read them and use the network.',
  'Image work (sharp) and file detection run in Morph\'s own worker process, which is separate but not OS-confined.',
];

// Test-only values (test/windows/confinement.test.cjs): a LibreOffice limit far below the
// 394 MiB the 40,000-paragraph document needs, to prove a limit hit ends the job cleanly.
const test = { lowSofficeMemoryMb: 192 };

module.exports = { tools, defaults, limits, notes, test };
