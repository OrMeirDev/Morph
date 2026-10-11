# Morph

Windows file converter with a Hebrew, right-to-left interface. Drop any file: Morph detects what it really is (by content, not just the extension) and offers only the formats it can become.

## Install

Download `Morph-Setup-x.y.z.exe` from the [latest release](https://github.com/OrMeirDev/Morph/releases/latest) and run it. Installed copies update themselves: when a new release is published, Morph shows an "update available" bar, and the update installs silently with a restart.

The installer is not code-signed, so Windows SmartScreen warns on first run: click **More info → Run anyway**.

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

Plus a unit converter (length, weight, temperature, volume, area incl. dunam, speed, data size, time) and a world clock.

Per-row "convert only this" and "convert all", a per-kind shortcut ("convert all images to JPG"), history, and a fixed-frame window that never needs page scrolling.

## Develop

```bash
npm install
npm run fetch-bin   # downloads ffmpeg, 7-Zip, Poppler, LibreOffice and Calibre into bin/ (not in git: too large)
npm run dev         # app with hot reload
npm run dist        # build the installer into release/
npm run release     # build and publish a GitHub release (needs GH_TOKEN)
```

To publish an update: bump `version` in `package.json`, then run `npm run release`.

## Notes

- PDF → Word goes through LibreOffice's PDF import. Plain text documents convert well; complex layouts and tables come out approximate (true of every PDF-to-Word tool).
- RAR archives can be opened and converted to other formats, but not created (7-Zip/unRAR license).

## Licenses

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bundled tools (FFmpeg, LibreOffice, Calibre, Poppler, 7-Zip).
