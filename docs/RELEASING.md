# Release checklist

A release is a tested commit, a verified engine payload, a signed installer and published
provenance. Nothing here is automated to publish on its own.

1. **Merged through a reviewed PR** with CI green (both jobs). Branch protection on `main` should
   require the `CI` checks (GitHub → Settings → Rules; owner action).
2. **Engines pinned and recorded.** Fill `$Pins` in `scripts/fetch-bin.ps1`, run
   `npm run fetch-bin -- -RequirePinned` on a clean machine, run `npm test` (no skips), then
   `npm run bin:record` and commit `bin-manifest.json`. Review its diff like code.
3. **Windows checks** in `docs/TESTING.md` § Pending on Windows: all pass, results in the PR.
4. **Version** bumped in `package.json`; release notes list user-visible changes and known
   conversion limits (see `docs/FORMATS.md`).
5. **Signing.** Configure Windows code signing in electron-builder (S7: certificate or a cloud
   signing service). Until then the installer is unsigned (README says so) and auto-update cannot
   verify the publisher. Verify the signature and publisher name on the built `.exe`.
6. **Package**: `npm run release` verifies `bin/` against the manifest, runs `npm run check`, builds
   and publishes. Do not run it with an unverified payload.
7. **Provenance**: attach `bin-manifest.json`, SHA-256 of the installer and the tested commit SHA to
   the GitHub release. Consider GitHub artifact attestations (S5) once the build runs in Actions.
8. **Distribution material**: `THIRD_PARTY_NOTICES.md` names the exact versions in the manifest;
   license texts from each engine folder are included; the corresponding source for the GPL/LGPL
   components (FFmpeg GPL build, Calibre, Poppler, 7-Zip LGPL parts, libvips/libheif) is available
   as their licenses require. This is a checklist, not legal advice.
9. **After publishing**: install the release over the previous version on a clean VM; convert one
   file per family.
