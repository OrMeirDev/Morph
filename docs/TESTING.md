# Testing Morph

## Commands

| Command | What runs |
| --- | --- |
| `npm run check` | import-boundary rules, all tests, production build |
| `npm test` | unit + contract + real-engine tests (`test/**`) |
| `npm run test:engines` | only the real-engine matrix |
| `npm run e2e:flow` | Electron window: add (incl. duplicate drops), convert all, stop during work, forged IPC, history, CSP |
| `npm run e2e:glass-menus`, `e2e:glass-pickers`, `e2e:screenshots` | visual checks (unchanged) |
| `npm run bin:verify` | `bin/` matches `bin-manifest.json` |

Engines are found through `MORPH_TOOL_<NAME>` (e.g. `MORPH_TOOL_SEVENZIP`), then `bin/`, then (off
Windows) `PATH`. A direction whose engine is missing is skipped with a reason; CI on Linux fails if
ffmpeg, Poppler, LibreOffice or 7-Zip directions were skipped.

## Test matrix

| Layer | Covered by | Cases |
| --- | --- | --- |
| Domain / registry | `capabilities.test`, `units.test`, `timeZoneConversion.test`, `docs.test` | eligibility from probed capabilities, fidelity, DST gaps/folds (New York, Jerusalem), month/year day offsets, decimal vs binary units, `docs/FORMATS.md` up to date |
| Intake / detection | `detection.test` | content over name, rename notice, confidence, zip named .docx, structural GIF frames (incl. planted 0x21 0xF9 bytes), truncated GIF, folders refused |
| Coordinator | `coordinator.test` | publish then history, unknown/duplicate/forbidden commands, single-job order, cancel before start / during uninterruptible work / right before publish, invalid output, engine failure, changed file, settings snapshot, cancelAll |
| Process / output | `processRunner.test`, `outputPublisher.test` | deadline, bounded logs and capture, spawn failure, descendants killed on cancel, collisions, concurrent same-name publishes, original untouched, recovery of leftovers |
| Persistence | `repositories.test` | validation, corrupt file set aside, v0 migration, atomic writes, journal |
| IPC | `ipc.test` | schemas, sender/frame/URL guard, every preload channel has a schema |
| Release | `binManifest.test` | tampered/missing/extra payload files fail |
| Engines (real) | `engines.test` | MOR-01 regressions with real sharp, image targets (alpha flatten, dimensions), BMP via ffmpeg, audio, video (odd sizes, audio kept), animated GIF, PDF single/multi/text, Office incl. Hebrew RTL through DOCX → PDF, PDF → DOCX, archives incl. tar.gz round trip, traversal and symlink zips refused, missing Calibre not offered, no leftovers |
| UI (real window) | `e2e/conversion-flow.cjs` | 15 checks listed in the script |

All fixtures are generated at test time (no binary fixtures in git).

## Results on the refactor branch (Linux, Node 22, Electron 44.5.1)

- `npm test`: 126 passed, 0 failed, 0 skipped (with ffmpeg 6.1.1, Poppler 24.02, LibreOffice
  24.2.7, 7-Zip 16.02; Calibre absent → its directions are reported not offered).
- `e2e/conversion-flow.cjs`: 15/15.
- Screenshots of every page: identical to the 1.0.3 build rendered on the same Electron, except the
  tool count (now from probes) and the settings tool chips.

## Pending on Windows (not executable in this environment)

These need a Windows 10/11 x64 machine with `npm run fetch-bin` payloads; record results in the PR.

1. `npm test` with the bundled `bin/` (ffmpeg, 7-Zip, Poppler, LibreOffice `soffice.com`, Calibre):
   no skips; Calibre directions (EPUB/MOBI/AZW3/PDF ↔ DOCX/TXT) for the first time.
2. Process-tree cancel with real LibreOffice (`soffice.com` → `soffice.bin`) and Calibre: Stop
   mid-conversion leaves no process in Task Manager and no staging file.
3. Office profile: a path near the 100-character limit, Hebrew user names, a cancelled first start
   followed by a successful conversion.
4. Publishing on NTFS, a FAT32/exFAT USB stick and a network share (rename over reservation,
   antivirus locks), including a destination folder that already has the output name.
5. Packaged app: drag and drop from Explorer, `utilityProcess` worker with sharp 0.35 native
   bindings from `app.asar.unpacked`, CSP does not block anything, first-run tool probe time.
6. Installer: fresh install, uninstall, and auto-update from 1.0.3 keeping settings and history
   (v0 files are migrated in place).
7. Signed installer and app show the expected publisher (after signing is set up, `docs/RELEASING.md`).
8. Complex Office/PDF fixtures (tables, fonts, formulas, slides, page counts) owned by the project.
