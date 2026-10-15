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
                                            │ runInFreshWorker ───────────────▶ engine worker (per job)
                                            ▼                                   adapters/imageOps (sharp…)
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

## Process isolation, honestly (D2)

Two guarantees, tracked and reported separately. Neither is called a sandbox without saying which.

### 1. Lifetime and resources — every engine, Windows

Every engine call (`ToolRegistry.run` → `infra/Confinement.cjs` → `native/out/morph-confine.exe`)
runs in its own **Job Object**, held only by the helper:

- `KILL_ON_JOB_CLOSE`: Stop kills the helper, and with it every process in the job (LibreOffice's
  `soffice.bin`, Calibre's `calibre-parallel`, conhost…); `taskkill /T` stays as a second path.
- Parent watch: if Morph dies (crash, Task Manager), the helper ends the job within 250 ms.
- When the engine's main process exits, anything it left behind is killed after 2 s.
- Limits per engine (`domain/confinementPolicy.cjs`): job-wide committed memory and active
  processes, chosen from measured peaks (rule and numbers in the file); a hit ends the job with
  `limit-memory` / `limit-processes`, the job fails, nothing is published. Override:
  `MORPH_CONFINE_LIMITS`.
- UI restrictions: no clipboard, no global atoms, no display/system settings, no logoff.

### 2. Files and network — per engine, from measurements

| Tier | Engines | Files | Network |
| --- | --- | --- | --- |
| AppContainer (no capabilities) | ffmpeg, ffprobe, 7-Zip, pdftoppm, pdftotext, pdfinfo | read: only its own folder under `bin\`; write: only the job workspace | none (loopback included) |
| Low integrity (restricted token) | LibreOffice, Calibre | write: only folders Morph labelled Low (the job workspace, the LibreOffice profile); **read: anything the user can read** | **not restricted** |

LibreOffice and Calibre are not in the AppContainer because they do not run there (measured,
reasons in `confinementPolicy.cjs`). Both tiers never see the original or the output folder:
`ctx.input()` copies the input into the workspace, engines write there, and the coordinator
publishes (staging → reservation → rename) as before. Grants and labels are only added to folders
Morph owns (`bin\<engine>` read-only, job workspaces, the LibreOffice profile); system and user
folders are never modified. The AppContainer profile `Morph.Engines` is created on first use and
deleted by the uninstaller.

Modes, shown on the settings page and in `tools:status`: `enforced`; `unavailable` (helper missing
→ engines refused, never run unconfined); `disabled` (`MORPH_CONFINEMENT=off`, diagnostics);
`unsupported` (not Windows).

### Not confined (open, tracked in `docs/AUDIT-STATUS.md`)

- Low-integrity engines can read the user's files and reach the network (D2b).
- Detection and image work (sharp, file-type, pdf-lib) run in an Electron utility process: separate
  process, deadline, killed on cancel, but Electron offers no OS confinement for a Node utility
  process (D2c).
- All jobs use one AppContainer identity: with concurrency above 1, one engine could read another
  job's workspace (concurrency is 1 today).
- FAT32/exFAT volumes have no ACLs and no integrity labels: measured, an AppContainer engine (ffmpeg) can write to such a drive (run 38684568676). Morph never gives an engine a path there, but a compromised engine could reach it.
- A Low-integrity LibreOffice whose write is refused does not exit; Morph's deadline ends it.
