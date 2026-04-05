# Seed production Postgres from url-shortener/csv_data.
# Uses the Postgres plugin's DATABASE_PUBLIC_URL so this works from your PC (internal *.railway.internal
# URLs are not reachable locally). If url-shortener-a has an empty DATABASE_URL, `railway run --service`
# would inject that empty string and block a real URL from url-shortener/.env — so we set DATABASE_URL
# in the shell and run uv directly.
#
# Prerequisites: npm i -g @railway/cli, railway login, railway link (repo root has .railway/config.json).
# Usage (repo root):
#   .\scripts\seed-railway.ps1
#   .\scripts\seed-railway.ps1 -PostgresService my-postgres
param(
    [string]$PostgresService = $env:RAILWAY_POSTGRES_SERVICE_NAME
)
if (-not $PostgresService) {
    $PostgresService = "Postgres"
}
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$pgVars = railway variable list --service $PostgresService --json | ConvertFrom-Json
$dbUrl = $pgVars.DATABASE_PUBLIC_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
    $dbUrl = $pgVars.DATABASE_URL
}
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
    Write-Error "No DATABASE_PUBLIC_URL or DATABASE_URL on Railway service '$PostgresService'. Add a PostgreSQL plugin or set RAILWAY_POSTGRES_SERVICE_NAME."
}
if ($dbUrl -match '\.railway\.internal') {
    Write-Warning "Database URL uses an internal Railway hostname; seeding from this machine may fail. Ensure DATABASE_PUBLIC_URL is set on the Postgres plugin or run from Railway's network."
}
if ($dbUrl -notmatch '[?&]sslmode=') {
    $sep = $(if ($dbUrl -match '\?') { '&' } else { '?' })
    $dbUrl = "${dbUrl}${sep}sslmode=require"
}
$env:DATABASE_URL = $dbUrl

uv run --directory url-shortener python seed.py --merge
