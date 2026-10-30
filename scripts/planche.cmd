@echo off
rem Planche launcher: starts the local server (if needed) and opens the browser.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8787
set URL=http://localhost:%PORT%
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%URL%/api/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)
title Planche - %URL% (fermez cette fenetre pour arreter)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"
node server\server.mjs
