#!/bin/sh
set -e
# Browser-reachable API base (NGINX load balancer), not an in-cluster hostname.
: "${BACKEND_URL:=http://localhost:18080}"
export BACKEND_URL
envsubst '${BACKEND_URL}' < /usr/share/nginx/html/api-config.js.template > /usr/share/nginx/html/api-config.js
