# Dependency and advisory record

Updated 2026-10-14 on branch `claude/dazzling-johnson-3zccoi`.

## Runtime (shipped in the app)

| Package | Version | Notes |
| --- | --- | --- |
| electron | 44.5.1 | supported major (42–44 supported at time of writing); was 33.4.11 (EOL) |
| sharp | 0.35.5 (libvips 8.18.7) | fixes GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w; runs only in the engine worker |
| file-type | 21.3.4 | fixes GHSA-5v7r-6r5c-r473 (ASF loop); runs only in the engine worker with a 15 s deadline. 22.x needs Node 22 (fine on Electron 44) and is optional |
| heic-convert | 2.1.0 | worker only |
| pdf-lib | 1.17.1 | worker only (image → PDF) |
| imagetracerjs | 1.2.6 | worker only (image → SVG) |
| electron-updater | 6.8.9 | |

`npm audit --omit=dev`: **0 vulnerabilities**.

## Build-time exceptions (not shipped)

| Advisory chain | Severity | Reachability | Action / expiry |
| --- | --- | --- | --- |
| electron-builder 26.17.0 → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js (DoS via unbounded precision) | moderate | build machine only, while downloading Electron; no fixed sprintf-js release | re-check at each electron-builder update; review by 2027-01-31 |

The audit's suggested fix (`electron-builder@26.5.0`, a downgrade) reintroduces the high
app-builder-lib/tar advisories and is not applied. Never use `npm audit fix --force`.

## Native engines (bin/, not npm)

Pinned in `scripts/engines.lock.json` (exact URL + SHA-256 of each download) from the Windows payload
CI run that tested them (run 38609375299); every bundled file is in `bin-manifest.json` (12,530 files).

| Engine | Version | Download SHA-256 | Chosen because |
| --- | --- | --- | --- |
| FFmpeg (gyan.dev essentials) | 9.0.2 | `60f46726…2047ba` | newest release at least 14 days old; permanent versioned URL; has libx264, libvpx-vp9, libopus, libmp3lame, libvorbis (probed) |
| 7-Zip | 26.03 | `c0680064…513926` | 26.04 was 9 days old |
| Poppler (Windows build) | 26.09.0-0 | `7a6f256a…56c8d0` | newest release at least 14 days old |
| LibreOffice | 26.2.6.3 | `f9877032…fb2660` | current "still" branch (26.2.6 = build 26.2.6.3); permanent archive URL |
| Calibre | 9.15.0 | `0f96ae06…800853` | 9.16 was 5 days old; hash also computed independently outside CI |

Versions are reported at runtime by the ToolRegistry probe (`tools:status` → `details`); the packaged
app's are in `resources/bin/ENGINES.json`. Linux CI uses the distribution's engines (ffmpeg 6.1,
Poppler 24.02, LibreOffice 24.2, Calibre 7.6, 7-Zip 23.01); those are not the shipped versions.
