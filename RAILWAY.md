# Railway (PE-Hackathon)

The Docker Compose stack is for **local** development. On [Railway](https://railway.com) you add **plugins** (Postgres, Redis) and **one service per deployable folder**, each linked to GitHub so **pushes to the default branch trigger deploys**.

## Quick setup

1. Install and log in: `npm i -g @railway/cli`, then `railway login`.
2. From the repo root, ensure the project is linked (this repo includes `.railway/config.json` for **PE-Hackathon**), or run `railway link -p PE-Hackathon`.
3. Run **`.\scripts\railway-provision.ps1`** (PowerShell). On Git Bash / WSL you can `pwsh ./scripts/railway-provision.ps1` if PowerShell is installed.
4. In the [Railway dashboard](https://railway.com/project/6b429b2a-8ef5-404a-aa8d-7c5091500077), open **each** Git-connected service and set **Root Directory** as printed by the script (`url-shortener`, `user-frontend`, `dashboard`, `dashboard/backend`).
5. Wire **variables**: from **Postgres** and **Redis**, use **Variable References** into `url-shortener` (e.g. `DATABASE_URL`, `RATE_LIMIT_STORAGE`). See the script output for the full list.
6. Accept the **Railway GitHub app** for `nathan-nw/PE-Hackathon-2026` if prompted so webhooks can trigger deploys.

`railway.toml` files under each app folder define Docker builds, health checks, and **watch paths** so changes in one folder do not rebuild unrelated services.

## What is not mirrored on Railway

Kafka, Zookeeper, the NGINX load balancer, Prometheus, Alertmanager, and `db-backup` are **not** provisioned by the script. The API and dashboard-backend run **without** Kafka unless you add a broker and set `KAFKA_*`. Use Railway’s **horizontal scaling** instead of duplicate API containers behind custom NGINX.

## dashboard_db

If `dashboard-backend` uses the same Postgres instance as the API, create a second database once (e.g. in Railway’s Postgres query UI): `CREATE DATABASE dashboard_db;` then set `DASHBOARD_DB_*` to match.
