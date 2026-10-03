@echo off
setlocal
cd /d "%~dp0"

rem Starts the local dev server (server.mjs) and opens it in the browser.
rem Reads optional settings (PORT, STREAM_PROXY_SECRET) from .env.local.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required but was not found on PATH.
  echo Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if exist ".env.local" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env.local") do set "%%A=%%B"
)
if not defined PORT set "PORT=3000"

echo.
echo   Greek TV ^& Radio  -  http://localhost:%PORT%
echo   Press Ctrl+C to stop.
echo.

start "" "http://localhost:%PORT%"
node server.mjs

pause
endlocal
