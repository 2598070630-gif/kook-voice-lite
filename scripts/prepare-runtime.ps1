$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $projectRoot 'src-tauri\resources'
$playwright = Join-Path $projectRoot 'node_modules\playwright-core'
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath "$playwright\package.json")) {
  throw 'Run npm ci in the project root first.'
}
if ((& $node -p 'process.platform + "/" + process.arch') -ne 'win32/x64') {
  throw 'Use Windows x64 Node.js to prepare Windows x64 release resources.'
}

New-Item -ItemType Directory -Force -Path "$resources\node_modules", "$resources\licenses" | Out-Null
Copy-Item -LiteralPath $node -Destination "$resources\node.exe" -Force
Copy-Item -LiteralPath $playwright -Destination "$resources\node_modules" -Recurse -Force
$version = & $node --version
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$version/LICENSE" -OutFile "$resources\licenses\Node-LICENSE.txt"
Push-Location $projectRoot
try {
  $packages = & npm.cmd ls --omit=dev --all --parseable
  if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate locked production dependencies.' }
  foreach ($package in $packages) {
    if ($package -eq $projectRoot) { continue }
    $relative = $package.Substring($projectRoot.Length + 1)
    $destination = Join-Path "$resources\licenses\npm" $relative
    $notices = Get-ChildItem -LiteralPath $package -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE|ThirdPartyNotices)' }
    if ($notices) {
      New-Item -ItemType Directory -Path $destination -Force | Out-Null
      $notices | Copy-Item -Destination $destination -Force
    }
  }
} finally { Pop-Location }
Write-Output "Prepared Node $version and locked playwright-core in src-tauri/resources."
