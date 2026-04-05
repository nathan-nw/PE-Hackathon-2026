# Start the full stack with one command (from repo root).
# Usage:
#   .\scripts\start.ps1              # Docker Compose (same as: docker compose up -d --build)
#   .\scripts\start.ps1 -Target k8s  # build images + kubectl apply -k k8s/

param(
    [ValidateSet("compose", "k8s")]
    [string] $Target = "compose"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if ($Target -eq "compose") {
    Write-Host "Starting Docker Compose stack (detached)..." -ForegroundColor Cyan
    docker compose up -d --build
    Write-Host "Done. API via LB: http://localhost:8080  |  logs: docker compose logs -f" -ForegroundColor Green
    exit $LASTEXITCODE
}

Write-Host "Building images..." -ForegroundColor Cyan
docker build -t pe-hackathon/url-shortener:latest ./url-shortener
docker build -t pe-hackathon/load-balancer:latest ./load-balancer
docker build -t pe-hackathon/dashboard:latest ./dashboard
docker build -t pe-hackathon/user-frontend:latest ./user-frontend

Write-Host "Applying Kubernetes manifests..." -ForegroundColor Cyan
kubectl apply -k k8s/

Write-Host "Done. Example: curl http://localhost:30880/health  |  see k8s/README.md for ports" -ForegroundColor Green
