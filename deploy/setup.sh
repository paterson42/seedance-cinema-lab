#!/usr/bin/env bash
# One-shot server setup for Ubuntu 24.04 (run as root). Safe to re-run: it also updates.
#   Node 24 + Caddy (automatic HTTPS) + systemd service that starts on boot.
#
# Usage:  bash setup.sh <domain>
#   e.g.  ssh -i key.pem root@<ip> 'bash -s' -- kr.example.com < deploy/setup.sh
set -euo pipefail

DOMAIN="${1:?usage: setup.sh <domain>}"
REPO="${REPO:-https://github.com/paterson42/seedance-cinema-lab.git}"
APP_DIR=/opt/seedance-cinema-lab
APP_USER=cinema
export DEBIAN_FRONTEND=noninteractive

echo "==> packages"
apt-get update -y
apt-get install -y curl git ca-certificates caddy ffmpeg
timedatectl set-timezone Asia/Seoul || true

echo "==> node 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> app code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" config --global --add safe.directory "$APP_DIR" || true
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> .env (first run)"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i \
    -e "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" \
    -e "s#^APP_SECRET=.*#APP_SECRET=$(openssl rand -base64 32 | tr -d '/+=')#" \
    -e "s#^ADMIN_TOKEN=.*#ADMIN_TOKEN=$(openssl rand -hex 12)#" \
    "$APP_DIR/.env"
fi
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> systemd service"
cat > /etc/systemd/system/cinema.service <<EOF
[Unit]
Description=Seedance Seoul Commerce Lab
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server/index.js
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cinema >/dev/null
systemctl restart cinema

echo "==> caddy (HTTPS for $DOMAIN)"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

sleep 2
systemctl is-active --quiet cinema && echo "cinema: running" || { journalctl -u cinema -n 30 --no-pager; exit 1; }
TOKEN=$(grep '^ADMIN_TOKEN=' "$APP_DIR/.env" | cut -d= -f2)
MODE=$(grep -q '^ARK_API_KEY=.\+' "$APP_DIR/.env" && echo LIVE || echo "MOCK (demo)")
cat <<EOF

✅ done — mode: $MODE
   site     https://$DOMAIN
   admin    https://$DOMAIN/admin?token=$TOKEN
   screens  https://$DOMAIN/screen/poster  ·  https://$DOMAIN/screen/trailer
   logs     journalctl -u cinema -f
   config   nano $APP_DIR/.env   then   systemctl restart cinema
EOF
