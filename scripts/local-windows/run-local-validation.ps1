# Local Windows validation of Morph, run WITHOUT elevation (docs/LOCAL-WINDOWS-VALIDATION.he.md).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-windows\run-local-validation.ps1
#       [-AppExe <path to win-unpacked\Morph.exe>]   test this packaged app (default: build one)
#       [-SkipTests] [-SkipBuild] [-Out <folder>]
#
# Everything runs in the caller's own, unelevated token. Nothing here creates accounts, changes
# group membership, firewall, Defender, UAC or machine policy, installs Morph, or touches the
# user's Morph settings and history: the app runs with APPDATA/LOCALAPPDATA/TEMP under the output
# folder. FAT32/exFAT/SMB publication tests need administrator-made volumes and are skipped here.
param([string]$AppExe = '', [switch]$SkipTests, [switch]$SkipBuild, [string]$Out = '')
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $Repo
if (-not $Out) { $Out = Join-Path $Repo ("test-results\local-windows\run-" + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
New-Item -ItemType Directory -Force $Out | Out-Null

$ctx = & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\context.ps1" -Out (Join-Path $Out 'context.json') | ConvertFrom-Json
Write-Host "account: $($ctx.account.name)  kind: $($ctx.account.kind)  elevation: $($ctx.account.tokenElevationType)  integrity: $($ctx.account.integrityLevel)"
if ($ctx.account.tokenElevated) {
  Write-Host 'This PowerShell is elevated. The validation must run unelevated: open a normal (not "Run as administrator") PowerShell, or from this one run:'
  Write-Host "  runas /trustlevel:0x20000 `"powershell -NoExit -ExecutionPolicy Bypass -File \`"$PSCommandPath\`"`""
  exit 2
}

function Step($name, [scriptblock]$body) {
  Write-Host "=== $name"
  $log = Join-Path $Out ("$name.log")
  $t0 = Get-Date
  & $body *>&1 | Tee-Object -FilePath $log | Out-Host
  $code = $LASTEXITCODE
  "{0,-28} exit {1}  {2:N0} s" -f $name, $code, ((Get-Date) - $t0).TotalSeconds | Add-Content (Join-Path $Out 'steps.txt')
  return $code
}

$failed = @()
if (-not (Test-Path node_modules)) { if ((Step 'npm-ci' { npm ci --ignore-scripts --no-fund --no-audit }) -ne 0) { $failed += 'npm-ci' } }
if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) { Step 'electron-binary' { node node_modules/electron/install.js } | Out-Null }
if (-not (Test-Path bin\calibre)) { if ((Step 'fetch-engines' { node scripts/fetch-engines.cjs --require-pinned }) -ne 0) { $failed += 'fetch-engines' } }
if ((Step 'bin-verify-before' { node scripts/bin-manifest.cjs verify }) -ne 0) { $failed += 'bin-verify-before' }
if (-not (Test-Path native\out\morph-confine.exe)) { if ((Step 'build-helper' { node native/confine/build.cjs }) -ne 0) { $failed += 'build-helper' } }

if (-not $SkipTests) {
  # From PowerShell, the context Morph itself starts from (the default DACL differs from Git Bash).
  if ((Step 'confine-diagnose' { node scripts/confine-diagnose.cjs --out (Join-Path $Out 'confine-diagnose.json') --strict }) -ne 0) { $failed += 'confine-diagnose' }
  if ((Step 'npm-test' { npm test }) -ne 0) { $failed += 'npm-test' }
  if ((Step 'bin-verify-after' { node scripts/bin-manifest.cjs verify }) -ne 0) { $failed += 'bin-verify-after' }
}

if (-not $AppExe) {
  $AppExe = Join-Path $Repo 'release\win-unpacked\Morph.exe'
  if (-not $SkipBuild) {
    if ((Step 'build-app' { npx vite build; if ($LASTEXITCODE -eq 0) { npx electron-builder --win dir --x64 --publish never '-c.extraMetadata.version=1.0.4-local' } }) -ne 0) { $failed += 'build-app' }
  }
}
if ((Step 'packaged-smoke' { node e2e/packaged-smoke.cjs $AppExe --report (Join-Path $Out 'smoke.json') }) -ne 0) { $failed += 'packaged-smoke' }
if ((Step 'local-windows-check' { node e2e/local-windows-check.cjs $AppExe --report (Join-Path $Out 'local-check.json') }) -ne 0) { $failed += 'local-windows-check' }

Write-Host ''
Get-Content (Join-Path $Out 'steps.txt')
if ($failed.Count) { Write-Host "FAILED: $($failed -join ', ')  (logs in $Out)"; exit 1 }
Write-Host "all steps passed  (account kind: $($ctx.account.kind); evidence in $Out)"
