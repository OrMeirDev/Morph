# Testing Morph

## Commands

| Command | What runs |
| --- | --- |
| `npm run check` | import-boundary rules, all tests, production build |
| `npm test` | unit + contract + real-engine tests (`test/**`) |
| `npm run test:engines` | only the real-engine matrix |
| `npm run e2e:flow` | Electron window: add (incl. duplicate drops), convert all, stop during work, forged IPC, history, CSP |
| `npm run e2e:glass-menus`, `e2e:glass-pickers`, `e2e:screenshots` | visual checks (unchanged) |
| `npm run fetch-bin` | Windows: fetch the pinned engines (`scripts/fetch-engines.cjs --require-pinned`) |
| `npm run bin:verify` | `bin/` matches `bin-manifest.json` byte for byte |

Engines are found through `MORPH_TOOL_<NAME>` (e.g. `MORPH_TOOL_SEVENZIP`), then `bin/`, then (off
Windows) `PATH`. A direction whose engine is missing is skipped with a reason; CI on Linux fails if
any ffmpeg, Poppler, LibreOffice, Calibre or 7-Zip direction was skipped, and the Windows payload job
fails if any test at all was skipped.

## Test matrix

| Layer | Covered by | Cases |
| --- | --- | --- |
| Domain / registry | `capabilities.test`, `units.test`, `timeZoneConversion.test`, `docs.test` | eligibility from probed capabilities, fidelity, known limits per direction, DST gaps/folds (New York, Jerusalem), month/year day offsets, decimal vs binary units, `docs/FORMATS.md` up to date, notices match the lock |
| Intake / detection | `detection.test` | content over name, rename notice, confidence, zip named .docx, structural GIF frames (incl. planted 0x21 0xF9 bytes), truncated GIF, AZW3 vs MOBI, folders refused |
| Coordinator | `coordinator.test` | publish then history, unknown/duplicate/forbidden commands, single-job order, cancel before start / while preparing / during uninterruptible work / after the name is reserved / between rename retries, invalid output, engine failure, changed file, settings snapshot, cancelAll |
| Process / output | `processRunner.test`, `outputPublisher.test` | deadline, bounded logs and capture, spawn failure, descendants killed on cancel, collisions, concurrent same-name publishes, original untouched, recovery of leftovers |
| Persistence | `repositories.test` | validation, corrupt file set aside, v0 migration, atomic writes, journal |
| IPC | `ipc.test` | schemas, sender/frame/URL guard, every preload channel has a schema |
| Release | `binManifest.test`, `fetchEngines.test`, `docs.test` | tampered/missing/extra payload files fail; the lock is fully pinned; fresh, cached, tampered-cache, wrong-hash and 404 downloads; release resolution; LibreOffice trimming; administrative-install package copies stripped; notices match the lock |
| Engines (real) | `engines.test` | MOR-01 regressions with real sharp, image targets (alpha flatten, dimensions), BMP via ffmpeg, audio incl. → WAV (codec, length), video incl. MKV/M4A/OGG/FLAC (streams, codecs), animated GIF and APNG (detected by content), SVG → PNG/JPG/WEBP (aspect, colours)/PDF, PDF single/multi/text, Office incl. Hebrew RTL through DOCX → PDF, PDF → DOCX, archives incl. tar.gz round trip, traversal and symlink zips refused, missing engine not offered, no leftovers |
| Documents (real) | `documents.test` | inside the output: DOCX Hebrew paragraph right-to-left and English not, bold run, one 2×2 table, page break; PDF 2 pages with Hebrew and table text; DOCX → ODT table + `rl-tb`; RTF table, bold, exactly one RTL paragraph, Hebrew escapes; TXT without markup; EPUB package with text; XLSX both sheets + `SUM(A1:A2)` with cached 7; CSV first sheet only with computed value; spreadsheet → PDF; PPTX 3 slides with their text; slides → PDF 3 pages; PPTX → ODP 3 pages. Mutation-checked |
| E-books (real) | `ebooks.test` | Calibre: e-book → TXT (all blocks in order, Hebrew), DOCX (headings, bold via style, list, Hebrew, metadata), PDF (text order, Hebrew, Title, pages), MOBI (v6, reads back), AZW3 (KF8 v8, detected as AZW3, reads back as EPUB in spine order), PDF → EPUB. Mutation-checked |
| Windows payload (real) | `test/windows/payload.test` | see § Windows checks |
| Packaged app | `e2e/packaged-smoke.cjs` | production build over the DevTools protocol (no test hook): CSP, version, six engines verified, one conversion per engine with Hebrew names, history, no CSP violations |
| Installer | `e2e/installer-check.cjs` | 1.0.3 silent install, v0 settings/history seeded, new build installed over it by running its installer, installed copy smoke-tested, silent uninstall keeps user data |
| In-app auto-update | `e2e/autoupdate-check.cjs` | the real electron-updater in an installed build checks a local feed (127.0.0.1, never published), downloads and verifies the next version, and installs it with "restart to update" while LibreOffice converts: conversion cancelled with no output/staging/process, journal empty at quit, new version registered, app restarts by itself, settings and history kept, packaged smoke on the updated app |
| Signature | `e2e/signature-check.cjs` | Authenticode status of installer and app; `unsigned` is reported as pending, never as passed; with `MORPH_PUBLISHER` set it requires a valid, timestamped signature by that subject |
| Confinement policy | `confinement.test` (any host) | every tool has a measured isolation and limits; modes (enforced / unavailable / disabled / unsupported) never fall back silently; grants only on Morph's folders; Low-integrity labels; helper outcomes → errors; limit overrides |
| Confinement on Windows (real) | `test/windows/confinement.test` | see § D2 checks: real restricted processes, OS denials, kills and limits |
| Real-world corpus | `corpus.test` | 6 public-domain files made by other tools (`test/corpus/SOURCES.md`, SHA-256 checked, never modified): Hebrew poem with niqqud DOCX → PDF/ODT/TXT, PDF → TXT/PNG, EPUB → DOCX/TXT (known RTL limit pinned); IRS W-9 → TXT/JPG/DOCX; Census XLSX → CSV/ODS; Gutenberg EPUB → TXT/AZW3/PDF |
| UI (real window) | `e2e/conversion-flow.cjs` | 15 checks listed in the script |

