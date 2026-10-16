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
| MOR-03 | **Fixed** (D2) where confinement is enforced (Windows; run 38766954377 on 92ee37c): image work and file detection run in per-job / dedicated AppContainers | image worker launched through morph-confine.exe in a per-job AppContainer (Electron in node mode, stdio IPC, input copied into the workspace, provisional success until the helper closed); detection in a confined worker that is never given the path (Morph serves bounded byte ranges); detection is refused when confinement is unavailable | `isolation.test`: in the worker container the original is EPERM to read/write, nothing outside the workspace can be created, no loopback; detection under morph-confine.exe gives the same answers as reading the file; `confinedDetection.test` (no path reaches the worker, bounded reads); `workerLifecycle.test` |
| MOR-04 | **Fixed** | sender/frame/URL guard, per-channel schemas, file IDs from intake, backend-decided kind/targets, revalidation, open/show limited to Morph outputs, CSP, window-open denied, sandbox explicit | `ipc.test`, e2e forged-IPC checks |
| MOR-05 | **Fixed** (application level + 7-Zip in a per-job AppContainer); FAT32/exFAT not protected by ACLs | listing preflight, post-extraction tree check, cleanup on cancel; 7-Zip confined | `archivePolicy.test`, `engines.test`, `confinement.test` (7-Zip refused extracting outside the workspace) |
| MOR-06 | **Fixed** | same-disk staging, signature validation, exclusive reservation + rename, journal-based recovery; Stop checked before every rename attempt | `outputPublisher.test`, `coordinator.test`; Windows NTFS, FAT32/exFAT virtual disks and SMB share in `payload.test`; real USB stick / antivirus pending (TESTING § Windows checks #4) |
| MOR-07 | **Fixed** for runtime; build-time exception recorded | Electron 44.5.1, sharp 0.35.5, file-type 21.3.4, electron-builder 26.17, Vite 7.3.6 | `npm audit --omit=dev` = 0; `docs/DEPENDENCIES.md` |
| MOR-08 | **Fixed** except the owner setting | 250 tests, real-engine matrix on Linux and with the bundled engines on Windows, confinement diagnostics and tests, packaged smoke, installer and in-app update checks, e2e flow | three CI jobs on PR #1 (run 38766954377 on `92ee37c`); making them required on `main` is an owner setting (W2, `docs/RELEASING.md` §1) |
| MOR-09 | **Fixed** | `ProcessRunner` deadlines, bounded logs, tree kill; every engine in a Job Object with kill-on-close, parent watch, orphan kill, memory and process limits from measurements | killing only the helper ends soffice.com + soffice.bin and ebook-convert + calibre-parallel; killing the parent (crash) ends the engines; a limit hit fails the job cleanly (`confinement.test`, Windows CI) |
| MOR-10 | **Fixed** (signing pending) | `scripts/engines.lock.json` pins exact URL + SHA-256 for all five engines; `fetch-engines.cjs --require-pinned` verifies fresh and cached downloads; `bin-manifest.json` (12,529 files) verified byte for byte in CI; new versions only through the manual bootstrap workflow | `fetchEngines.test`, `binManifest.test`, CI tamper step and strict verify (TESTING § Engine payload pinning); signing: F1 |
| MOR-11 | **Fixed** | `OfficeProfileManager`: per-build profile, lock, ready marker, one rebuild, long-path fallback | Office tests in `engines.test`; Windows: 100-character limit, Hebrew paths, cancelled first start, damaged profile (`payload.test`) |
| MOR-12 | **Fixed** | `ToolRegistry` probes versions/encoders/sharp/heic; targets from capabilities; missing engine named in the row | `capabilities.test`, `engines.test` (an absent engine’s targets are not offered) |
| MOR-13 | **Fixed for the tested scope**; corpus started (E2) | fidelity per direction with UI notes; known limits shown when that target is chosen (Calibre e-book → DOCX loses paragraph RTL, pinned by a test); signature validation; generated `docs/FORMATS.md` | 69/69 directions on generated fixtures; 6 real-world public-domain files (`test/corpus`, `corpus.test`): Hebrew poem with niqqud DOCX/EPUB/PDF, IRS W-9 PDF, Census XLSX, Gutenberg EPUB. Not proof for every file |
| MOR-14 | **Fixed** | structural GIF parser, confidence, intake reservation, bounded worker pool, error vs unsupported | `detection.test`, e2e duplicate drops |
| MOR-15 | **Fixed** | atomic versioned repositories, v0 migration, history after publication, terminal UI state on IPC failure, settings snapshot | `repositories.test`, `coordinator.test` |
| MOR-16 | **Fixed** | `resolveWallTime` with gap/fold policy and UI note; calendar-day offsets; KB vs KiB; averages labelled | `timeZoneConversion.test`, `units.test` |
| MOR-17 | **Cancelled** (owner) | none; controls unchanged (screenshots identical) | — |
| MOR-18 | **Fixed** (docs/legal review remains owner work) | renderer split, no cycle, enforced import rules, test hook out of production, AGENTS.md, architecture/testing/release docs | `check:imports`, CI grep on bundle |

## Backlog

| ID | Item | Status | Blocked by | Blocks | Lane / size |
| --- | --- | --- | --- | --- | --- |
| W1 | Windows desktop checks a CI server cannot do: Explorer drag and drop, a real USB stick, Defender behaviour (Hebrew checklist with evidence fields: `docs/QA-WINDOWS-DESKTOP.he.md`) | Ready | a Windows 10/11 desktop and a tester (owner) | release approval | QA / S |
| W2 | Ruleset on `main`: pull requests, no force pushes, the three CI checks. `.github/rulesets/main.json` is preparation only, not active protection; applying it from this session was refused (no admin access). Stays Pending until `GET /repos/OrMeirDev/Morph/rules/branches/main` shows the rules | **Pending** | owner (repository admin) | merge gating | Release / S |
| D2a | Job Object for every engine and the image worker: kill-on-close, parent watch, orphan kill, limits from measured stress peaks | **Done** | — | — | Native / — |
| D2b | Per-job AppContainer (no network; files only as granted, via ACLs) for ffmpeg, ffprobe, 7-Zip, Poppler and the image worker (sharp); per-job identity so jobs cannot read each other's workspace; profiles created and removed | **Done** | — | — | Native + security / — |
| D2c | LibreOffice and Calibre: Low integrity (no writes to Medium files; default DACL and private desktop so they start for elevated users too), but reads, network and writes into other Low folders (e.g. LocalLow) are open. Measured with real conversions (run 38753883753): AppContainer — LibreOffice never returns, Calibre needs NUL; write-restricted token — LibreOffice 0xC0000142, Calibre hangs; read-restricted token — reads blocked as intended but LibreOffice hangs and Calibre cannot create folders inside its own temp folder (Python's 0o700 owner-only ACL). Remaining routes: network via a per-executable Windows Firewall rule (machine-level, administrator: owner decision); reads/writes only by changing the engines (pinned payloads) | **Partial** | engine internals; owner decision on a machine-level rule | full confinement of documents and e-books | Native + security / L |
| D2d | File detection in a confined worker (AppContainer, Job Object) that never gets the path: Morph serves byte ranges (≤ 1 MiB per read, ≤ 64 MiB per file); refused when confinement is unavailable; verified on Windows in run 38766954377 (92ee37c: isolation test, packaged app, installer, auto-update) | **Done** | — | — | Native + security / — |
| D2e | FAT32/exFAT have no ACLs or labels: no tier protects them, and nothing in user mode can (a confined engine can write to any mounted FAT32/exFAT volume, not only its job's; measured). Options: accept and document, or warn when such a volume is mounted | **Open** | owner decision (residual risk / USB-stick behaviour) | — | Application / S |
| D2f | Concurrency above 1: per-job identities are in place (measured isolation between live jobs); LibreOffice profile is still shared | **Ready** | E3 | E3 | Native / S |
| E2 | Real-world corpus beyond the 6 files: a real PPTX, tracked changes, embedded fonts in DOCX, scanned (image-only) PDFs, large spreadsheets | In progress | suitably licensed files | broader fidelity claims | Engine + QA / M |
| E4 | Calibre e-book → DOCX keeps Hebrew text but not paragraph RTL (pinned by `corpus.test`/`ebooks.test`; shown to the user). A post-processing step could set `w:bidi` | Optional | — | removing the limit note | Engine / S |
| E3 | Per-engine bounded parallelism (e.g. ffmpeg alongside Office) | Deferred | timings; D2f | throughput | Application / M |
| F1 | Code signing (**Pending** until a real signature is verified). Ready: signing selection (only Morph's executables; engines keep their publishers' signatures), CI wiring for a .pfx or Azure Trusted Signing, signature check. Missing: certificate or Trusted Signing account + secrets, `MORPH_PUBLISHER` (`docs/RELEASING.md` §5) | Pending | owner: certificate and secrets | release approval; signed update verification | Release / M |
| F2 | Decide whether a release ships or hosts the GPL/LGPL engines' corresponding source; notices list exact versions and source links | Ready | owner / legal | release approval | Release + legal / S |
| F3 | After the first real release: let the previous published version auto-update from GitHub Releases on a clean VM | Planned | a published release (owner) | — | Release / S |
| L1 | Local validation under a genuine standard (non-administrator) account; run 2026-10-16 was an unelevated administrator (`docs/LOCAL-WINDOWS-VALIDATION.he.md`) | **Pending** | a standard account (owner) | release approval | QA / S |
| L2 | Installer over 1.0.3 and the in-app updater on a desktop, in a separate account or VM (cannot be isolated from the everyday per-user install) | **Pending** | separate account or VM (owner) | release approval | QA + Release / S |
| L3 | The Basic User regression and the profile-sweep regression pass on the CI runners | Ready | a CI run on the PR | merge | CI / S |
| U1 | Show "cancelled" text on a stopped row | Optional | — | — | Frontend / S |
| U2 | Optional engine packs to reduce the ~590 MiB installer | Deferred | owner decision | — | Release / L |

Done in this PR (were backlog items): E1 engines pinned and recorded; Calibre directions tested
(7/7); Windows payload, packaged app, installer and in-app update checks in CI; D2a and D2b
(Job Objects for everything; per-job AppContainers for ffmpeg, 7-Zip, Poppler and the sharp image
worker, proven with real restricted processes); D2d (detection in a confined worker fed byte ranges; verified in run 38766954377). D2 as a whole stays Partial (D2c, D2e).
