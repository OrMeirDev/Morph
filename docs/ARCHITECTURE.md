# Morph architecture

A modular desktop monolith: feature-based React renderer, a main-process conversion coordinator
that owns every job, a registry of typed engine adapters, and isolated workers for parsing and
image computation. No cloud, no microservices.

```
renderer (sandboxed, CSP)            main process                              separate processes
─────────────────────────            ────────────                              ──────────────────
features/conversion ── commands ──▶ ipc/router (sender + schema check)
  useConversionQueue   (enqueue,      │
  useFileIntake         cancel)       ├─ app/FileIntakeService ── detect ──▶ engine worker (persistent)
        ▲                             │      issues file IDs                   infra/detection, gifFrames
        │ job:update                  └─ app/ConversionCoordinator                file-type
        └──────────────────────────────── queue, state, cancel, history
                                            │ ctx (workspace, input copy, run, worker, signal)
                                            ▼
                                       adapters/{ffmpeg,image,pdf,office,ebook,archive}
                                            │ ToolRegistry.run → ProcessRunner
                                            │   → morph-confine.exe (Job Object ─▶ ffmpeg, 7-Zip, Poppler
                                            │     + AppContainer / Low IL)          LibreOffice, Calibre
                                            │ runInFreshWorker → morph-confine ─▶ image worker (per job,
                                            ▼                                   AppContainer; sharp…)
                                       artifactValidator → OutputPublisher → HistoryRepository
```

## Renderer (`src/`)

| Module | Responsibility |
| --- | --- |
| `app/AppShell.jsx`, `app/routes.js` | page composition and navigation only |
| `components/` | `Sidebar`, `AppUpdateBanner`, `PageHeader` |
| `features/conversion/` | `ConvertPage` composes `FileDropZone`, `FormatGroupControls`, `ConversionQueue` → `ConversionRow` (= `FileIdentity`, `DetectionNotice`, `ConversionStatus`, `ConversionProgress`, `TargetFormatSelect`, `ConversionActions`, `OutputActions`), `BatchActions`, `ConversionSummary` |
| `features/conversion/useConversionQueue.js` | row list; sends enqueue/cancel; mirrors `job:update` (`jobStates.js`) |
| `features/conversion/useFileIntake.js` | drop/pick; synchronous path reservation against duplicate drops |
| `features/conversion/conversionSelectors.js` | pure: group targets, counts, batch eligibility |
| `features/history`, `features/settings`, `features/tools` | history list, validated preferences, engine health |
| `features/units`, `features/clock` | calculators (separate from file conversion) |
| `domain/units`, `domain/time` | pure unit conversion and time-zone math with an explicit DST policy |
| `presentation/` | formatters, format labels, error and fidelity messages |
| `design/` | `GlassSelect`, `GlassDate`, `GlassTime`, `useGlassPopover`, `liquidGlass`, CSS (unchanged look and behaviour) |
| `services/morphApi.js` | the only access to `window.morph` |

## Main process (`electron/`)

| Module | Contract |
| --- | --- |
| `domain/formats.cjs` | kinds, extensions, `classify()` with confidence (`content`, `extension`, `container`) |
| `domain/capabilities.cjs` | `(kind, ext, target)` → adapter, required capability IDs, fidelity; `targetsFor()` |
| `domain/jobState.cjs` | lifecycle `queued → preparing → converting → verifying → publishing → completed`, or `failed`/`cancelled`/`interrupted` |
| `domain/archivePolicy.cjs` | parse `7z l -slt`; reject traversal, absolute, links, encryption; budgets |
| `domain/limits.cjs` | deadlines, log/capture bounds, archive and intake budgets |
| `infra/ToolRegistry.cjs` | resolve and **probe** engines (versions, ffmpeg encoders, sharp/heic in the worker) |
| `infra/ProcessRunner.cjs` | argv-only spawn, deadline, bounded tail, abort → process-tree kill |
| `infra/WorkerHost.cjs` | `utilityProcess` (app) / `fork` (tests); persistent detection worker, fresh worker per image job |
| `infra/JobWorkspace.cjs` | private `<tmp>/morph-jobs/<jobId>`; swept at startup |
| `infra/OutputPublisher.cjs` | same-disk staging `.~morph-<jobId>.<ext>`, exclusive reservation, rename; never overwrites |
| `infra/artifactValidator.cjs` | non-empty + format signature, per file and per page folder |
| `infra/repositories.cjs` | versioned, atomic JSON: settings (validated), history (v0 migration), job journal |
| `infra/OfficeProfileManager.cjs` | per-build profile, exclusive lock, ready marker, one rebuild |
| `adapters/*` | `run(ctx) → { path, isDir }`; no Electron APIs |
| `workers/engineWorker.cjs` | `detect`, `image`, `probe` requests |
| `app/FileIntakeService.cjs` | path checks, detection, target computation, file IDs, revalidation before work |
| `app/ConversionCoordinator.cjs` | the only owner of jobs (see below) |
| `ipc/schemas.cjs`, `ipc/router.cjs` | per-channel runtime schema; sender must be Morph's main frame on Morph's page |
| `main.cjs` | composition root, window, updates, lifecycle |

### Job lifecycle (ConversionCoordinator)

1. `enqueue(fileId, target)`: file known, no active job for it, capability exists, engines verified;
   settings snapshotted; journaled.
2. One job at a time (per-engine parallelism only after profile/output invariants are measured).
3. `preparing`: file revalidated (size + mtime), workspace created.
4. `converting`: adapter runs with an `AbortSignal`; tools and workers die on cancel.
5. `verifying`: signature check. `publishing`: last cancel check, then exclusive publish.
6. `completed` is reported only after the output exists; history is written by main.
7. Cancel at any point before the publish rename → `cancelled`, staging removed, no history.
8. Crash/forced quit: the journal lists staging files and reservations; the next start removes
   them and sweeps workspaces. Interrupted jobs are not restarted.

