@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0copy-edge-extractor.ps1"
pause
