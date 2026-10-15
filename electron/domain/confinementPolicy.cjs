// How each engine is confined on Windows (infra/Confinement.cjs, backlog D2), chosen from
// measurements with the pinned engines on Windows Server 2025 (GitHub windows-latest), not assumed.
// Measurement: run 38680593398 (scripts/confine-experiment.cjs, removed after use) and the
// "Bundled engines" CI job (test/windows/confinement.test.cjs logs every peak it measures).
//
// isolation:
//   'appcontainer'   no network, reads only its own folder, writes only the job workspace
//   'low-integrity'  writes only where Morph labelled Low; reads and network NOT restricted
// Low-integrity engines start with a console of their own and a default DACL for the user and
//   SYSTEM (native/confine/morph-confine.c). Without that DACL an elevated user's engines could not
//   open their own objects: 0xC0000142 at start, Calibre's worker pipe refused (runs 38733280447,
//   38734059687; fixed and measured with real conversions from PowerShell in run 38753883753).
// restrictWrites / restrictReads (low-integrity, measured in run 38753883753 by
//   scripts/confine-diagnose.cjs, real conversions, new and inherited console):
//   - write-restricted (writes must also pass for the job's SID): LibreOffice exits with
//     0xC0000142, Calibre hangs. Not shipped.
//   - read-restricted (every access must also pass for the job's SID, a shared read SID, Users,
//     Everyone or RESTRICTED): a file in the user profile is refused and C:\Windows readable, as
//     intended, but LibreOffice hangs (killed at 120 s) and Calibre fails: Python's mkdtemp makes
//     its temp folders 0o700, which on Windows means an owner-only ACL without the job's SID, so
//     Calibre cannot create anything inside its own temp folder. Not shipped.
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
    // Not shipped (measured, see above): Low-IL engines can read what the user can read, and
    // write into other Low-labelled folders (e.g. LocalLow).
    restrictWrites: false,
    restrictReads: false,
    reason: 'LibreOffice 26.2.6.3 in an AppContainer: --version works, but a conversion with a new profile never returns (killed after 300 s, run 38680593398; again after 120 s in run 38753883753).',
  },
  // The per-job image worker (sharp/libvips, heic-convert, pdf-lib, imagetracerjs) as Electron in
  // node mode: AppContainer, reads Morph's runtime and code, writes the job workspace.
  imageworker: { isolation: 'appcontainer' },
  calibre: {
    isolation: 'low-integrity',
    restrictWrites: false, // as above
    restrictReads: false,
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
  'LibreOffice and Calibre run at Low integrity: Windows refuses their writes to your normal (Medium-integrity) files, but not to Low-integrity folders such as LocalLow (measured) or to FAT32/exFAT drives; they can read your files and use the network.',
  'File detection runs in an AppContainer worker that is never given your file: Morph passes it only the byte ranges it asks for.',
  'FAT32/exFAT drives have no permissions: an engine can write anywhere on such a drive (measured, run 38684568676).',
];

// Test-only values (test/windows/confinement.test.cjs): a LibreOffice limit far below the
// 394 MiB the 40,000-paragraph document needs, to prove a limit hit ends the job cleanly.
const test = { lowSofficeMemoryMb: 192 };

module.exports = { tools, defaults, limits, notes, test };
