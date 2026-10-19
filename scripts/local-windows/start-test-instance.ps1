# Starts the packaged Morph as an isolated test instance for the manual desktop checks (drag and
# drop from Explorer, USB copies): its own APPDATA, LOCALAPPDATA and TEMP under -Root, so the
# everyday Morph's settings and history are never touched. Opens Explorer on a folder of test
# copies (Hebrew names, spaces) to drag from.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-windows\start-test-instance.ps1
#       [-AppExe <win-unpacked\Morph.exe>] [-Root <folder>]
param([string]$AppExe = '', [string]$Root = '')
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
if (-not $AppExe) { $AppExe = Join-Path $Repo 'release\win-unpacked\Morph.exe' }
if (-not $Root) { $Root = Join-Path $env:TEMP 'morph-desktop-check' }
$files = Join-Path $Root 'בדיקות מורף'
foreach ($d in 'appdata', 'localappdata', 'tmp') { New-Item -ItemType Directory -Force (Join-Path $Root $d) | Out-Null }
New-Item -ItemType Directory -Force $files | Out-Null
$corpus = Join-Path $Repo 'test\corpus'
$copies = @{ 'שיר בעברית.docx' = 'benyehuda-5452-ani-maamin.docx'; 'ספר.epub' = 'gutenberg-11-alice.epub'; 'טופס.pdf' = 'irs-form-w9-2024.pdf'; 'גיליון נתונים.xlsx' = 'census-nst-est2024-pop.xlsx' }
foreach ($k in $copies.Keys) { $to = Join-Path $files $k; if (-not (Test-Path $to)) { Copy-Item (Join-Path $corpus $copies[$k]) $to } }
New-Item -ItemType Directory -Force (Join-Path $files 'תיקייה לגרירה') | Out-Null
Get-ChildItem $files -File | Get-FileHash -Algorithm SHA256 | Select-Object @{n='file';e={Split-Path $_.Path -Leaf}}, Hash | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Root 'hashes-before.json')

$env:APPDATA = Join-Path $Root 'appdata'; $env:LOCALAPPDATA = Join-Path $Root 'localappdata'; $env:TEMP = Join-Path $Root 'tmp'; $env:TMP = $env:TEMP
$p = Start-Process -FilePath $AppExe -PassThru
Start-Process explorer.exe -ArgumentList "`"$files`""
"test instance pid $($p.Id); profile $Root; drag files from: $files"
