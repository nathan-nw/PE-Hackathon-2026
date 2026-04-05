#!/usr/bin/env bash
# Reconcile API replicas with docker-compose.yml (recovery when engine auto-restart fails on some hosts).
# From repo root:  ./scripts/ensure-api-replicas.sh

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
echo "Repo root: $root"
docker compose up -d url-shortener-a url-shortener-b
