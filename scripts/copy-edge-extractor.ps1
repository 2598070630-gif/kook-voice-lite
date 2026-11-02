$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'edge-extract-voice.js'
Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8 | Set-Clipboard
Write-Host 'KOOK voice extraction script v2 copied.' -ForegroundColor Green
Write-Host '1. Open your signed-in KOOK web tab in Edge: https://www.kookapp.cn/app/'
Write-Host '2. Refresh the KOOK tab, press F12, choose Console, paste, and press Enter.'
Write-Host '3. Manually leave and rejoin the target voice channel to capture its request.'
Write-Host '4. Import that JSON in KOOK Voice Lite using the Edge import button.'
Write-Host 'If Edge blocks pasting, use its displayed verification prompt manually.'
Write-Host 'No browser restart, extra packages, or Windows installation registration.'
Write-Host 'If extraction fails, use the panel diagnostic button. Do not share voice tokens.'
