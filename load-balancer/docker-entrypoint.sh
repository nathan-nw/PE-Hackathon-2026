#!/bin/sh
# Generate nginx.conf from template. Docker Compose: defaults match service DNS (url-shortener-a/b:5000).
# Railway: set URL_SHORTENER_A_HOST / URL_SHORTENER_B_HOST to each replica's RAILWAY_PRIVATE_DOMAIN.

set -e

UPSTREAM_A="${UPSTREAM_A:-url-shortener-a:5000}"
UPSTREAM_B="${UPSTREAM_B:-url-shortener-b:5000}"

if [ -n "${URL_SHORTENER_A_HOST:-}" ]; then
  UPSTREAM_A="${URL_SHORTENER_A_HOST}:${URL_SHORTENER_PORT:-5000}"
fi
if [ -n "${URL_SHORTENER_B_HOST:-}" ]; then
  UPSTREAM_B="${URL_SHORTENER_B_HOST}:${URL_SHORTENER_PORT:-5000}"
fi

# Railway sets PORT; Compose publishes container port 80 -> omit PORT (default 80).
NGINX_LISTEN_PORT="${PORT:-80}"

sed -e "s|@UPSTREAM_A@|${UPSTREAM_A}|g" \
    -e "s|@UPSTREAM_B@|${UPSTREAM_B}|g" \
    -e "s|@NGINX_LISTEN_PORT@|${NGINX_LISTEN_PORT}|g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
