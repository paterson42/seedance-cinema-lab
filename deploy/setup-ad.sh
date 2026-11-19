#!/usr/bin/env bash
# Adds the Commerce (ad) demo next to the Cinema demo on the same server and domain.
# Run as root on the server that deploy/setup.sh already set up.
#
#   https://<domain>/ad/           visitor site
#   https://<domain>/ad/poster     key-visual screen
#   https://<domain>/ad/trailer    ad-video screen
#
# The Cinema demo keeps working at the domain root. Once the Cinema app is started with
# BASE_PATH=/cinema (in /opt/seedance-cinema-lab/.env), re-run this script: it then serves
# Cinema at /cinema/ and sends old root links there.
#
# Usage:  bash setup-ad.sh <domain>
set -euo pipefail

DOMAIN="${1:?usage: setup-ad.sh <domain>}"
REPO="${REPO:-https://github.com/paterson42/seedance-cinema-lab.git}"
BRANCH="${BRANCH:-commerce-ad-lab}"
APP_DIR=/opt/seedance-commerce-lab
CINEMA_DIR=/opt/seedance-cinema-lab
APP_USER=cinema
AD_PORT=3001
AD_PATH=/ad

echo "==> app code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" config --global --add safe.directory "$APP_DIR" || true
  git -C "$APP_DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> .env (first run): fill in ARK_API_KEY and the model endpoints afterwards"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i \
    -e "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" \
    -e "s#^BASE_PATH=.*#BASE_PATH=$AD_PATH#" \
    -e "s#^PORT=.*#PORT=$AD_PORT#" \
    -e "s#^APP_SECRET=.*#APP_SECRET=$(openssl rand -base64 32 | tr -d '/+=')#" \
    -e "s#^ADMIN_TOKEN=.*#ADMIN_TOKEN=$(openssl rand -hex 12)#" \
    "$APP_DIR/.env"
  grep -q '^PORT=' "$APP_DIR/.env" || echo "PORT=$AD_PORT" >> "$APP_DIR/.env"
  grep -q '^BASE_PATH=' "$APP_DIR/.env" || echo "BASE_PATH=$AD_PATH" >> "$APP_DIR/.env"
fi
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> systemd service (commerce)"
cat > /etc/systemd/system/commerce.service <<UNIT
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
UNIT
systemctl daemon-reload
systemctl enable commerce >/dev/null
systemctl restart commerce

echo "==> caddy"
CINEMA_PATH="$(grep -E '^BASE_PATH=' "$CINEMA_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)"
if [ -n "$CINEMA_PATH" ]; then
  # Cinema lives under its own path: old root links (printed QR codes, /screen/poster) go there.
  ROOT_BLOCK="	@cinema path $CINEMA_PATH $CINEMA_PATH/*
	handle @cinema {
		reverse_proxy 127.0.0.1:3000
	}
	handle {
		redir * $CINEMA_PATH{uri}
	}"
else
  ROOT_BLOCK="	handle {
		reverse_proxy 127.0.0.1:3000
	}"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	@ad path $AD_PATH $AD_PATH/*
	handle @ad {
		reverse_proxy 127.0.0.1:$AD_PORT
	}
$ROOT_BLOCK
}
CADDY
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

echo
echo "Commerce demo:  https://$DOMAIN$AD_PATH/   screens: $AD_PATH/poster  $AD_PATH/trailer"
echo "Admin token:    grep ADMIN_TOKEN $APP_DIR/.env"
[ -n "$CINEMA_PATH" ] && echo "Cinema demo:    https://$DOMAIN$CINEMA_PATH/" || echo "Cinema demo:    https://$DOMAIN/ (unchanged)"
