#!/bin/sh
# Generate nginx.conf from template. Docker Compose: defaults match service DNS (url-shortener-a/b:5000).
# Railway: set URL_SHORTENER_A_HOST / URL_SHORTENER_B_HOST (see setup-railway.js SYNC_VARIABLES) — never use
# bare "url-shortener-a" hostnames; those only exist on the Compose network.

set -e

# Railway injects several of these on deploy; avoid Compose-only hostnames when any are present.
is_railway() {
  [ -n "${RAILWAY_ENVIRONMENT:-}" ] ||
    [ -n "${RAILWAY_PROJECT_ID:-}" ] ||
    [ -n "${RAILWAY_SERVICE_ID:-}" ] ||
    [ -n "${RAILWAY_PRIVATE_DOMAIN:-}" ] ||
    [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]
}

# --- upstream host:port -------------------------------------------------
if [ -n "${URL_SHORTENER_A_HOST:-}" ]; then
  UPSTREAM_A="${URL_SHORTENER_A_HOST}:${URL_SHORTENER_PORT:-5000}"
elif [ -n "${UPSTREAM_A:-}" ]; then
  :
elif is_railway; then
  echo "ERROR: On Railway, Compose hostnames (url-shortener-a) do not exist. Set URL_SHORTENER_A_HOST and URL_SHORTENER_B_HOST" >&2
  echo "       (e.g. run from repo root: SYNC_VARIABLES=1 node setup-railway.js), or set UPSTREAM_A / UPSTREAM_B to host:port." >&2
  exit 1
else
  UPSTREAM_A="url-shortener-a:5000"
fi

if [ -n "${URL_SHORTENER_B_HOST:-}" ]; then
  UPSTREAM_B="${URL_SHORTENER_B_HOST}:${URL_SHORTENER_PORT:-5000}"
elif [ -n "${UPSTREAM_B:-}" ]; then
  :
elif is_railway; then
  echo "ERROR: On Railway, set URL_SHORTENER_B_HOST (and A), or UPSTREAM_B / UPSTREAM_A. See RAILWAY.md." >&2
  exit 1
else
  UPSTREAM_B="url-shortener-b:5000"
fi

if [ -n "${URL_SHORTENER_A_HOST:-}" ] && [ -z "${URL_SHORTENER_B_HOST:-}" ]; then
  echo "ERROR: URL_SHORTENER_B_HOST must be set when URL_SHORTENER_A_HOST is set." >&2
  exit 1
fi
if [ -n "${URL_SHORTENER_B_HOST:-}" ] && [ -z "${URL_SHORTENER_A_HOST:-}" ]; then
  echo "ERROR: URL_SHORTENER_A_HOST must be set when URL_SHORTENER_B_HOST is set." >&2
  exit 1
fi

# Railway sets PORT; Compose publishes container port 80 -> omit PORT (default 80).
NGINX_LISTEN_PORT="${PORT:-80}"

sed -e "s|@UPSTREAM_A@|${UPSTREAM_A}|g" \
    -e "s|@UPSTREAM_B@|${UPSTREAM_B}|g" \
    -e "s|@NGINX_LISTEN_PORT@|${NGINX_LISTEN_PORT}|g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Nginx resolves upstream names at startup; wait until each replica answers /live so DNS exists
# (Compose: LB can start before API DNS is registered) and TCP is accepting.
wait_live() {
  target="$1"
  max="${2:-120}"
  i=0
  echo "load-balancer: waiting for http://${target}/live ..."
  while [ "$i" -lt "$max" ]; do
    if curl -fsS --connect-timeout 2 --max-time 5 "http://${target}/live" >/dev/null 2>&1; then
      echo "load-balancer: OK ${target}"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "ERROR: upstream not ready: http://${target}/live (timed out after ${max}s)" >&2
  exit 1
}

wait_live "$UPSTREAM_A"
wait_live "$UPSTREAM_B"

exec nginx -g 'daemon off;'
