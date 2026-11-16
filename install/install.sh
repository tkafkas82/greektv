#!/usr/bin/env bash
# Greek TV & Radio - one-time setup for macOS, Linux and Android (Termux).
#
#   macOS / Linux (Terminal):
#     curl -fsSL https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install.sh | bash
#
#   Android: install Termux from F-Droid (the Play Store build is outdated), then
#     pkg install -y curl && curl -fsSL https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install.sh | bash
#
# It uses Node 18+ if installed, else installs it (a private copy in
# ~/.greektv/node on macOS/Linux, `pkg install nodejs-lts` on Termux), puts
# greektv-launcher.mjs in ~/.greektv and runs it - the launcher downloads the
# app from GitHub, starts the server and opens the browser - then leaves:
#   the command  greektv [start|stop|update|status]
#   macOS   ~/Applications/Greek TV.app   (Spotlight: "Greek TV")
#   Linux   "Greek TV" in the applications menu
#   Termux  ~/.shortcuts/Greek TV         (home-screen button via Termux:Widget)
#
# Remove it again:  bash install.sh uninstall   (or the same curl line with "-s uninstall")

set -euo pipefail

REPO="tkafkas82/greektv"
BRANCH="main"
LAUNCHER_URL="https://raw.githubusercontent.com/$REPO/$BRANCH/install/greektv-launcher.mjs"
HOME_DIR="${GREEKTV_HOME:-$HOME/.greektv}"
NODE_DIR="$HOME_DIR/node"
LAUNCHER="$HOME_DIR/greektv-launcher.mjs"
WRAPPER="$HOME_DIR/greektv"

say() { printf '  %s\n' "$*" >&2; }
die() { printf '\n  Greek TV setup failed: %s\n\n' "$*" >&2; exit 1; }

IS_TERMUX=""
if [ -n "${TERMUX_VERSION:-}" ] || [ "${PREFIX:-}" = "/data/data/com.termux/files/usr" ]; then IS_TERMUX=1; fi
OS="$(uname -s)"
BIN_DIR="$HOME/.local/bin"; [ -n "$IS_TERMUX" ] && BIN_DIR="$PREFIX/bin"

if [ "${1:-}" = "uninstall" ]; then
  [ -x "$WRAPPER" ] && "$WRAPPER" stop || true
  rm -f "$BIN_DIR/greektv" "$HOME/.shortcuts/Greek TV" "$HOME/.local/share/applications/greektv.desktop"
  rm -rf "$HOME/Applications/Greek TV.app" "$HOME_DIR"
  say "Greek TV removed."
  exit 0
fi

command -v curl >/dev/null 2>&1 || { [ -n "$IS_TERMUX" ] && pkg install -y curl; } || die "curl is required"

echo >&2; say "Greek TV & Radio - setup"; echo >&2
mkdir -p "$HOME_DIR"

# ------------------------------------------------------------------ 1. node
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

NODE=""
if [ -x "$NODE_DIR/bin/node" ] && [ "$(node_major "$NODE_DIR/bin/node")" -ge 18 ]; then
  NODE="$NODE_DIR/bin/node"
