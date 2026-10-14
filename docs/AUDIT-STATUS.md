# Audit status: revalidation, resolution and backlog

Source audit: commit `96f8a5c` (Morph 1.0.3). Revalidated against `0334f72` (adds `e2e/` only; the
audited source was unchanged). Branch: `claude/dazzling-johnson-3zccoi`.
**MOR-17 is cancelled by the owner** and has no tasks, tests or release gate here.

## Revalidation of the source audit on the current checkout

| Finding | Revalidation (before changes) |
| --- | --- |
| MOR-01 | Still present: reproduced, PNG → WEBP with immediate cancel returned `{ok:true}` and wrote `a.webp` |
| MOR-02 | Still present: renderer `useEffect` runner, history written by the renderer |
| MOR-03 | Still present: sharp/heic/pdf-lib/ImageTracer and detection in Electron main |
| MOR-04 | Still present: `job:start` trusted renderer kind/ext/target/path; no CSP; no sender checks |
| MOR-05 | Still present: `7z x` without listing, budgets or post-extraction checks |
| MOR-06 | Still present: `uniquePath` existence check, ffmpeg `-y` writing the final path |
| MOR-07 | Still present: Electron 33.4.11, sharp 0.33.5 (high), file-type 19.6.0 (moderate) |
| MOR-08 | Changed: `e2e/` scripts were added (visual checks), still no test script/CI |
| MOR-09 | Still present: unbounded stdout/stderr, no deadline, `child.kill()` only |
| MOR-10 | Still present: `latest` downloads, skip-if-exists, no manifest |
| MOR-11 | Still present: one global profile, size heuristic, no lock |
| MOR-12 | Still present: `images: true`, targets independent of tools |
| MOR-13 | Still present: exit code = success; README universal PDF → Word claim |
| MOR-14 | Still present: byte-pair GIF scan, intake race, unbounded `Promise.all` |
| MOR-15 | Still present: sync non-atomic JSON, renderer-recorded history, no catch on start |
| MOR-16 | Still present: reproduced, New York 2026-03-08 02:30 → displayed 01:30 |
| MOR-18 | Still present: `App.jsx` ↔ `pages.jsx` cycle, `window.__morphAdd` in production |

## Resolution