### Updates and quit

`update:install` and closing the window cancel all jobs and wait (bounded) for cleanup before
`quitAndInstall` / quit.

## Process isolation, honestly (D2 — Partial)

D2 covers all native processing of untrusted files. Status: **Partial**. Engines and the image
worker run confined; detection is not OS-confined, and LibreOffice/Calibre have only write
protection. Each guarantee below is stated with its conditions; none of it is called a sandbox
without them. Measurements: Windows Server 2025 (GitHub `windows-latest`), runs 38719799779 and
38722315865; tests `test/windows/confinement.test.cjs` and `test/windows/isolation.test.cjs`.

### 1. Lifetime and resources (Job Object) — every engine and the image worker

Every call (`ToolRegistry.run` / the image worker → `infra/Confinement.cjs` →
`native/out/morph-confine.exe`) runs in its own Job Object, held only by the helper:

- `KILL_ON_JOB_CLOSE`: Stop kills the helper and with it every process of the job (measured:
  `soffice.com` + `soffice.bin`, `ebook-convert` + `calibre-parallel`, the image worker).
- Parent watch: if Morph dies, the helper ends the job (measured: no engine or worker outlived a
  killed parent).
- Leftovers: when the engine's main process exits, anything it left is killed after 2 s.
- Limits per engine (`domain/confinementPolicy.cjs`), job-wide committed memory and active
  processes, from measured stress peaks (rule and numbers in the file). A hit ends the job with
  `limit-memory`/`limit-processes`; the job fails and nothing is published (measured).
- UI restrictions: clipboard, global atoms, display/system settings, logoff.
- This is lifetime and resources only; it says nothing about files or network.

### 2. Files and network — per engine, from measurements

| Tier | Runs | Files | Network |
| --- | --- | --- | --- |
| AppContainer, no capabilities, one identity **per job** | ffmpeg, ffprobe, 7-Zip, Poppler, the image worker (sharp/libvips, heic-convert, pdf-lib, imagetracerjs as Electron in node mode) | read: Morph's own folders through one capability (`morph.engines.read`: `bin\`, Morph's code and runtime); write: only that job's workspace (granted to the job's own AppContainer SID). Enforced through NTFS ACLs, so **not on FAT32/exFAT** | none; loopback included |
| Low integrity (restricted token: privileges dropped, Administrators deny-only; a private window station and desktop; the helper's hidden console) | LibreOffice, Calibre | write: refused to anything labelled Medium (normal user files) — allowed in the job workspace and the LibreOffice profile (labelled Low) **and in any other Low-labelled folder** (measured: Calibre wrote into `%USERPROFILE%\AppData\LocalLow`); read: **anything the user can read** | **not restricted** |

Measured for the AppContainer tier: a canary outside the workspace is not overwritten; reading an
original outside the workspace fails; code in the image worker's container gets EPERM reading or
writing the original and creating files outside its workspace, can write inside, loads sharp, and
its loopback connection times out with no connection reaching the server; ffmpeg cannot reach
127.0.0.1 or the internet while the host can (controls). Between jobs: an engine (pdfinfo) and the
image worker of job B cannot read job A's live workspace. On FAT32/exFAT an AppContainer engine
can write (ffmpeg changed a canary there): those volumes keep no permissions.

How engines are fed: they never get the original or the output folder. `ctx.input()` copies the
input into the job workspace; engines write there; the coordinator publishes (staging →
reservation → rename). A confined image worker's successful reply is provisional: the host waits
until the helper has exited, reads its statistics and lets its final outcome decide
(`infra/WorkerHost.cjs`).

Per-job identity: the helper registers the job's AppContainer profile (Windows refuses to start a
process in an unregistered one: error 2, measured) and deletes it on exit; if the helper is killed,
Morph deletes it after the process closed; at start-up Morph sweeps profiles a crash left. Measured:
no job profile is left after the test runs. Grants and labels are added only to folders Morph owns.

Why LibreOffice and Calibre are not in the AppContainer (measured): LibreOffice's first profile
start never returns there; Calibre (and Electron without `--no-stdio-init`) aborts because the
NUL device cannot be opened. A write-restricted token per job (so they could not write into other
Low folders) was measured too: neither starts with it, so it is not shipped.

Starting the Low tier (measured, run 38733280447): with a console of its own, the restricted
token cannot start the console host, and LibreOffice, Calibre and even `cmd.exe` exit with
0xC0000142 before running any code; sharing the helper's hidden console fixes it with
Administrators still deny-only. Under Git Bash (where the test steps run) a new console works, so
only the packaged app and the diagnostics, both started from PowerShell, showed it; the
diagnostics now cover that context and fail the build if the Low tier does not start there. The
private window station and desktop keep the engines away from the user's windows; they were not
the cause.

Modes, shown on the settings page and in `tools:status`: `enforced`; `unavailable` (helper missing
→ engines refused, never run unconfined); `disabled` (`MORPH_CONFINEMENT=off`, diagnostics);
`unsupported` (not Windows). `scripts/confine-diagnose.cjs` runs every mode through the helper.

### Not confined, or only partly (tracked in `docs/AUDIT-STATUS.md`)

- File detection (file-type and Morph's GIF reader, no native code) runs in an Electron utility
  process: separate process with a deadline, not OS-confined. It reads the original file.
- LibreOffice and Calibre: no read restriction, no network restriction, and writes into other
  Low-labelled folders are possible.
- FAT32/exFAT: no protection by ACLs for any tier.
- A refused write does not make LibreOffice exit; the deadline ends it.
