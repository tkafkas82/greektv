#!/usr/bin/env bash
# Pull the latest code and restart. Run on the VM:  sudo /opt/greektv/deploy/update.sh

set -euo pipefail

APP_DIR=/opt/greektv
BRANCH="${BRANCH:-main}"

git config --global --get-all safe.directory | grep -qx "$APP_DIR" \
  || git config --global --add safe.directory "$APP_DIR"
git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/$BRANCH"
chown -R greektv:greektv "$APP_DIR"
systemctl restart greektv
echo "Deployed $(git -C "$APP_DIR" log -1 --format='%h %s')"
