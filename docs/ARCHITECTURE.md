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
                                            │ ctx (workspace, run, worker, staging, signal)
                                            ▼
                                       adapters/{ffmpeg,image,pdf,office,ebook,archive}
                                            │ ProcessRunner ──────────────────▶ ffmpeg, 7-Zip, Poppler,
                                            │                                   LibreOffice, Calibre
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

## Process isolation, honestly

- Detection and image work run in an Electron utility process: a crash, hang or memory blow-up
  ends the worker, not the app; deadlines kill hung requests. It is **not** an OS sandbox.
- External tools run with deadlines and tree kill (`taskkill /T /F` on Windows, process groups
  elsewhere). Windows Job Objects (kill-on-close, memory caps), restricted tokens and per-tool
  filesystem/network restrictions are not implemented; see the backlog in `docs/AUDIT-STATUS.md`.
