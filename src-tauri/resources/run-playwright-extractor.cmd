@echo off
setlocal
cd /d "%~dp0.."
"%~dp0node.exe" "%~dp0playwright-extract-voice.mjs" %*
endlocal
