param([string]$SevenZip = '', [string]$SfxModule = '')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$releaseDir = Join-Path $root 'releases'
$portableDir = Join-Path $root 'portable'
if (-not $SevenZip) {
  $command = Get-Command 7z.exe -ErrorAction SilentlyContinue
  $SevenZip = if ($command) { $command.Source } else { Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
}
if (-not $SfxModule) { $SfxModule = Join-Path (Split-Path -Parent $SevenZip) '7z.sfx' }
if (-not (Test-Path $sevenZip)) { throw "7-Zip not found: $sevenZip" }
if (-not (Test-Path $sfxModule)) { throw "7z.sfx not found: $sfxModule" }
$files = @('kook_voice_lite.exe', 'WebView2Loader.dll', 'README.txt', 'resources')
foreach ($name in $files) {
  if (-not (Test-Path (Join-Path $portableDir $name))) { throw "Missing portable file: $name" }
}
foreach ($name in @('node.exe', 'playwright-extract-voice.mjs', 'run-playwright-extractor.cmd')) {
  if (-not (Test-Path (Join-Path $portableDir "resources\$name"))) { throw "Missing Playwright resource: $name" }
}
foreach ($name in @('native\host.mjs', 'node_modules\@roamhq\wrtc-win32-x64\wrtc.node', 'node_modules\audify\build\Release\audify.node')) {
  if (-not (Test-Path (Join-Path $portableDir "resources\$name"))) { throw "Missing native voice resource: $name" }
}

# Build in a fresh directory, validate, then replace the published files.
$stage = Join-Path $releaseDir ('.package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null
$zip = Join-Path $stage 'kook-voice-lite-portable-win64.zip'
$sfx = Join-Path $stage 'KOOK-Voice-Lite-portable.exe'
Push-Location $portableDir
try {
  & $sevenZip a -tzip -mx=7 -bsp0 $zip @files | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ZIP creation failed.' }
  # Standard extraction-only SFX. No installer config or RunProgram command.
  & $sevenZip a -t7z -mx=7 -bsp0 "-sfx$sfxModule" $sfx @files | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'SFX creation failed.' }
  $header = [IO.File]::ReadAllBytes($sfx)
  if ($header[0] -ne 0x4d -or $header[1] -ne 0x5a) { throw 'SFX has no valid MZ header.' }
  foreach ($archive in @($zip, $sfx)) {
    & $sevenZip t -bsp0 $archive | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Archive validation failed: $archive" }
  }
  foreach ($archive in @($zip, $sfx)) {
    Move-Item -LiteralPath $archive -Destination (Join-Path $releaseDir (Split-Path $archive -Leaf)) -Force
  }
}
finally { Pop-Location }
Get-Item (Join-Path $releaseDir 'kook-voice-lite-portable-win64.zip'), (Join-Path $releaseDir 'KOOK-Voice-Lite-portable.exe') | Select-Object FullName,Length
