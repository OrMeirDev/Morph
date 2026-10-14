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
| MOR-01 | **Fixed** | coordinator-owned AbortSignal; checks before each phase and before publish; image work in a per-job worker killed on cancel; staging | `coordinator.test` (3 cancel phases), `engines.test` MOR-01 ×2 with real sharp, e2e "no SVG written after stop" |
| MOR-02 | **Fixed** | `ConversionCoordinator` owns queue/attempts/concurrency/cancel/history; duplicate active jobs rejected; renderer mirrors `job:update` | `coordinator.test` |
| MOR-03 | **Fixed (process separation)**; OS restriction pending | detection and image work in `utilityProcess` with deadlines | `engines.test`, e2e; restricted token/Job Object: backlog D2 |
| MOR-04 | **Fixed** | sender/frame/URL guard, per-channel schemas, file IDs from intake, backend-decided kind/targets, revalidation, open/show limited to Morph outputs, CSP, window-open denied, sandbox explicit | `ipc.test`, e2e forged-IPC checks |
| MOR-05 | **Fixed (application level)**; engine FS restriction pending | listing preflight (traversal, absolute, drive, links, encryption, size, ratio, count, depth, free space), post-extraction tree check, cleanup on cancel | `archivePolicy.test`, `engines.test` hostile zips; Windows 7z.exe run pending |
| MOR-06 | **Fixed** | same-disk staging, signature validation, exclusive reservation + rename, journal-based recovery | `outputPublisher.test`, `coordinator.test`; FAT32/network share pending |
| MOR-07 | **Fixed** for runtime; build-time exception recorded | Electron 44.5.1, sharp 0.35.5, file-type 21.3.4, electron-builder 26.17, Vite 7.3.6 | `npm audit --omit=dev` = 0; `docs/DEPENDENCIES.md` |
| MOR-08 | **Partly fixed** | 126 tests, real-engine matrix, e2e flow, CI on Linux + Windows | CI has not run yet (needs a PR or manual dispatch); branch protection is an owner setting |
| MOR-09 | **Fixed**; Windows tree kill to be confirmed | `ProcessRunner` deadlines, bounded logs, spawn errors, tree kill; update/quit wait for cancelled jobs | `processRunner.test` (descendant killed, POSIX here; runs on Windows CI) |
| MOR-10 | **Partly fixed** | `bin-manifest.json` record/verify gates `dist`/`release`; version pins and `-RequirePinned` | pins must be chosen from a tested Windows build; signing not configured |
| MOR-11 | **Fixed**; Windows long-path check pending | `OfficeProfileManager`: per-build profile, lock, ready marker, one rebuild | Office tests in `engines.test` |
| MOR-12 | **Fixed** | `ToolRegistry` probes versions/encoders/sharp/heic; targets from capabilities; missing engine named in the row | `capabilities.test`, `engines.test` (Calibre absent → not offered) |
| MOR-13 | **Partly fixed** | fidelity per direction with UI notes; signature validation; README limitation; generated `docs/FORMATS.md` | 29 directions marked "not yet" tested; complex document fixtures pending |
| MOR-14 | **Fixed** | structural GIF parser, confidence, intake reservation, bounded worker pool, error vs unsupported | `detection.test`, e2e duplicate drops |
| MOR-15 | **Fixed** | atomic versioned repositories, v0 migration, history after publication, terminal UI state on IPC failure, settings snapshot | `repositories.test`, `coordinator.test` |
| MOR-16 | **Fixed** | `resolveWallTime` with gap/fold policy and UI note; calendar-day offsets; KB vs KiB; averages labelled | `timeZoneConversion.test`, `units.test` |
| MOR-17 | **Cancelled** (owner) | none; controls unchanged (screenshots identical) | — |
| MOR-18 | **Fixed** (docs/legal review remains owner work) | renderer split, no cycle, enforced import rules, test hook out of production, AGENTS.md, architecture/testing/release docs | `check:imports`, CI grep on bundle |

## Backlog

| ID | Item | Status | Blocked by | Blocks | Lane / size |
| --- | --- | --- | --- | --- | --- |
| W1 | Run the Windows checks in `docs/TESTING.md` (bundled engines, tree kill, profile, NTFS/FAT/share, packaged app, update from 1.0.3) | Ready | a Windows machine with `fetch-bin` | E, F | QA / M |
| W2 | First CI run and required checks on `main` | Ready | owner opens a PR or dispatches the workflow; owner sets the ruleset | merge gating | Release / S |
| D2 | Windows Job Object (kill-on-close, memory cap) and restricted token for tool processes and workers | Planned | W1 measurements | stronger MOR-03/05/09 | Native + security / L |
| E1 | Choose and record pinned engine versions; `bin:record` | Ready | W1 | F1 | Engine / S |
| E2 | Project-owned fixtures for complex Office/PDF (tables, fonts, formulas, slides, page counts) and Calibre directions; raise "not yet" rows in `docs/FORMATS.md` | Planned | Calibre on a test host | MOR-13 completion | Engine + QA / M |
| E3 | Per-engine bounded parallelism (e.g. ffmpeg alongside Office) | Deferred | W1 timings | throughput | Application / M |
| F1 | Code signing, signed update verification, release provenance | Planned | certificate / signing service (owner) | release approval | Release / M |
| F2 | Notices with exact bundled versions and source availability for GPL/LGPL engines | Planned | E1 | release approval | Release + legal / S |
| U1 | Show "cancelled" text on a stopped row (today: same as 1.0.3, the row returns to ready) | Optional | — | — | Frontend / S |
| U2 | Optional engine packs to reduce the ~590 MiB installer | Deferred | measurements after E1 | — | Release / L |
