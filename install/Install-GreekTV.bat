@echo off
rem Greek TV & Radio for Windows - double-click once to set it up.
rem Installs Node.js if missing and the app into %LOCALAPPDATA%\GreekTV, starts
rem it, opens the browser and adds a "Greek TV" shortcut. No admin rights needed.
rem After that, use the shortcut; this file is not needed again.

setlocal
set "PS1=%~dp0install-windows.ps1"
if exist "%PS1%" (
  rem A copy unzipped from a GitHub download carries the "from the internet" mark,
  rem which RemoteSigned refuses; clear it on this one file first.
  powershell -NoProfile -Command "Unblock-File -LiteralPath '%PS1%'; Unblock-File -LiteralPath '%~dp0greektv-launcher.mjs' -ErrorAction SilentlyContinue"
  powershell -NoProfile -ExecutionPolicy RemoteSigned -File "%PS1%"
) else (
  powershell -NoProfile -Command "irm https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install-windows.ps1 | iex"
)
echo.
pause
endlocal
