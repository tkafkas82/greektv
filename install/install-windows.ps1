# Greek TV & Radio - one-time setup for Windows. No admin rights needed.
#
# On a new PC, paste into PowerShell:
#
#   irm https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install-windows.ps1 | iex
#
# or double-click install\Install-GreekTV.bat. It:
#   1. uses Node 18+ if it is installed, else downloads the current Node LTS
#      into %LOCALAPPDATA%\GreekTV\node (a private copy, nothing system-wide);
#   2. puts greektv-launcher.mjs in %LOCALAPPDATA%\GreekTV and runs it, which
#      downloads the app from GitHub, starts the server and opens the browser;
#   3. adds "Greek TV" to the desktop and the Start menu, plus "Greek TV - Stop".
#
# From then on the shortcut runs the launcher with node.exe directly - this
# script is not needed again. It never runs anything hidden and never adds
# itself to Windows startup, which behaviour-based antivirus (Bitdefender
# Advanced Threat Defense) reads as malware.
#
# Remove everything again:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install-windows.ps1))) -Uninstall

param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar slows downloads 10x on PowerShell 5.1
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$Repo        = 'tkafkas82/greektv'
$Branch      = 'main'
$LauncherUrl = "https://raw.githubusercontent.com/$Repo/$Branch/install/greektv-launcher.mjs"
$Home_       = Join-Path $env:LOCALAPPDATA 'GreekTV'
$NodeDir     = Join-Path $Home_ 'node'
$Launcher    = Join-Path $Home_ 'greektv-launcher.mjs'

function Say($msg) { Write-Host "  $msg" }

function Get-ShortcutPaths {
  $programs = [Environment]::GetFolderPath('Programs')
  @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Greek TV.lnk'),
    (Join-Path $programs 'Greek TV.lnk'),
    (Join-Path $programs 'Greek TV - Stop.lnk')
  )
}

# ------------------------------------------------------------------ node
function Get-NodeVersion($exe) {
  try { return [version](& $exe -p "process.versions.node" 2>$null) } catch { return $null }
}
function Find-Node {
  $private = Join-Path $NodeDir 'node.exe'
  if (Test-Path $private) { $v = Get-NodeVersion $private; if ($v -and $v.Major -ge 18) { return $private } }
  $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($onPath) { $v = Get-NodeVersion $onPath.Source; if ($v -and $v.Major -ge 18) { return $onPath.Source } }
  return $null
}
function Install-Node {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' }
          elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  Say "Node.js not found - downloading the current LTS for $arch from nodejs.org..."
  $index = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
  $rel = $index | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
  if (-not $rel) { throw "No Node.js LTS build for win-$arch" }
  $name = "node-$($rel.version)-win-$arch"
  $tmp = Join-Path $Home_ "tmp-node"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "$name.zip"
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($rel.version)/$name.zip" -OutFile $zip
    Say 'Unpacking...'
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'   # Windows 10 1803+, far faster than Expand-Archive
    if (Test-Path $tar) { & $tar -xf $zip -C $tmp }
    if (-not (Test-Path (Join-Path $tmp $name))) { Expand-Archive -Path $zip -DestinationPath $tmp -Force }
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item (Join-Path $tmp $name) $NodeDir
  } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  Say "Node.js $($rel.version) installed in $NodeDir"
  return (Join-Path $NodeDir 'node.exe')
}

# ------------------------------------------------------------------ shortcuts
function Write-Icon {
  # An .ico may simply wrap a PNG (Vista+), so the app's own icon needs no converter.
  $png = Join-Path $Home_ 'app\public\icons\icon-192.png'
  $ico = Join-Path $Home_ 'greektv.ico'
  if (-not (Test-Path $png)) { return $null }
  $bytes = [IO.File]::ReadAllBytes($png)
  $ms = New-Object IO.MemoryStream
  $w = New-Object IO.BinaryWriter($ms)
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)          # header: icon, 1 image
  $w.Write([byte]192); $w.Write([byte]192); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$bytes.Length); $w.Write([uint32]22)
  $w.Write($bytes); $w.Flush()
  [IO.File]::WriteAllBytes($ico, $ms.ToArray())
  return $ico
}
function New-Shortcut($path, $node, $arguments, $icon, $description) {
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $lnk.TargetPath = $node
  $lnk.Arguments = "`"$Launcher`" $arguments".Trim()
  $lnk.WorkingDirectory = $Home_
  $lnk.Description = $description
  if ($icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
}

# ------------------------------------------------------------------ main
if ($Uninstall) {
  $node = Find-Node
  if ($node -and (Test-Path $Launcher)) { & $node $Launcher stop }
  # Belt and braces: the server's files can't be deleted while it runs.
  $pidFile = Join-Path $Home_ 'server.pid'
  if (Test-Path $pidFile) {
    $p = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; Start-Sleep -Milliseconds 500 }
  }
  foreach ($f in Get-ShortcutPaths) { Remove-Item -Force $f -ErrorAction SilentlyContinue }
  if (Test-Path $Home_) { Remove-Item -Recurse -Force $Home_ }
  Say 'Greek TV removed.'
  return
}

Write-Host ''
Write-Host '  Greek TV & Radio - setup'
Write-Host ''
New-Item -ItemType Directory -Force $Home_ | Out-Null

# 1. Node.
$node = Find-Node
if ($node) { Say "Using Node.js $(Get-NodeVersion $node) at $node" } else { $node = Install-Node }

# 2. Launcher: the copy next to this script when run from a clone, else GitHub's.
$local = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'greektv-launcher.mjs' } else { $null }
if ($local -and (Test-Path $local)) {
  Copy-Item $local $Launcher -Force
} else {
  Invoke-WebRequest -UseBasicParsing $LauncherUrl -OutFile $Launcher
}

& $node $Launcher start
if ($LASTEXITCODE -ne 0) { throw 'The launcher could not start Greek TV (see above).' }

# 3. Shortcuts.
$icon = Write-Icon
$desktop, $start, $stop = Get-ShortcutPaths
New-Shortcut $desktop $node '' $icon 'Greek TV & Radio'
New-Shortcut $start $node '' $icon 'Greek TV & Radio'
New-Shortcut $stop $node 'stop' $icon 'Stop the Greek TV server'

Write-Host ''
Say "Done. Next time just open 'Greek TV' from the desktop or the Start menu."
Say "'Greek TV - Stop' in the Start menu stops the server."
Write-Host ''
