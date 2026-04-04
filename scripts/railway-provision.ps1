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
    [string] $Repo = "nathan-nw/PE-Hackathon-2026"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Error "Railway CLI not found. Install: npm install -g @railway/cli"
}

railway whoami | Out-Null

Write-Host "Linking project if needed (PE-Hackathon)..." -ForegroundColor Cyan
if (-not (Test-Path ".railway\config.json")) {
    Write-Host "Run: railway link -p PE-Hackathon   (or commit .railway/config.json from this repo)" -ForegroundColor Yellow
}

Write-Host "Adding Postgres + Redis..." -ForegroundColor Cyan
railway add -d postgres -s Postgres
railway add -d redis -s Redis

Write-Host "Adding Git-connected services (auto-deploy when default branch updates)..." -ForegroundColor Cyan
railway add -s url-shortener -r $Repo
railway add -s user-frontend -r $Repo
railway add -s dashboard -r $Repo
railway add -s dashboard-backend -r $Repo

Write-Host @'

Done adding services.

Set Root Directory in the Railway dashboard for each Git-linked service:

  Service             Root Directory
  ------------------  ------------------
  url-shortener       url-shortener
  user-frontend       user-frontend
  dashboard           dashboard
  dashboard-backend   dashboard/backend

Recommended shared variables (use Railway Variable References from Postgres/Redis where possible):

  url-shortener:
    DATABASE_URL = ${{ Postgres.DATABASE_URL }}
    RATE_LIMIT_STORAGE = ${{ Redis.REDIS_URL }}
    INSTANCE_ID = 1
    FLASK_DEBUG = false

  dashboard-backend:
    DASHBOARD_DB_* from Postgres (create dashboard_db once), or a second Postgres plugin.
    Leave KAFKA_* unset (Kafka consumer stays off).

  dashboard:
    DASHBOARD_BACKEND_URL = <URL of dashboard-backend service>

Accept the Railway GitHub app for the repo if prompted (Settings -> Deploy -> GitHub).

'@ -ForegroundColor Green
