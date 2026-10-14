# Release checklist

A release is a tested commit, the pinned and verified engine payload, a signed installer and
published provenance. Nothing here publishes on its own; every step names who does it.

## 1. Required checks on `main` (owner, once)

Checked on 2026-10-14: `main` has **no branch protection and no rulesets**. Settings → Rules →
Rulesets → New branch ruleset, target `main` (default branch), enable:

- Require a pull request before merging.
- Require status checks to pass, with these exact check names (from `.github/workflows/ci.yml`):
  - `Checks and engine matrix (Linux)`
  - `Checks (Windows, no bundled engines)`
  - `Bundled engines, packaged app and installer (Windows)`
- Block force pushes.

## 2. Engines: pinned, tested, recorded (developer + CI)

- `scripts/engines.lock.json` holds the exact URL and SHA-256 of every engine download. Change it only
  in a PR whose `Bundled engines, packaged app and installer (Windows)` job passes.
- To move an engine to a new version: put the new URL in the lock without `sha256` (or a
  `download.resolve` entry for a GitHub release), let the Windows payload job run in non-strict mode
  (`node scripts/fetch-engines.cjs --resolve-out engines.resolved.json`), review the hash it computed
  and the tests it ran, then commit the hash and the job's `bin-manifest.ci.json` as
  `bin-manifest.json`. CI then fetches with `--require-pinned` and verifies `bin/` byte for byte.
- Locally: `npm run fetch-bin` (= `node scripts/fetch-engines.cjs --require-pinned`, Windows) then
  `npm run bin:verify`. A missing, changed or unexpected file, a cached download that differs from
  the lock, or an unpinned engine stops with a message.

## 3. Windows evidence (CI + manual)

`docs/TESTING.md` § Windows checks lists the eight checks with Pass / Fail / Pending, the tested
commit, OS and engine versions. Every check must be Pass for a release; the ones CI cannot do
(drag and drop from Explorer, real USB stick and antivirus behaviour, in-app auto-update from a
published feed, signed publisher) are done on a clean Windows 10/11 VM and recorded there.

## 4. Version and notes (developer)

Bump `version` in `package.json`; release notes list user-visible changes and the known limits in
`docs/FORMATS.md`.

## 5. Signing (owner: certificate; developer: configuration) — PENDING

Missing inputs, none of which exist in the repository today:

1. A Windows code-signing certificate (OV or EV) as a `.pfx` and its password, **or** an Azure
   Trusted Signing account (endpoint, account name, certificate profile) with a service principal.
2. Repository secrets `WIN_CSC_LINK` (base64 of the .pfx or a URL) and `WIN_CSC_KEY_PASSWORD`;
   electron-builder signs `Morph.exe` and the installer when they exist (S7).
3. Repository variable `MORPH_PUBLISHER`: the certificate subject CN. With it, CI's
   `e2e/signature-check.cjs` requires a Valid, timestamped signature by that subject on both files.
4. Then add `"win": { "signtoolOptions": { "publisherName": "<same CN>" } }` to the electron-builder
   config, so `app-update.yml` carries the publisher and electron-updater refuses updates signed by
   anyone else. Do not add it before the first signed release: an installed app with a
   publisherName rejects unsigned updates.

Until then CI reports `NotSigned` for both files (`signature.json` in the job's evidence), the README
says the installer is unsigned, and no release is called signed.

## 6. Package and publish (owner)

`npm run release` verifies `bin/` against the manifest, runs `npm run check`, builds and publishes.
Run it from the reviewed, merged commit with the verified payload only.

## 7. Provenance (owner)

Attach `bin-manifest.json`, `bin/ENGINES.json`, the SHA-256 of the installer and the commit SHA to
the GitHub release. Consider GitHub artifact attestations (S5) once the release build runs in Actions.

## 8. Distribution material (owner)

`THIRD_PARTY_NOTICES.md` names the bundled versions (test/electron/docs.test.cjs checks it against the lock); the
engines' license texts ship in their folders; the GPL/LGPL components' corresponding source is
reachable from the links there. Whether to mirror that source with the release is the owner's call.
This is a checklist, not legal advice.

## 9. After publishing (owner)

Install the release over the previous version on a clean VM and convert one file per family; let the
previous version auto-update to it once.
