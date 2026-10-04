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

rem First run: create a STREAM_PROXY_SECRET so cross-host streams relay too.
if not defined STREAM_PROXY_SECRET (
  for /f "usebackq delims=" %%S in (`node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"`) do set "STREAM_PROXY_SECRET=%%S"
  call :save_secret
)

echo.
echo   Greek TV ^& Radio  -  http://localhost:%PORT%
for /f "usebackq delims=" %%U in (`node -e "for (const a of Object.values(require('os').networkInterfaces()).flat()) if (a.family==='IPv4' && !a.internal) console.log('http://'+a.address+':%PORT%')"`) do echo   Phone / TV on the same Wi-Fi  -  %%U
echo   Press Ctrl+C to stop.
echo.

rem Open the browser only once the server answers, or it lands on an error page.
start "" /b powershell -NoProfile -Command "$u='http://localhost:%PORT%'; for($i=0;$i -lt 60;$i++){ try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; break } catch { Start-Sleep -Milliseconds 500 } }"
node server.mjs

pause
endlocal
exit /b

:save_secret
>>.env.local echo STREAM_PROXY_SECRET=%STREAM_PROXY_SECRET%
exit /b
