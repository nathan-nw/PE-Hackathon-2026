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
    $composeExit = $LASTEXITCODE
    $portLine = docker compose port load-balancer 80 2>$null
    $lbPort = $null
    if ($LASTEXITCODE -eq 0 -and $portLine -match ':(\d+)\s*$') {
        $lbPort = $Matches[1]
    }
    if (-not $lbPort) {
        $lbPort = $env:LB_HTTP_PORT
        if (-not $lbPort) { $lbPort = "8080" }
    }
    Write-Host "Done. API via LB: http://localhost:${lbPort}  |  logs: docker compose logs -f" -ForegroundColor Green
    if ($composeExit -ne 0 -or ($portLine -notmatch ':\d+')) {
        Write-Host "If the load balancer failed (e.g. port 8080 already in use), copy `.env.example` to `.env` and run again, or set LB_HTTP_PORT / LB_STUB_STATUS_PORT there. Check: docker compose logs load-balancer" -ForegroundColor DarkYellow
    }
    exit $composeExit
}

Write-Host "Building images..." -ForegroundColor Cyan
docker build -t pe-hackathon/url-shortener:latest ./url-shortener
docker build -t pe-hackathon/load-balancer:latest ./load-balancer
docker build -t pe-hackathon/dashboard:latest ./dashboard
docker build -t pe-hackathon/user-frontend:latest ./user-frontend

Write-Host "Applying Kubernetes manifests..." -ForegroundColor Cyan
kubectl apply -k k8s/

Write-Host "Done. Example: curl http://localhost:30880/health  |  see k8s/README.md for ports" -ForegroundColor Green