| ID | Status | What changed | Evidence |
| --- | --- | --- | --- |
| MOR-01 | **Fixed** | coordinator-owned AbortSignal; checks before each phase and before publish; image work in a per-job worker killed on cancel; staging | `coordinator.test` (5 cancel phases incl. while preparing and after the final name is reserved, before the rename), `engines.test` MOR-01 ×2 with real sharp, e2e "no SVG written after stop" |
| MOR-02 | **Fixed** | `ConversionCoordinator` owns queue/attempts/concurrency/cancel/history; duplicate active jobs rejected; renderer mirrors `job:update` | `coordinator.test` |
| MOR-03 | **Fixed (process separation)**; OS confinement open | detection and image work in `utilityProcess` with deadlines | `engines.test`, e2e, packaged smoke on Windows (worker with sharp from `app.asar.unpacked`); process separation is not OS confinement: Job Objects / restricted token are backlog D2 |
| MOR-04 | **Fixed** | sender/frame/URL guard, per-channel schemas, file IDs from intake, backend-decided kind/targets, revalidation, open/show limited to Morph outputs, CSP, window-open denied, sandbox explicit | `ipc.test`, e2e forged-IPC checks |
| MOR-05 | **Fixed (application level)**; engine FS restriction open (D2) | listing preflight (traversal, absolute, drive, links, encryption, size, ratio, count, depth, free space), post-extraction tree check, cleanup on cancel | `archivePolicy.test`, `engines.test` hostile zips, run against the bundled 7-Zip 26.03 on Windows |
| MOR-06 | **Fixed** | same-disk staging, signature validation, exclusive reservation + rename, journal-based recovery; Stop checked before every rename attempt | `outputPublisher.test`, `coordinator.test`; Windows NTFS, FAT32/exFAT virtual disks and SMB share in `payload.test`; real USB stick / antivirus pending (TESTING § Windows checks #4) |
| MOR-07 | **Fixed** for runtime; build-time exception recorded | Electron 44.5.1, sharp 0.35.5, file-type 21.3.4, electron-builder 26.17, Vite 7.3.6 | `npm audit --omit=dev` = 0; `docs/DEPENDENCIES.md` |
| MOR-08 | **Fixed** except the owner setting | 185 tests, real-engine matrix on Linux and with the bundled engines on Windows, packaged smoke, installer and in-app update checks, e2e flow | three CI jobs on PR #1 (run 38631238070 on `dbe853f`); making them required on `main` is an owner setting (W2, `docs/RELEASING.md` §1) |
| MOR-09 | **Fixed** | `ProcessRunner` deadlines, bounded logs, spawn errors, tree kill; update/quit wait for cancelled jobs | `processRunner.test` on Linux and Windows; real LibreOffice and Calibre trees killed on Windows (`payload.test`); LibreOffice killed by "restart to update" (`autoupdate-check`) |
| MOR-10 | **Fixed** (signing pending) | `scripts/engines.lock.json` pins exact URL + SHA-256 for all five engines; `fetch-engines.cjs --require-pinned` verifies fresh and cached downloads; `bin-manifest.json` (12,529 files) verified byte for byte in CI; new versions only through the manual bootstrap workflow | `fetchEngines.test`, `binManifest.test`, CI tamper step and strict verify (TESTING § Engine payload pinning); signing: F1 |
| MOR-11 | **Fixed** | `OfficeProfileManager`: per-build profile, lock, ready marker, one rebuild, long-path fallback | Office tests in `engines.test`; Windows: 100-character limit, Hebrew paths, cancelled first start, damaged profile (`payload.test`) |
| MOR-12 | **Fixed** | `ToolRegistry` probes versions/encoders/sharp/heic; targets from capabilities; missing engine named in the row | `capabilities.test`, `engines.test` (an absent engine’s targets are not offered) |
| MOR-13 | **Fixed for the tested scope**; real-world corpus open (E2) | fidelity per direction with UI notes; known limits per direction shown when that target is chosen (Calibre e-book → DOCX loses paragraph RTL); signature validation; README limitation; generated `docs/FORMATS.md` | 69/69 directions engine-tested with content checks on generated fixtures (Linux and the bundled Windows engines); not proof of perfect fidelity or of every real-world file |
| MOR-14 | **Fixed** | structural GIF parser, confidence, intake reservation, bounded worker pool, error vs unsupported | `detection.test`, e2e duplicate drops |
| MOR-15 | **Fixed** | atomic versioned repositories, v0 migration, history after publication, terminal UI state on IPC failure, settings snapshot | `repositories.test`, `coordinator.test` |
| MOR-16 | **Fixed** | `resolveWallTime` with gap/fold policy and UI note; calendar-day offsets; KB vs KiB; averages labelled | `timeZoneConversion.test`, `units.test` |
| MOR-17 | **Cancelled** (owner) | none; controls unchanged (screenshots identical) | — |
| MOR-18 | **Fixed** (docs/legal review remains owner work) | renderer split, no cycle, enforced import rules, test hook out of production, AGENTS.md, architecture/testing/release docs | `check:imports`, CI grep on bundle |

## Backlog

| ID | Item | Status | Blocked by | Blocks | Lane / size |
| --- | --- | --- | --- | --- | --- |
| W1 | Windows checks that a CI server cannot do: real USB stick and antivirus locks, drag and drop from Explorer, on a clean Windows 10/11 desktop | Ready | a Windows 10/11 desktop (owner or QA) | release approval | QA / S |
| W2 | Require the three CI checks on `main` (ruleset; exact names in `docs/RELEASING.md` §1) | Ready | owner (repository settings; not changed by this PR) | merge gating | Release / S |
| D2 | Windows Job Object (kill-on-close, memory cap) and restricted token / AppContainer for tool processes and workers. Process separation today is not OS confinement | Planned | design + Windows measurements | stronger MOR-03/05/09 | Native + security / L |
| E2 | Real-world document corpus (embedded fonts, images, tracked changes, scanned PDFs, large spreadsheets), with licences to keep the files | Planned | collecting files the owner may test with | fidelity claims beyond generated fixtures | Engine + QA / M |
| E4 | Calibre e-book → DOCX keeps the Hebrew text but not paragraph RTL; a post-processing step could set `w:bidi` | Optional | — | — | Engine / S |
| E3 | Per-engine bounded parallelism (e.g. ffmpeg alongside Office) | Deferred | timings from the payload job | throughput | Application / M |
| F1 | Code signing: certificate or Trusted Signing, secrets `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`, variable `MORPH_PUBLISHER`, then `publisherName` with the first signed release | Pending | owner: certificate and secrets (`docs/RELEASING.md` §5) | release approval; signed update verification | Release / M |
| F2 | Decide whether a release ships or hosts the GPL/LGPL engines' corresponding source; notices already list exact versions and source links | Ready | owner / legal | release approval | Release + legal / S |
| F3 | After the first real release: let the previous published version auto-update from GitHub Releases on a clean VM (the local-feed test covers the updater itself) | Planned | a published release (owner) | — | Release / S |
| U1 | Show "cancelled" text on a stopped row (today: same as 1.0.3, the row returns to ready) | Optional | — | — | Frontend / S |
| U2 | Optional engine packs to reduce the ~590 MiB installer | Deferred | owner decision | — | Release / L |

Done in this PR (were backlog items): E1 engines pinned and recorded; Calibre directions tested
(7/7); Windows payload, packaged app, installer and in-app update checks in CI (in-app update:
Pass in run 38631238070).
