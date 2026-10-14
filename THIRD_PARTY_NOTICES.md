# Third-party software bundled with Morph

Morph's installer includes the following programs, unmodified, in `resources/bin`. Each is
distributed under its own license. Exact download URLs and SHA-256 hashes are in
`scripts/engines.lock.json`; every bundled file is listed with its SHA-256 in `bin-manifest.json`, and
the installed copy carries `resources/bin/ENGINES.json`.

| Engine | Version | Folder | License | Binary source | Source code |
| --- | --- | --- | --- | --- | --- |
| FFmpeg (essentials build by gyan.dev) | 9.0.2 | `bin/ffmpeg` | GPL-3.0-or-later (GPL build) | https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2 | https://ffmpeg.org/download.html |
| 7-Zip | 26.03 | `bin/7zip` | GNU LGPL-2.1-or-later with the unRAR restriction; parts BSD-3-Clause (`bin/7zip/License.txt`) | https://github.com/ip7z/7zip/releases/tag/26.03 | https://www.7-zip.org/download.html |
| Poppler (Windows build by oschwartz10612) | 26.09.0 (package 26.09.0-0) | `bin/poppler` | GPL-2.0-or-later | https://github.com/oschwartz10612/poppler-windows/releases/tag/v26.09.0-0 | https://poppler.freedesktop.org/ |
| LibreOffice | 26.2.6.3 | `bin/libreoffice` | MPL-2.0, with parts under other open-source licenses (`bin/libreoffice/license.txt`, `readmes`) | https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.6.3/ | https://git.libreoffice.org/core/+/refs/tags/libreoffice-26.2.6.3 |
| Calibre | 9.15.0 | `bin/calibre` | GPL-3.0 | https://download.calibre-ebook.com/9.15.0/ | https://github.com/kovidgoyal/calibre/tree/v9.15.0 |

LibreOffice is bundled trimmed: the bundled extensions (spelling dictionaries) and the user-interface
languages other than English and Hebrew are left out (`trimLibreOffice` in
`scripts/fetch-engines.cjs`); no file is modified.

RAR archives can be extracted but not created (unRAR license restriction).

Morph runs these programs as separate processes; it does not link to them. The GPL/LGPL components'
corresponding source is available from the links above; whether a release must also ship or host a
copy of that source is part of the release checklist (docs/RELEASING.md) and is not a legal opinion.

## npm packages

- sharp 0.35 / libvips 8.18 (Apache-2.0, LGPL-3.0 for libvips), heic-convert and libheif-js
  (ISC / LGPL-3.0), pdf-lib (MIT), imagetracerjs (Unlicense), file-type (MIT), electron-updater
  (MIT), Electron 44 (MIT, with Chromium's licenses in LICENSES.chromium.html), React (MIT),
  lucide-react (ISC). See each package in node_modules for full terms.
