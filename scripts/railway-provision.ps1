#Requires -Version 5.1
<#
  Provisions Railway services for PE-Hackathon (databases + GitHub-linked app services).
  Run from the repo root after: railway login
  Repo: https://github.com/nathan-nw/PE-Hackathon-2026 (override with -Repo)

  Railway does not run docker-compose as one unit. This script adds:
    - Postgres + Redis plugins
    - url-shortener, user-frontend, dashboard, dashboard-backend (each linked to GitHub for auto-deploy on push)

  After it finishes, open each service in the Railway UI and set:
    - Settings -> Root Directory (see table below)
    - Settings -> Config-as-code path to the matching railway.toml (optional; speeds up detection)
    - Variables / References (Postgres + Redis -> url-shortener, etc.)

  Compose-only pieces (Kafka, Zookeeper, NGINX LB, Prometheus, Alertmanager, db-backup) are not cloned here;
  use Railway scaling + managed datastores instead, or keep running those locally.
#>
param(
    [string] $Repo = "nathan-nw/PE-Hackathon-2026",
    # Railway CLI cannot set the Git deploy branch; use: node setup-railway.js (see RAILWAY.md).
    [string] $Branch = "feature-hosting"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Error "Railway CLI not found. Install: npm install -g @railway/cli"
}

railway whoami | Out-Null

if (-not $env:RAILWAY_TOKEN) {
    Write-Host "Tip: If `railway add` returns Unauthorized, set `$env:RAILWAY_TOKEN from https://railway.com/account/tokens or run outside Cursor. See RAILWAY.md." -ForegroundColor DarkYellow
}

Write-Host "Linking project if needed (PE-Hackathon)..." -ForegroundColor Cyan
if (-not (Test-Path ".railway\config.json")) {
    Write-Host "Run: railway link -p PE-Hackathon   (or commit .railway/config.json from this repo)" -ForegroundColor Yellow
}

function Invoke-RailwayCli {
    param([string[]] $CmdArgs)
    & railway @CmdArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Railway command failed: railway $($CmdArgs -join ' '). If you see Unauthorized, set RAILWAY_TOKEN or use the dashboard (RAILWAY.md)."
    }
}

Write-Host "Adding Postgres + Redis..." -ForegroundColor Cyan
Invoke-RailwayCli @("add", "--database", "postgres", "--service", "Postgres")
Invoke-RailwayCli @("add", "--database", "redis", "--service", "Redis")

Write-Host "Adding Git-connected services (auto-deploy when default branch updates)..." -ForegroundColor Cyan
Invoke-RailwayCli @("add", "--service", "url-shortener", "--repo", $Repo)
Invoke-RailwayCli @("add", "--service", "user-frontend", "--repo", $Repo)
Invoke-RailwayCli @("add", "--service", "dashboard", "--repo", $Repo)
Invoke-RailwayCli @("add", "--service", "dashboard-backend", "--repo", $Repo)

Write-Host "Deploy branch: CLI cannot set it — use: `$env:RAILWAY_API_TOKEN = <token>; node setup-railway.js (default branch $Branch). See RAILWAY.md." -ForegroundColor Cyan

Write-Host @'

Done adding services.

Set Root Directory in the Railway dashboard for each Git-linked service (or run setup-railway.js to set via API):

  Service             Root Directory
  ------------------  ------------------
  url-shortener       url-shortener
  user-frontend       user-frontend
  dashboard           dashboard
  dashboard-backend   dashboard/backend

Recommended shared variables (automated: `$env:SYNC_VARIABLES = '1'; node setup-railway.js` — see RAILWAY.md):

  url-shortener:
    DATABASE_URL = ${{ Postgres.DATABASE_PRIVATE_URL }}   (internal; or DATABASE_URL if you set SYNC_VARIABLES_USE_PUBLIC_DATABASE_URL=1)
    RATE_LIMIT_STORAGE = ${{ Redis.REDIS_URL }}
    INSTANCE_ID = 1
    FLASK_DEBUG = false

  dashboard-backend:
    DASHBOARD_DATABASE_URL = ${{ Postgres.DATABASE_PRIVATE_URL }}
    DASHBOARD_DB_NAME = dashboard_db
    (Create database dashboard_db once in Postgres — RAILWAY.md.)
    Leave KAFKA_* unset (Kafka consumer stays off).

  dashboard:
    DASHBOARD_BACKEND_URL = https://${{ dashboard-backend.RAILWAY_PUBLIC_DOMAIN }}

  user-frontend (optional):
    NEXT_PUBLIC_API_URL = https://${{ url-shortener.RAILWAY_PUBLIC_DOMAIN }}

Accept the Railway GitHub app for the repo if prompted (Settings -> Deploy -> GitHub).

'@ -ForegroundColor Green
