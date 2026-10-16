# Release checklist

A release is a tested commit, the pinned and verified engine payload, a signed installer and
published provenance. Nothing here publishes on its own; every step names who does it.

## 1. Required checks on `main` (owner, once) — PENDING

Checked again on 2026-10-15: `main` has **no rulesets and no rules in effect** (`GET /repos/OrMeirDev/Morph/rulesets`
and `/rules/branches/main` both empty), so there is no stronger rule to preserve. Creating the
ruleset from this session was attempted and refused: the session's GitHub access does not include
repository administration ("Write access to this GitHub API path is not permitted"). The ruleset is
ready as `.github/rulesets/main.json`:

- require a pull request (0 approvals, so the owner can merge their own PRs);
- block force pushes (`non_fast_forward`);
- require these exact checks, reported by GitHub Actions (app id 15368):
  `Checks and engine matrix (Linux)`, `Checks (Windows, no bundled engines)`,
  `Bundled engines, packaged app and installer (Windows)`.

Owner, either: Settings → Rules → Rulesets → New ruleset → **Import a ruleset** →
`.github/rulesets/main.json` → Create; or, with an admin token,
`gh api -X POST repos/OrMeirDev/Morph/rulesets --input .github/rulesets/main.json`.
Check afterwards: `gh api repos/OrMeirDev/Morph/rules/branches/main` lists the three rules.

## 2. Engines: pinned, tested, recorded (developer + CI)

- `scripts/engines.lock.json` holds the exact URL and SHA-256 of every engine download. Change it only
  in a PR whose `Bundled engines, packaged app and installer (Windows)` job passes.
- To move an engine to a new version (maintenance, by hand): in a branch, put the new URL in the lock
  without `sha256` (or a `download.resolve` entry for a GitHub release), run the **Engine bootstrap
  (maintenance)** workflow (`.github/workflows/engine-bootstrap.yml`, manual only) on that branch,
  review its artifact (resolved hashes, payload manifest, test log), then commit the hashes and the
  manifest. Regular CI never resolves: it fetches with `--require-pinned`, caches only verified
  downloads, re-checks every cached file, proves a tampered package is refused, and verifies `bin/`
  byte for byte against `bin-manifest.json` before and after the tests.
- Locally: `npm run fetch-bin` (= `node scripts/fetch-engines.cjs --require-pinned`, Windows) then
  `npm run bin:verify`. A missing, changed or unexpected file, a cached download that differs from
  the lock, or an unpinned engine stops with a message.

## 3. Windows evidence (CI + manual)

`docs/TESTING.md` § Windows checks lists every check with Pass / Fail / Pending, the tested commit,
OS and engine versions. CI covers the bundled engines, the packaged app, installing over 1.0.3,
uninstalling and the in-app update with the real updater from a local feed during a running
conversion. Every check must be Pass for a release; the ones CI cannot do (drag and drop from
Explorer, a real USB stick and antivirus behaviour, the signed publisher) are done on a clean
Windows 10/11 desktop and recorded there. A signature step that reports `NotSigned` is Pending even
though the step succeeds.

## 4. Version and notes (developer)

Bump `version` in `package.json`; release notes list user-visible changes and the known limits in
`docs/FORMATS.md`.

## 5. Signing (owner: certificate; developer: configuration) — PENDING

Ready without credentials (done in the repository):

- What gets signed: `Morph.exe`, `resources\native\morph-confine.exe`, the installer, the
  uninstaller and electron-builder's `elevate.exe` (inside the installer). The third-party engines
  in `resources\bin` are **not** signed with Morph's certificate: LibreOffice and Calibre ship with
  their publishers' signatures, and re-signing them would replace those and vouch for code Morph
  did not build. They are copied by the `afterPack` hook (`scripts/after-pack.cjs`), outside
  electron-builder's signing pipeline, not through `extraResources`. (`win.signExts` cannot do this:
  it matches file-name suffixes for Morph's own files and the engines alike; the earlier
  `["morph-confine.exe", "!.exe"]` silently excluded `Morph.exe`, the installer and the
  uninstaller, and a single-file `extraResources` entry is never sent for signing at all. CI caught
  both.) CI checks the list on every build (`signed-files.txt` in the evidence: no file under
  `resources\bin`; `Morph.exe`, `morph-confine.exe`, the installer and the uninstaller present;
  "skipped via signExts" lines do not count as sent).
- CI passes either signing route to electron-builder when it is configured, and does nothing
  otherwise; `e2e/signature-check.cjs` reports `pending` (never a pass) while nothing is signed.

Missing inputs (owner), one route:

- **A — certificate file:** a Windows code-signing certificate (OV or EV that allows file export)
  as `.pfx` + password → repository secrets `WIN_CSC_LINK` (base64 of the .pfx) and
  `WIN_CSC_KEY_PASSWORD`.
- **B — Azure Trusted Signing:** an account and certificate profile, and a service principal with
  the "Trusted Signing Certificate Profile Signer" role → secrets `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; variables `AZURE_SIGNING_ENDPOINT` (e.g.
  `https://weu.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.

For both: repository variable `MORPH_PUBLISHER` = the certificate subject CN exactly. With it, CI
requires a Valid, timestamped signature by that subject on the installer and `Morph.exe`. Route B
also writes the publisher into `app-update.yml`, so updates signed by anyone else are refused; for
route A add `"win": { "signtoolOptions": { "publisherName": "<same CN>" } }` with the first signed
release (not before: an installed app with a publisher rejects unsigned updates).

Never paste a certificate, password or client secret into an issue, PR, log or document; only
repository secrets hold them, and CI never prints them. Until a signature is verified, CI reports
`NotSigned` (`signature.json`), the README says the installer is unsigned, and no release is called
signed.

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
