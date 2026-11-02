param([string]$Dependencies = (Join-Path $PSScriptRoot 'build-deps'))
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
& (Join-Path $projectRoot 'scripts\prepare-runtime.ps1')
$nodeDirectory = Split-Path -Parent (Get-Command node -ErrorAction Stop).Source
$dependenciesRoot = (Resolve-Path -LiteralPath $Dependencies).Path
if (-not $dependenciesRoot.StartsWith("$projectRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Put build-deps inside the project directory before building.'
}
$dependenciesRelative = $dependenciesRoot.Substring($projectRoot.Length + 1)

# windres requires a path without spaces. Use a free temporary drive letter.
$drive = @('Z:', 'Y:', 'X:', 'W:', 'V:', 'U:') | Where-Object { -not (Test-Path "$_\") } | Select-Object -First 1
if (-not $drive) { throw 'No free drive letter is available.' }
subst $drive $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not create temporary build drive.' }
$environmentNames = @('Path', 'CARGO_HOME', 'RUSTC', 'RUSTDOC', 'CARGO_NET_OFFLINE', 'CARGO_TARGET_DIR', 'CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER')
$saved = @{}
foreach ($name in $environmentNames) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location "$drive\"
try {
  $kit = "$drive\$dependenciesRelative"
  $env:CARGO_HOME = "$kit\cargo"
  $env:RUSTC = "$kit\rust\bin\rustc.exe"
  $env:CARGO_NET_OFFLINE = 'true'
  $env:CARGO_TARGET_DIR = "$drive\src-tauri\target"
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "$kit\mingw\bin\gcc.exe"
  # Use only this toolchain plus Node and Windows tools; never fall back to a global MinGW.
  $env:Path = "$kit\rust\bin;$kit\mingw\bin;$nodeDirectory;$env:SystemRoot\System32;$env:SystemRoot"

  & "$kit\rust\bin\rustc.exe" --version
  if ($LASTEXITCODE -ne 0) { throw 'Portable Rust compiler could not start.' }
  & npm.cmd run tauri -- build --no-bundle --features custom-protocol
  if ($LASTEXITCODE -ne 0) { throw 'Compilation failed. The previous portable output was preserved.' }

  $portable = Join-Path $projectRoot 'portable'
  New-Item -ItemType Directory -Force $portable | Out-Null
  $resourceSource = "$drive\src-tauri\resources"
  $portableResources = Join-Path $portable 'resources'
  foreach ($name in @('node.exe', 'playwright-extract-voice.mjs', 'run-playwright-extractor.cmd', 'licenses')) {
    if (-not (Test-Path "$resourceSource\$name")) { throw "Missing Playwright resource: $name" }
  }
  if (-not (Test-Path "$resourceSource\node_modules\playwright-core")) {
    throw 'Missing Playwright resource: node_modules\playwright-core'
  }
  if (Test-Path $portableResources) { Remove-Item -LiteralPath $portableResources -Recurse -Force }
  New-Item -ItemType Directory -Force $portableResources | Out-Null
  Copy-Item "$resourceSource\node.exe" "$portableResources\node.exe.next" -Force
  Move-Item "$portableResources\node.exe.next" "$portableResources\node.exe" -Force
  Copy-Item "$resourceSource\playwright-extract-voice.mjs" "$portableResources\playwright-extract-voice.mjs.next" -Force
  Move-Item "$portableResources\playwright-extract-voice.mjs.next" "$portableResources\playwright-extract-voice.mjs" -Force
  Copy-Item "$resourceSource\run-playwright-extractor.cmd" "$portableResources\run-playwright-extractor.cmd.next" -Force
  Move-Item "$portableResources\run-playwright-extractor.cmd.next" "$portableResources\run-playwright-extractor.cmd" -Force
  Copy-Item "$resourceSource\node_modules" "$portableResources\node_modules.next" -Recurse -Force
  Move-Item "$portableResources\node_modules.next" "$portableResources\node_modules" -Force
  Copy-Item -LiteralPath "$resourceSource\licenses" -Destination $portableResources -Recurse -Force
  $release = "$drive\src-tauri\target\release"
  foreach ($name in @('kook_voice_lite.exe', 'WebView2Loader.dll')) {
    if (-not (Test-Path "$release\$name")) { throw "Missing output: $name" }
    Copy-Item "$release\$name" "$portable\$name.next" -Force
    Move-Item "$portable\$name.next" "$portable\$name" -Force
  }
  @'
KOOK Voice Lite - portable (Windows x64)

Keep kook_voice_lite.exe, WebView2Loader.dll and the resources directory together,
then run the exe. Uses the system WebView2 Evergreen Runtime. No Rust, MinGW or
development server is needed to run this application.

Use the “使用playwright调用” button to start the bundled extractor with the
system Microsoft Edge. Sign in and rejoin the target voice channel in Edge.
On success, the captured configuration is imported automatically; click Join
to connect. Progress and errors appear in the diagnostics page.
Real-channel voice operation and credential reuse still need validation.
Do not share exported credentials.

Login state: playwright-profile (next to the exe).
Configuration, diagnostics and logs: captures (next to the exe).
Window size and maximized state: window-state.json (next to the exe).
Use a writable directory. Window size is saved when hiding or exiting.
Successful join hides the window to the system tray. Right-click its icon for:
show/hide window; connection, devices and diagnostics pages; microphone mute;
headphone mute; disconnect; Playwright extraction; open captures/program folder;
exit. Voice controls are disabled while disconnected; mute checks match the UI.
'@ | Set-Content -Encoding utf8 "$portable\README.txt.next"
  Move-Item "$portable\README.txt.next" "$portable\README.txt" -Force
  Get-ChildItem $portable -File | Select-Object Name,Length
}
finally {
  Pop-Location
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  subst $drive /d
}
