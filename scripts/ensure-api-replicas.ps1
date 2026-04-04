# Reconcile API replicas with docker-compose.yml (recovery when engine auto-restart fails on some hosts).
# From repo root:  .\scripts\ensure-api-replicas.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "Repo root: $root"
docker compose up -d url-shortener-a url-shortener-b