Generated fixtures are made at test time; the only files kept in git are the real-world corpus in
`test/corpus` (public domain, attribution and hashes in `SOURCES.md`). A generated fixture proves
a feature Morph controls survives; a corpus file proves a document nobody made for these tests
converts and keeps its text. Neither proves every possible file.

## Results (CI on 92ee37c, run 38766954377)

Passes and skips are listed separately; every skip below is by design of that job, and the
bundled-engines job allows none.

| Job | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| Checks and engine matrix (Linux): `npm test` | 216 | 0 | 34 (Windows-only payload and confinement tests) |
| Checks and engine matrix (Linux): engine matrix (Ubuntu's ffmpeg, Poppler, LibreOffice, Calibre, 7-Zip, not the shipped versions) | 79 | 0 | 0 |
| Checks and engine matrix (Linux): Electron e2e flow | 15 | 0 | — |
| Checks (Windows, no bundled engines): `npm test` | 153 | 0 | 71 (engine and payload tests: this job deliberately has no engines) |
| Bundled engines (Windows): confinement + isolation step | 26 | 0 | 0 |
| Bundled engines (Windows): `npm test` with the bundled `bin/` | 250 | 0 | 0 |
| Bundled engines (Windows): packaged app smoke | 19 | 0 | — |
| Bundled engines (Windows): installer over 1.0.3 (installed-copy smoke 21/21) | 9 | 0 | — |
| Bundled engines (Windows): in-app auto-update (updated-app smoke 21/21) | 19 | 0 | — |

Also in that run: imports and module boundaries; build; no test hook in the bundle; runtime
`npm audit` 0; confinement diagnostics `--strict` from PowerShell (every shipped mode converts;
"0 job profiles left" was not evidence: the listing then matched profile names case-sensitively and
could see none, see `docs/LOCAL-WINDOWS-VALIDATION.he.md`); payload identical to `bin-manifest.json` before and after the tests; signing
selection (`Morph.exe`, `morph-confine.exe`, installer, uninstaller, `elevate.exe`; nothing from
`resources\bin`); signature check **pending** (both `NotSigned`, no certificate).

`docs/FORMATS.md`: 69 of 69 conversion directions engine-tested (structure and content checked inside
the outputs of generated fixtures). This is not proof of perfect fidelity or of every real-world file;
known losses are listed there and shown in the app when the user picks that target.

Evidence: the payload job's `windows-payload-evidence` artifact (`engines.resolved.json`,
`bin-manifest.ci.json`, `bin/ENGINES.json`, `test.log`, `confinement.log`,
`confine-diagnose.json`, `isolation-measurements.json`, `signed-files.txt`, `signature.json`,
`smoke.json`, `installer.json`, `autoupdate.json`). Later commits on the branch change
documentation only; the PR description names the run on the head commit.

