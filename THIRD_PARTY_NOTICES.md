# Third-party software bundled with Morph

Morph's installer includes the following programs, unmodified, in `resources/bin`.
Each is distributed under its own license.

## FFmpeg (bin/ffmpeg)
- License: GNU General Public License v3 (a "GPL" build).
- Build used: https://github.com/yt-dlp/FFmpeg-Builds
- Source code: https://github.com/FFmpeg/FFmpeg and https://ffmpeg.org/download.html

## LibreOffice (bin/libreoffice)
- License: Mozilla Public License 2.0 (with parts under other open-source licenses, listed in
  `bin/libreoffice/license.txt` / `readmes`).
- Project and source: https://www.libreoffice.org/ and https://git.libreoffice.org/

## Calibre (bin/calibre)
- License: GNU General Public License v3.
- Project and source: https://calibre-ebook.com/ and https://github.com/kovidgoyal/calibre

## Poppler (bin/poppler)
- License: GNU General Public License v2 or later.
- Windows build: https://github.com/oschwartz10612/poppler-windows
- Source: https://poppler.freedesktop.org/

## 7-Zip (bin/7zip)
- License: GNU LGPL, with the unRAR restriction (RAR files can be extracted but not created).
  See `bin/7zip/License.txt`.
- Project and source: https://www.7-zip.org/

The exact versions and SHA-256 of every bundled engine file are listed in `bin-manifest.json` for
each release (see docs/RELEASING.md).

## npm packages
- sharp 0.35 / libvips 8.18 (Apache-2.0, LGPL-3.0 for libvips), heic-convert and libheif-js
  (ISC / LGPL-3.0), pdf-lib (MIT), imagetracerjs (Unlicense), file-type (MIT), electron-updater
  (MIT), Electron 44 (MIT, with Chromium's licenses in LICENSES.chromium.html), React (MIT),
  lucide-react (ISC). See each package in node_modules for full terms.
