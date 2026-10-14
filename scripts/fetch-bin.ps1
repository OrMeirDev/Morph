# Downloads the conversion tools Morph bundles into bin/ (not committed to git: far too large).
#   bin/ffmpeg       ffmpeg.exe, ffprobe.exe      video, audio, GIF
#   bin/7zip         7z.exe, 7z.dll               archives (incl. RAR extraction)
#   bin/poppler      pdftoppm.exe + DLLs          PDF -> images
#   bin/libreoffice  LibreOffice program files    Word/Office <-> PDF
#   bin/calibre      Calibre program files        e-books (EPUB, MOBI, AZW3 <-> PDF)
# MSI packages are unpacked with an administrative extract (msiexec /a), which copies the files
# without installing anything on this computer.
#
# Reproducible payloads: set exact versions in $Pins below (winget package versions; the URL of a
# dated FFmpeg-Builds zip; a poppler-windows release tag). With -RequirePinned the script refuses
# to fetch anything unpinned. Afterwards run `npm run bin:verify` (or `npm run bin:record` for a new,
# tested payload): packaging refuses a bin/ that does not match bin-manifest.json.
param([switch]$RequirePinned)
$ErrorActionPreference = 'Stop'

# $null = latest (prints a warning). Fill these in from a tested build before a release.
$Pins = @{
    'ffmpeg'                            = $null   # full URL of a dated FFmpeg-Builds win64-gpl zip
    'poppler'                           = $null   # poppler-windows release tag, e.g. 'v24.08.0-0'
    '7zip.7zip'                         = $null   # winget version
    'TheDocumentFoundation.LibreOffice' = $null   # winget version
    'calibre.calibre'                   = $null   # winget version
}
function Pin($key) {
    $v = $Pins[$key]
    if (-not $v) {
        if ($RequirePinned) { throw "No pinned version for $key (remove -RequirePinned or set `$Pins['$key'])" }
        Write-Warning "$key is not pinned: fetching the latest release"
    }
    return $v
}
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('morph-bin-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $bin, $tmp | Out-Null

function Step($msg) { Write-Host "== $msg" }
function Get-File($url, $out) { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }
function Expand-Msi($msi, $dest) {
    $p = Start-Process msiexec.exe -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$dest`"") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "msiexec /a failed ($($p.ExitCode)) for $msi" }
}
function Get-WingetMsi($id, $dir) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    # No --installer-type filter: these packages list their MSI as type "wix", not "msi".
    $version = Pin $id
    $versionArgs = @()
    if ($version) { $versionArgs = @('--version', $version) }
    winget download --id $id -e @versionArgs --architecture x64 --download-directory $dir --accept-source-agreements --accept-package-agreements | Out-Null
    $msi = Get-ChildItem $dir -Filter *.msi | Select-Object -First 1
    if (-not $msi) { throw "winget did not download an MSI for $id" }
    return $msi.FullName
}
function Has($sub, $exe) { Test-Path (Join-Path (Join-Path $bin $sub) $exe) }
function Replace-Dir($from, $to) {
    if (Test-Path $to) { Remove-Item -Recurse -Force $to }
    Move-Item $from $to
}

if (-not (Has 'ffmpeg' 'ffmpeg.exe')) {
Step 'ffmpeg'
$ffZip = Join-Path $tmp 'ffmpeg.zip'
$ffUrl = Pin 'ffmpeg'
if (-not $ffUrl) { $ffUrl = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' }
Get-File $ffUrl $ffZip
Expand-Archive $ffZip -DestinationPath (Join-Path $tmp 'ffmpeg')
New-Item -ItemType Directory -Force (Join-Path $bin 'ffmpeg') | Out-Null
Get-ChildItem (Join-Path $tmp 'ffmpeg') -Recurse -Include 'ffmpeg.exe', 'ffprobe.exe' | Copy-Item -Destination (Join-Path $bin 'ffmpeg') -Force
}

if (-not (Has '7zip' '7z.exe')) {
Step '7-Zip'
$msi = Get-WingetMsi '7zip.7zip' (Join-Path $tmp 'dl-7zip')
Expand-Msi $msi (Join-Path $tmp '7zip')
$sevenExe = Get-ChildItem (Join-Path $tmp '7zip') -Recurse -Filter 7z.exe | Select-Object -First 1
New-Item -ItemType Directory -Force (Join-Path $bin '7zip') | Out-Null
Copy-Item (Join-Path $sevenExe.DirectoryName '7z.exe'), (Join-Path $sevenExe.DirectoryName '7z.dll'), (Join-Path $sevenExe.DirectoryName 'License.txt') (Join-Path $bin '7zip') -Force
}

if (-not (Has 'poppler' 'pdftoppm.exe')) {
Step 'Poppler'
$popDir = Join-Path $tmp 'poppler'
$popTag = Pin 'poppler'
$popTagArgs = @()
if ($popTag) { $popTagArgs = @($popTag) }
gh release download @popTagArgs --repo oschwartz10612/poppler-windows --pattern 'Release-*.zip' --dir $popDir
Expand-Archive (Get-ChildItem $popDir -Filter *.zip | Select-Object -First 1).FullName -DestinationPath (Join-Path $popDir 'x')
$pdftoppm = Get-ChildItem (Join-Path $popDir 'x') -Recurse -Filter pdftoppm.exe | Select-Object -First 1
Replace-Dir $pdftoppm.DirectoryName (Join-Path $bin 'poppler')
}

if (-not (Has 'libreoffice\program' 'soffice.exe')) {
Step 'LibreOffice'
$msi = Get-WingetMsi 'TheDocumentFoundation.LibreOffice' (Join-Path $tmp 'dl-lo')
Expand-Msi $msi (Join-Path $tmp 'lo')
$soffice = Get-ChildItem (Join-Path $tmp 'lo') -Recurse -Filter soffice.exe | Select-Object -First 1
Replace-Dir (Split-Path $soffice.DirectoryName -Parent) (Join-Path $bin 'libreoffice')
# Bundled extensions are ~600 MB of spelling dictionaries; Morph doesn't need them, and their first-start
# registration is what intermittently left half-built profiles that convert nothing.
$loExt = Join-Path $bin 'libreoffice\share\extensions'
if (Test-Path $loExt) { Remove-Item -Recurse -Force $loExt; New-Item -ItemType Directory -Force $loExt | Out-Null }
# Headless conversion shows no UI: keep only the English (built in) and Hebrew UI languages and the
# default icon theme. Cuts ~420 MB; the full conversion test passes 88/88 on the trimmed build.
$lo = Join-Path $bin 'libreoffice'
Get-ChildItem "$lo\program\resource" -Directory | Where-Object { $_.Name -notin @('common', 'he') } | Remove-Item -Recurse -Force
Get-ChildItem "$lo\share\registry\res" -File | Where-Object { $_.Name -notmatch '_(en-US|he)\.xcd$' } | Remove-Item -Force
Get-ChildItem "$lo\share\registry" -File -Filter 'Langpack-*.xcd' | Where-Object { $_.Name -notin @('Langpack-en-US.xcd', 'Langpack-he.xcd') } | Remove-Item -Force
Get-ChildItem "$lo\share\config" -File -Filter 'images_*.zip' | Where-Object { $_.Name -ne 'images_colibre.zip' } | Remove-Item -Force
}

if (-not (Has 'calibre' 'ebook-convert.exe')) {
Step 'Calibre'
$msi = Get-WingetMsi 'calibre.calibre' (Join-Path $tmp 'dl-calibre')
Expand-Msi $msi (Join-Path $tmp 'calibre')
$ebook = Get-ChildItem (Join-Path $tmp 'calibre') -Recurse -Filter ebook-convert.exe | Select-Object -First 1
Replace-Dir $ebook.DirectoryName (Join-Path $bin 'calibre')
}

Remove-Item -Recurse -Force $tmp
Step 'done'
Write-Host 'Next: npm test (engine matrix), then npm run bin:verify, or npm run bin:record for a new tested payload.'
Get-ChildItem $bin -Directory | ForEach-Object {
    $mb = (Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    '{0,-12} {1,8:N0} MB' -f $_.Name, $mb
}