## Local Windows desktop (separate from CI)

Windows 11 Pro 26H2 desktop, run **unelevated** (filtered administrator token, Medium integrity;
not a genuine standard account), commit `0f2d970`: `npm test` 249 passed / 0 failed / 5 skipped
(FAT32/exFAT/SMB need administrator-made volumes), confinement diagnostics 8/8 shipped modes,
packaged smoke 20/20, packaged-app local check (`e2e/local-windows-check.cjs`) 46/46, e2e flow
15/15. It found and fixed failures the elevated CI runners could not show (LibreOffice and Calibre
unavailable to non-elevated users; the profile sweep matching nothing; x264 memory following the
core count; the smoke test's "temporary" profile being the user's real one). Report, Pending items
and owner actions: `docs/LOCAL-WINDOWS-VALIDATION.he.md`; evidence: `test-results/local-windows/`.

## Windows checks

Tested commit 92ee37c, CI run 38766954377. GitHub `windows-latest` = Windows Server 2025 (image
`windows-2025-vs2026`), x64, Node 22, Electron 44.5.1. Engines, all pinned in
`scripts/engines.lock.json` (URL + SHA-256) and verified byte for byte against `bin-manifest.json`
(12,529 files) before and after the tests: FFmpeg 9.0.2 (gyan.dev essentials), 7-Zip 26.03,
Poppler 26.09.0, LibreOffice 26.2.6.3, Calibre 9.15.0; sharp 0.35.5 from npm.
A server runner is not a desktop: what needs a desktop session, real removable media, antivirus
behaviour, a code-signing certificate or a published release stays Pending and is listed as such.

| # | Check | Status | Evidence / what is still open |
| --- | --- | --- | --- |
| 1 | Engine tests: `npm test` with the bundled `bin/`, nothing skipped (Calibre included), every engine confined | **Pass** | `test.log`: 250 passed, 0 failed, 0 skipped; probe reports the versions above |
| 2 | Stop mid-conversion ends the whole tree (LibreOffice `soffice.com` → `soffice.bin`; Calibre `ebook-convert` → `calibre-parallel`), no output, no staging | **Pass** | `payload.test`: the engine's real worker process is seen (matched by executable path under `bin\`), Stop is pressed, none is left; cancelled state; the next conversion works |
| 3 | Office profile: path at the 100-character limit, Hebrew names, first start cancelled, damaged profile | **Pass** | `payload.test`: Stop inside `soffice --terminate_after_init` leaves the profile unmarked and no process, then converts; damaged registry rebuilt; long Hebrew base converts, longer falls back; Hebrew and ~200-character paths through all six engines |
| 4 | Publication on NTFS, FAT32, exFAT and a network share, existing output name | **Pass** on virtual disks and a local SMB share / **Pending**: a real USB stick and antivirus file locks | `payload.test` on `R:` FAT32 and `S:` exFAT VHDs and `\\localhost\morphshare`: `pic (1).webp`, `pic (2).webp`, original kept, no staging; NTFS throughout |
| 5 | Packaged app: utilityProcess worker with sharp's native binding from `app.asar.unpacked`, CSP, probe time | **Pass** / **Pending**: drag and drop from Explorer (needs an interactive desktop) | `smoke.json`: 19/19, confinement enforced (detection, image worker and every engine confined), every engine converted inside the packaged app, no CSP violations |
| 6 | Installer: 1.0.3 → this build by running the installer, settings and history kept and migrated, uninstall | **Pass** | `installer.json`: 9/9 (installed copy smoke 21/21 with the seeded settings and history; uninstall removes program and registration, keeps user data) |
| 7 | In-app auto-update with the real updater from a controlled feed, during a running conversion | **Pass** (controlled local feed) / **Pending**: from a published GitHub release (F3, after the first real release) | `autoupdate.json`: 19/19 (confinement enforced). Installed 1.0.4 with seeded settings and v0 history; the real electron-updater found 1.0.5 on the 127.0.0.1 feed, downloaded and verified it; LibreOffice (`soffice.com`, `soffice.bin`) was converting when "restart to update" ran; the window received `queued → preparing → converting → cancelled`; crash journal empty at quit; 1.0.5 registered; the app restarted by itself; feed log shows `Morph-Setup-1.0.5.exe` fetched; no output, staging or LibreOffice process left; packaged smoke on the updated app 21/21 with the same settings; history kept in the v1 format. Nothing was published; no mock |
| 8 | Signed installer and app with the expected publisher | **Pending** (no certificate) | `signature.json`: both `NotSigned`; the step succeeds because it reports pending, which is not a pass. Missing inputs: `docs/RELEASING.md` §5 |
| 9 | Document fidelity with the bundled Windows LibreOffice; real-world files | **Pass** for the generated fixtures / **Pending**: a real-world corpus (embedded fonts, images, tracked changes, scanned PDFs) | `documents.test` and `ebooks.test` ran against LibreOffice 26.2.6.3 and Calibre 9.15.0 in this job |

