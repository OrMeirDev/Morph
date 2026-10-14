# Working on Morph (humans and AI agents)

Morph is a local, offline Windows file converter (Electron + React, Hebrew RTL, blue glass design).
Read `docs/ARCHITECTURE.md` before changing code. These rules are enforced by
`npm run check:imports` and the tests; a change that needs to break one needs a reviewed reason.

## Non-negotiables

- **Originals are never written.** No adapter may use the input as its output, and nothing
  overwrites an existing file. Outputs are published only by `infra/OutputPublisher.cjs`.
- **Local and offline.** Conversion never needs the network. No cloud services.
- **Main owns jobs.** The renderer sends commands (`enqueue`, `cancel`) and mirrors `job:update`.
  Only `app/ConversionCoordinator.cjs` changes a job's state, records history, or publishes.
- **Cancel means no output.** Check `ctx.throwIfCancelled()` between phases; anything that cannot
  be interrupted runs in a worker or a tool process that cancellation kills. A cancelled job never
  publishes and never reports success.
- **Verify before publishing.** Every target needs a signature check in
  `infra/artifactValidator.cjs`; a zero exit code is not proof.
- **Offer only what works.** Targets come from `domain/capabilities.cjs` filtered by the probed
  `ToolRegistry`. Adding a format = a capability entry + an adapter path + a test in
  `test/electron/engines.test.cjs` + `node scripts/format-matrix.cjs`. Never add options in the UI by hand.
- **Say what is lost.** Every capability has a fidelity category; categories that change more than
  size have a Hebrew note in `src/presentation/fidelityNotes.js`. Do not claim lossless conversions.
- **Untrusted input.** Every IPC channel has a schema in `electron/ipc/schemas.cjs`; every tool call
  goes through `ProcessRunner` (deadline, bounded logs, tree kill); archives pass
  `domain/archivePolicy.cjs` before extraction.

## Layers and allowed imports

| Layer | May import | Must not import |
| --- | --- | --- |
| `src/domain`, `src/presentation` | each other (presentation -> domain) | React, Electron, Node APIs, features |
| `src/design` | React, lucide | features, services, domain, app |
| `src/features/*` | design, components, presentation, domain, services | `src/app`, Electron, Node |
| `src/services/morphApi.js` | — | (the only place that reads `window.morph`) |
| `electron/domain` | other domain modules | Electron, fs, child_process, React |
| `electron/infra` | domain | ipc, app, main.cjs |
| `electron/adapters` | domain, infra | Electron, ipc, app (they also run in workers) |
| `electron/workers` | adapters, infra, domain | `electron` module, ipc, app |
| `electron/app` | domain, infra | ipc, Electron |
| `electron/ipc`, `electron/main.cjs` | everything | — |

No import cycles. Nothing imports an `App.jsx`.

## Before you push

```
npm run check          # import rules + all tests (incl. real engines present on this machine) + build
npm run e2e:flow       # real window: add, convert, stop, forged IPC, history, CSP
```

Changes to native engines, `bin/`, Electron, sharp or packaging also need the Windows checks in
`docs/TESTING.md`. A mock or a green build does not prove installed behaviour.

## Keep changes reviewable

Architecture refactors, dependency/Electron/tool upgrades and new formats go in separate commits or
PRs. Test-only hooks (`window.__morphAdd`) exist only in dev and `VITE_E2E_HOOKS` builds.

## Scope decisions

- **MOR-17 (accessibility overhaul of the glass select, calendar and time controls) is cancelled
  by the owner.** Do not redesign those controls, change their focus/announcement behaviour, or add
  its keyboard/NVDA/reduced-motion/high-contrast/DPI test campaign or release gates. Keep their
  current appearance and behaviour; cancelling that work does not mean removing anything.
