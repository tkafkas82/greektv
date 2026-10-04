#!/usr/bin/env bash
# One-shot setup for Greek TV Dial on a fresh Ubuntu 22.04 / 24.04 VM
# (Oracle Cloud Always Free, Hetzner, or anything similar).
#
#   curl -fsSL https://raw.githubusercontent.com/tkafkas82/greektv/main/deploy/setup.sh \
#     | sudo bash -s -- your.domain.example
#
# Safe to re-run: it pulls the latest code, re-applies the config and restarts.
# Run it again after every `git push` to deploy, or use deploy/update.sh.

set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/tkafkas82/greektv.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/greektv
ENV_FILE=/etc/greektv.env

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: setup.sh <domain>   e.g. setup.sh greektv.duckdns.org" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> App user and code"
# The checkout is owned by greektv; let root's git operate on it.
git config --global --get-all safe.directory | grep -qx "$APP_DIR" \
  || git config --global --add safe.directory "$APP_DIR"
id greektv >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin greektv
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R greektv:greektv "$APP_DIR"

echo "==> Secret"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "STREAM_PROXY_SECRET=$(openssl rand -base64 32)" > "$ENV_FILE"
fi
chown root:greektv "$ENV_FILE"
chmod 640 "$ENV_FILE"

echo "==> Service"
install -m 644 "$APP_DIR/deploy/greektv.service" /etc/systemd/system/greektv.service
systemctl daemon-reload
systemctl enable greektv
systemctl restart greektv

echo "==> Caddy config for $DOMAIN"
sed "s/greektv\.example\.com/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> Firewall (ports 80, 443)"
# Oracle's Ubuntu images ship iptables rules that REJECT everything except SSH,
# even after you open the ports in the cloud console. Insert ACCEPTs ahead of
# that REJECT and persist them. Harmless on hosts without such rules.
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

echo
echo "Done. Check:"
echo "  systemctl status greektv caddy"
echo "  curl -sI https://$DOMAIN/ | head -1"
echo "  journalctl -u greektv -f      # app logs"
