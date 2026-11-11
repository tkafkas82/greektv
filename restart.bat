@echo off
setlocal
cd /d "%~dp0"

rem Stops whatever is serving the app's port, then starts it again via start.bat.
rem The port comes from .env.local (PORT=...) like start.bat, else 3000.

if exist ".env.local" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env.local") do if /i "%%A"=="PORT" set "PORT=%%B"
)
if not defined PORT set "PORT=3000"

set "STOPPED="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    taskkill /PID %%P /F >nul 2>nul && set "STOPPED=1"
  )
)
if defined STOPPED (
  echo Stopped the server on port %PORT%.
  rem Give Windows a moment to release the port.
  timeout /t 1 /nobreak >nul
) else (
  echo No server was running on port %PORT%.
)

endlocal & call "%~dp0start.bat"
