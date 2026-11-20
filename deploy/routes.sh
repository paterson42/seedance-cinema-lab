#!/usr/bin/env bash
# Writes the Caddy routes for the booth domain and reloads Caddy. Run as root on the server.
#
# With BASE_PATH set in the film app's .env (e.g. /film):
#   /                 entrance page: one QR, visitors choose FILM or ADS   (landing/index.html)
#   /film/...         film app       (127.0.0.1:3000)
#   /ad/...           ads app        (127.0.0.1:3001, deployed from the commerce-ad-lab branch)
#   anything else     redirected to /film/... so old film links keep working
#                     (shared /r/<token> results, /screen/poster, /admin, ...)
# Without BASE_PATH the film app simply stays at the domain root.
#
# Usage:  bash deploy/routes.sh <domain>
set -euo pipefail
DOMAIN="${1:?usage: routes.sh <domain>}"
APP_DIR="${APP_DIR:-/opt/seedance-cinema-lab}"
FILM_PATH="$(grep -E '^BASE_PATH=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)"
[ -n "$FILM_PATH" ] && FILM_PATH="/${FILM_PATH#/}" && FILM_PATH="${FILM_PATH%/}"

if [ -n "$FILM_PATH" ]; then
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip

	# Entrance: one QR code -> choose FILM or ADS
	@landing path /
	handle @landing {
		root * $APP_DIR/landing
		file_server
	}

	@ad path /ad /ad/*
	handle @ad {
		reverse_proxy 127.0.0.1:3001
	}

	@film path $FILM_PATH $FILM_PATH/*
	handle @film {
		reverse_proxy 127.0.0.1:3000
	}

	# Old film links (shared /r/ results, /screen/*, /admin, ...) now live under $FILM_PATH
	handle {
		redir * $FILM_PATH{uri}
	}
}
EOF
else
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
fi
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy
echo "caddy routes: ${FILM_PATH:-film at /} $([ -n "$FILM_PATH" ] && echo "· landing at / · ads at /ad")"
