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

# Per-replica port: optional URL_SHORTENER_A_PORT / URL_SHORTENER_B_PORT, else URL_SHORTENER_PORT, else 5000 (Compose).
# On Railway, set ports explicitly (SYNC_VARIABLES=1) — do not rely on 5000 unless API PORT matches (see setup-railway.js).
_shortener_port_a="${URL_SHORTENER_A_PORT:-${URL_SHORTENER_PORT:-5000}}"
_shortener_port_b="${URL_SHORTENER_B_PORT:-${URL_SHORTENER_PORT:-5000}}"

if is_railway && [ -n "${URL_SHORTENER_A_HOST:-}" ]; then
  if [ -z "${URL_SHORTENER_A_PORT:-}" ] && [ -z "${URL_SHORTENER_B_PORT:-}" ] && [ -z "${URL_SHORTENER_PORT:-}" ]; then
    echo "ERROR: Railway load-balancer needs URL_SHORTENER_A_PORT and URL_SHORTENER_B_PORT (or URL_SHORTENER_PORT)." >&2
    echo "       Runtime PORT is not referenceable across services unless PORT is set on each API service." >&2
    echo "       Run: SYNC_VARIABLES=1 node setup-railway.js  (sets PORT on APIs + port refs on this service)" >&2
    exit 1
  fi
fi

# --- upstream host:port -------------------------------------------------
if [ -n "${URL_SHORTENER_A_HOST:-}" ]; then
  UPSTREAM_A="${URL_SHORTENER_A_HOST}:${_shortener_port_a}"
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
  UPSTREAM_B="${URL_SHORTENER_B_HOST}:${_shortener_port_b}"
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

echo "load-balancer: resolved upstreams UPSTREAM_A=${UPSTREAM_A} UPSTREAM_B=${UPSTREAM_B}" >&2

# DNS for variable proxy_pass (see nginx.conf.template). Use the platform resolver — Railway / Docker
# inject /etc/resolv.conf; 127.0.0.11 is Docker Embedded DNS for Compose.
NGINX_RESOLVER="${NGINX_RESOLVER:-$(awk '/^nameserver[[:space:]]/{print $2; exit}' /etc/resolv.conf 2>/dev/null)}"
if [ -z "${NGINX_RESOLVER}" ]; then
  NGINX_RESOLVER="127.0.0.11"
fi
# Nginx `resolver` requires IPv6 literals in brackets (e.g. [fd12::10]). A bare fd12::10 is parsed as
# "host:port" and fails with: invalid port in resolver "fd12::10" (Railway often uses IPv6 DNS).
case "${NGINX_RESOLVER}" in
  \[*) ;;
  *:*)
    NGINX_RESOLVER="[${NGINX_RESOLVER}]"
    ;;
esac
echo "load-balancer: nginx resolver ${NGINX_RESOLVER} (re-resolve upstream hostnames; avoids stale IPs after Railway redeploys)" >&2

# Must match dashboard-backend LOAD_TEST_BYPASS_TOKEN so k6 can send X-Load-Test-Bypass. If unset, use a
# value no client will send — edge limiting stays strictly per-IP for everyone.
LOAD_TEST_BYPASS_TOKEN_EFFECTIVE="${LOAD_TEST_BYPASS_TOKEN:-__no_load_test_bypass__}"

# Railway sets PORT; Compose publishes container port 80 -> omit PORT (default 80).
NGINX_LISTEN_PORT="${PORT:-80}"

sed -e "s|@UPSTREAM_A@|${UPSTREAM_A}|g" \
    -e "s|@UPSTREAM_B@|${UPSTREAM_B}|g" \
    -e "s|@NGINX_LISTEN_PORT@|${NGINX_LISTEN_PORT}|g" \
    -e "s|@NGINX_RESOLVER@|${NGINX_RESOLVER}|g" \
    -e "s|@LOAD_TEST_BYPASS_TOKEN@|${LOAD_TEST_BYPASS_TOKEN_EFFECTIVE}|g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Nginx resolves upstream names at startup; wait until each replica answers /live so DNS exists
# (Compose: LB can start before API DNS is registered) and TCP is accepting.
wait_live() {
  target="$1"
  max="${2:-300}"
  i=0
  echo "load-balancer: waiting for http://${target}/live (max ${max}s) ..."
  while [ "$i" -lt "$max" ]; do
    if curl -fsS --connect-timeout 2 --max-time 5 "http://${target}/live" >/dev/null 2>&1; then
      echo "load-balancer: OK ${target}"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "ERROR: upstream not ready: http://${target}/live (timed out after ${max}s)" >&2
  echo "       Check: same PORT as Gunicorn (API), private networking, DB migrations finished." >&2
  exit 1
}

_wait_sec="${LB_UPSTREAM_WAIT_SEC:-300}"
wait_live "$UPSTREAM_A" "$_wait_sec"
wait_live "$UPSTREAM_B" "$_wait_sec"

exec nginx -g 'daemon off;'
