# Morph

Windows file converter with a Hebrew, right-to-left interface. Drop any file: Morph detects what it really is (by content, not just the extension) and offers only the formats it can become.

## Install

Download `Morph-Setup-x.y.z.exe` from the [latest release](https://github.com/OrMeirDev/Morph/releases/latest) and run it. Installed copies update themselves: when a new release is published, Morph shows an "update available" bar, and the update installs silently with a restart.

The installer is not code-signed, so Windows SmartScreen warns on first run: click **More info → Run anyway**.

Conversions run on your computer, offline. On Windows, Morph limits what its conversion engines
can do, in layers (details and gaps: `docs/ARCHITECTURE.md`, D2):

- Every engine runs in a Windows job: Stop, closing Morph or Morph crashing ends all of its
  processes, and each job has memory and process-count limits.
- ffmpeg, 7-Zip, Poppler and the image engine (sharp) work on a copy of your file in a private
  folder and run in an AppContainer with no network; Windows only lets them reach the folders
  Morph grants. This relies on file permissions, so it does not cover FAT32/exFAT drives (many USB
  sticks), which have none.
- LibreOffice and Calibre run at Low integrity: Windows refuses their writes to your normal files,
  but they can still read your files and use the network.
- File-type detection runs in the same kind of AppContainer and never opens your file itself:
  Morph hands it only the bytes it asks for.

## What it converts

| Drop a… | Get |
|---|---|
| Video (MP4, MOV, MKV, AVI, WEBM…) | MP4, MOV, MKV, WEBM, AVI, MP3, M4A, WAV, OGG, FLAC, GIF, APNG |
| Audio (MP3, WAV, M4A, FLAC, OGG…) | MP3, M4A, WAV, OGG, FLAC, OPUS, AAC |
| Image (JPG, PNG, WEBP, HEIC, AVIF, BMP, TIFF…) | JPG, PNG, WEBP, AVIF, TIFF, BMP, ICO, GIF, PDF, SVG |
| Animated GIF / APNG | MP4, WEBM, APNG/GIF, PNG |
| SVG | PNG, JPG, WEBP, PDF |
| PDF | Word, JPG, PNG, EPUB, text |
| Word / ODT / RTF / text | PDF, Word, ODT, RTF, text, EPUB |
| Excel / ODS / CSV | PDF, Excel, ODS, CSV |
| PowerPoint / ODP | PDF, PowerPoint, ODP |
| E-book (EPUB, MOBI, AZW3) | PDF, EPUB, MOBI, AZW3, Word, text |
| Archive (ZIP, 7Z, RAR, TAR, TAR.GZ) | ZIP, 7Z, TAR, TAR.GZ |

Only conversions whose engine is installed and passed its startup check are offered. The full matrix, with what each direction changes and which are covered by tests, is in [docs/FORMATS.md](docs/FORMATS.md).

Plus a unit converter (length, weight, temperature, volume, area incl. dunam, speed, data size with decimal KB and binary KiB, time) and a world clock that says when a chosen time falls in a daylight-saving gap or happens twice.

Per-row "convert only this" and "convert all", a per-kind shortcut ("convert all images to JPG"), history, and a fixed-frame window that never needs page scrolling.

## Develop

```bash
npm install
npm run fetch-bin   # Windows: the pinned, hash-checked ffmpeg, 7-Zip, Poppler, LibreOffice and Calibre into bin/ (scripts/engines.lock.json)
npm run dev         # app with hot reload
npm run check       # module-boundary rules, all tests (incl. the real engines found), build
npm run e2e:flow    # the conversion flow in a real Electron window
npm run dist        # build the installer into release/ (refuses a bin/ that does not match bin-manifest.json)
npm run release     # build and publish a GitHub release (needs GH_TOKEN)
```

Read [AGENTS.md](AGENTS.md) before changing code: layers, rules and checks. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); tests and the pending Windows checks: [docs/TESTING.md](docs/TESTING.md); releasing: [docs/RELEASING.md](docs/RELEASING.md).

## Notes

- Conversions are not all lossless. Each direction says what changes (e.g. only the first frame, text only, the first sheet of a spreadsheet, a traced approximation for image → SVG); the app shows a note next to the file when it matters.
- PDF → Word goes through LibreOffice's PDF import, which rebuilds the layout. In Morph's tests simple text pages convert; complex layouts, tables and fonts are not yet covered by tests and may come out approximate.
- Originals are never changed or overwritten. A new file gets a free name (`name (1).ext`), and a stopped or failed conversion leaves no file behind.
- RAR archives can be opened and converted to other formats, but not created (7-Zip/unRAR license).

## Licenses

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bundled tools (FFmpeg, LibreOffice, Calibre, Poppler, 7-Zip).
