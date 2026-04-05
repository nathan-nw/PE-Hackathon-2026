#!/usr/bin/env bash
# Start the full stack with one command (from repo root).
# Usage:
#   ./scripts/start.sh           # Docker Compose (default)
#   ./scripts/start.sh k8s       # build images + kubectl apply -k k8s/
#
# On Windows: use scripts\start.cmd or PowerShell: .\scripts\start.ps1 (not this file in PowerShell).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-compose}"

if [[ "$TARGET" == "compose" ]]; then
  echo "Starting Docker Compose stack (detached)..."
  docker compose up -d --build
  echo "Done. API via LB: http://localhost:8080  |  logs: docker compose logs -f"
  exit 0
fi

if [[ "$TARGET" != "k8s" ]]; then
  echo "Usage: $0 [compose|k8s]" >&2
  exit 1
fi

echo "Building images..."
docker build -t pe-hackathon/url-shortener:latest ./url-shortener
docker build -t pe-hackathon/load-balancer:latest ./load-balancer
docker build -t pe-hackathon/dashboard:latest ./dashboard
docker build -t pe-hackathon/user-frontend:latest ./user-frontend

echo "Applying Kubernetes manifests..."
kubectl apply -k k8s/

echo "Done. Example: curl http://localhost:30880/health  |  see k8s/README.md for ports"
