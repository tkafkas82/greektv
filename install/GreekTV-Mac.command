#!/bin/bash
# Greek TV & Radio for macOS - double-click to install (first time) or open.
# Installs Node.js (if missing) and the app into ~/.greektv, starts the server
# in the background and opens the browser. No admin password needed.
#
# A .command file downloaded through a browser is quarantined, so the first
# time: right-click -> Open -> Open. Or skip this file and paste into Terminal:
#   curl -fsSL https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install.sh | bash

here="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$here/install.sh" ]; then
  bash "$here/install.sh"
else
  curl -fsSL https://raw.githubusercontent.com/tkafkas82/greektv/main/install/install.sh | bash
fi