elif command -v node >/dev/null 2>&1 && [ "$(node_major node)" -ge 18 ]; then
  NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  if [ -n "$IS_TERMUX" ]; then
    say "Installing Node.js with pkg..."
    pkg install -y nodejs-lts || pkg install -y nodejs
    NODE="$(command -v node)"
  else
    case "$OS" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported system $OS - install Node.js 18+ and run this again" ;; esac
    case "$(uname -m)" in
      x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; armv7l) arch=armv7l ;;
      *) die "unsupported CPU $(uname -m)" ;;
    esac
    # index.tab names macOS builds "osx-<arch>-tar"; the tarball itself says darwin.
    if [ "$os" = darwin ]; then key="osx-$arch-tar"; else key="$os-$arch"; fi
    say "Node.js not found - downloading the current LTS for $os-$arch from nodejs.org..."
    # index.tab columns: version date files ... lts(10) security; newest first.
    ver="$(curl -fsSL https://nodejs.org/dist/index.tab | awk -F'\t' -v f="$key" '!v && NR>1 && $10!="-" && index($3,f) {v=$1} END {print v}')"
    [ -n "$ver" ] || die "no Node.js LTS build for $os-$arch"
    tmp="$(mktemp -d)"
    curl -fsSL "https://nodejs.org/dist/$ver/node-$ver-$os-$arch.tar.gz" | tar -xz -C "$tmp"
    rm -rf "$NODE_DIR"
    mv "$tmp/node-$ver-$os-$arch" "$NODE_DIR"
    rm -rf "$tmp"
    NODE="$NODE_DIR/bin/node"
    say "Node.js $ver installed in $NODE_DIR"
  fi
fi
[ -n "$NODE" ] && [ "$(node_major "$NODE")" -ge 18 ] || die "Node.js 18+ could not be installed"

# ------------------------------------------------------------------ 2. launcher
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/greektv-launcher.mjs" ]; then
  cp "$here/greektv-launcher.mjs" "$LAUNCHER"
else
  curl -fsSL "$LAUNCHER_URL" -o "$LAUNCHER" || die "could not download the launcher"
fi

# One wrapper for every launcher below, pinned to the node found above.
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$NODE" "$LAUNCHER" > "$WRAPPER"
chmod +x "$WRAPPER"

"$WRAPPER" start

# ------------------------------------------------------------------ 3. launchers
mkdir -p "$BIN_DIR" && ln -sf "$WRAPPER" "$BIN_DIR/greektv" 2>/dev/null || true
ICON="$HOME_DIR/app/public/icons/icon-512.png"

if [ -n "$IS_TERMUX" ]; then
  mkdir -p "$HOME/.shortcuts"
  printf '#!/data/data/com.termux/files/usr/bin/sh\ncommand -v termux-wake-lock >/dev/null && termux-wake-lock\nexec "%s" start\n' "$WRAPPER" > "$HOME/.shortcuts/Greek TV"
  chmod +x "$HOME/.shortcuts/Greek TV"
  say "Home-screen button: install Termux:Widget and add its widget - 'Greek TV' is listed."
elif [ "$OS" = "Darwin" ]; then
  # A minimal .app bundle; made locally, so Gatekeeper has no quarantine flag to object to.
  app="$HOME/Applications/Greek TV.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  printf '#!/bin/sh\nexec "%s" start >>"%s" 2>&1\n' "$WRAPPER" "$HOME_DIR/launcher.log" > "$app/Contents/MacOS/GreekTV"
  chmod +x "$app/Contents/MacOS/GreekTV"
  cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Greek TV</string>
  <key>CFBundleIdentifier</key><string>local.greektv.launcher</string>
  <key>CFBundleExecutable</key><string>GreekTV</string>
  <key>CFBundleIconFile</key><string>GreekTV</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  if [ -f "$ICON" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
    set_dir="$(mktemp -d)/GreekTV.iconset"; mkdir -p "$set_dir"
    for sz in 16 32 128 256 512; do sips -z $sz $sz "$ICON" --out "$set_dir/icon_${sz}x${sz}.png" >/dev/null 2>&1 || true; done
    iconutil -c icns "$set_dir" -o "$app/Contents/Resources/GreekTV.icns" 2>/dev/null || true
    rm -rf "$(dirname "$set_dir")"
  fi
  say "Launcher: 'Greek TV' in ~/Applications (Spotlight finds it)."
elif [ "$OS" = "Linux" ]; then
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/greektv.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Greek TV
Comment=Greek TV & Radio
Exec="$WRAPPER" start
Icon=$ICON
Terminal=false
Categories=AudioVideo;
DESKTOP
  say "Launcher: 'Greek TV' in the applications menu."
fi

say "Command:  greektv start | stop | update | status"
echo >&2