### D2 checks (real restricted processes, Windows Server 2025)

Measured in run 38753883753 (`afa275c`) by `test/windows/confinement.test.cjs`,
`test/windows/isolation.test.cjs` and `scripts/confine-diagnose.cjs` (the diagnostics run from
PowerShell, the context Morph itself starts from; the tests from Git Bash). Evidence:
`confine-diagnose.json`, `confinement.log`, `isolation-measurements.json`.

| Check | Result |
| --- | --- |
| Every engine and the image worker start confined with the shipped policy (AppContainer or Low integrity), from PowerShell | **Pass**: ffmpeg, Poppler, 7-Zip (AppContainer); LibreOffice `--version`, Calibre `--version` and a real Calibre EPUB → MOBI (Low integrity); Electron worker runtime and a real probe through the worker (sharp loads) |
| Descendants owned; Stop and parent death end the whole tree | **Pass**: `soffice.com` + `soffice.bin`, `ebook-convert` + `calibre-parallel`, the image worker |
| Memory and process limits from measured peaks | **Pass**: peaks ffmpeg 1654, LibreOffice 395, Poppler 242, 7-Zip 380, Calibre 1221, image worker 1142 (24 MP AVIF) / 4126 (64 MP RGBA AVIF) MiB; each under its limit with ≥ 2× headroom; a hit ends the job (`limit-memory`) |
| AppContainer: canary outside the workspace, original, network | **Pass**: canary not overwritten; original EPERM to read and write; loopback ETIMEDOUT with 0 connections at the server; ffmpeg cannot reach 127.0.0.1 or the internet while the host can |
| Jobs isolated from each other | **Pass**: pdfinfo and the image worker of job B refused job A's live workspace |
| Detection confined | **Pass**: same answers as reading the file (Hebrew names, corpus files, animated GIF); the worker runs under `morph-confine.exe` and its command line names no file |
| No AppContainer profile left behind | **Not evidence in that run** (the listing could not see lower-case monikers). Re-measured locally after the fix: none left after normal exit, Stop and a helper kill; a crash of Morph leaves its job's profile, removed by the next start's sweep (`docs/LOCAL-WINDOWS-VALIDATION.he.md`) |
| Low integrity: writes into another Low folder (LocalLow) | **Open (measured gap)**: Calibre wrote into `LocalLow` |
| Low integrity, write-restricted token | **Not shippable**: LibreOffice 0xC0000142, Calibre hangs |
| Low integrity, read-restricted token | **Not shippable**: user-profile canary refused and `C:\Windows\win.ini` readable (as intended), but LibreOffice hangs and Calibre cannot create folders in its temp folder |
| LibreOffice in an AppContainer | **Not shippable**: a conversion never returns (killed at 120 s) |
| FAT32 / exFAT | **Open (measured gap)**: an AppContainer ffmpeg changed a canary on both |

### Engine payload pinning (CI evidence)

| Check | Status | Evidence |
| --- | --- | --- |
| Every engine pinned by exact URL + SHA-256 in the committed lock; `--require-pinned` refuses anything else | **Pass** | `fetchEngines.test` ("the lock is fully pinned"); the payload job fetches with `--require-pinned` |
| Fresh download verified against the lock | **Pass** | run 38627078398: cache miss, all five downloads hash-checked, then cached |
| Cached download re-verified before use | **Pass** | run 38631238070: cache restored, `cached download verified` for all five engines, then the payload matched the manifest |
| Tampered package refused | **Pass** | CI step appends one byte to the real cached 7-Zip package: `does not match the lock (expected c068…, got 3b02…)`; local tests cover wrong-hash and 404 downloads |
| Installed `bin/` identical to the committed `bin-manifest.json`, before and after the tests | **Pass** | strict `bin-manifest.cjs verify` steps |

Resolving a new engine version is a separate, manual maintenance workflow
(`.github/workflows/engine-bootstrap.yml`); regular CI never resolves anything.
