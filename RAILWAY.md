# Railway (PE-Hackathon)

The Docker Compose stack is for **local** development. On [Railway](https://railway.com) you add **plugins** (Postgres, Redis) and **one service per deployable folder**, each linked to GitHub so **pushes to the configured branch** trigger deploys.

## Quick setup

1. Install and log in: `npm i -g @railway/cli`, then `railway login`.
2. From the repo root, ensure the project is linked (this repo includes `.railway/config.json` for **PE-Hackathon**), or run `railway link -p PE-Hackathon`.
3. Run **`.\scripts\railway-provision.ps1`** (PowerShell). On Git Bash / WSL you can `pwsh ./scripts/railway-provision.ps1` if PowerShell is installed.
4. **Deploy branch:** the CLI cannot set which Git branch deploys. After services exist, run from the repo root (requires [an account API token](https://railway.com/account/tokens), not a project-only token):
   ```powershell
   $env:RAILWAY_API_TOKEN = "your-account-token"
   node setup-railway.js
   ```
   This sets **`feature-hosting`** as the deploy branch and **Root Directory** for `url-shortener`, `user-frontend`, `dashboard`, and `dashboard-backend`. Override with `RAILWAY_BRANCH` / `RAILWAY_REPO` if needed. Use `DRY_RUN=1` to print actions only.
5. **Internal DB / Redis references (optional):** with the same token, run:
   ```powershell
   $env:RAILWAY_API_TOKEN = "your-account-token"
   $env:SYNC_VARIABLES = "1"
   node setup-railway.js
   ```
   This upserts [variable references](https://docs.railway.com/reference/variables) so **`url-shortener`** gets `DATABASE_URL` from **`${{ Postgres.DATABASE_PRIVATE_URL }}`** (private network), **`RATE_LIMIT_STORAGE`** from **`${{ Redis.REDIS_URL }}`**, **`dashboard-backend`** gets **`DASHBOARD_DATABASE_URL`** from the same private Postgres URL plus **`DASHBOARD_DB_NAME=dashboard_db`**, and **`dashboard`** gets **`DASHBOARD_BACKEND_URL=https://${{ dashboard-backend.RAILWAY_PUBLIC_DOMAIN }}`**. If your Postgres plugin does not expose `DATABASE_PRIVATE_URL`, set **`SYNC_VARIABLES_USE_PUBLIC_DATABASE_URL=1`** to use **`DATABASE_URL`** instead. Variable updates default to **`skipDeploys`** so you are not flooded with deploys; set **`SKIP_DEPLOY_ON_VARIABLE_SYNC=0`** to trigger a deploy for each change.
6. In the [Railway dashboard](https://railway.com/project/6b429b2a-8ef5-404a-aa8d-7c5091500077), confirm **Root Directory** per service if anything still looks wrong (`url-shortener`, `user-frontend`, `dashboard`, `dashboard/backend`).
7. Wire **variables** manually if you did not run step 5: from **Postgres** and **Redis**, use **Variable References** into `url-shortener` (e.g. `DATABASE_URL` → private URL, `RATE_LIMIT_STORAGE` → Redis).
8. Accept the **Railway GitHub app** for `nathan-nw/PE-Hackathon-2026` if prompted so webhooks can trigger deploys.

`railway.toml` files under each app folder define Docker builds, health checks, and **watch paths** so changes in one folder do not rebuild unrelated services.

## What is not mirrored on Railway

Kafka, Zookeeper, the NGINX load balancer, Prometheus, Alertmanager, and `db-backup` are **not** provisioned by the script. The API and dashboard-backend run **without** Kafka unless you add a broker and set `KAFKA_*`. Use Railway’s **horizontal scaling** instead of duplicate API containers behind custom NGINX.

## dashboard_db

If `dashboard-backend` uses the same Postgres instance as the API, create a second database once (e.g. in Railway’s Postgres query UI): `CREATE DATABASE dashboard_db;`. With **`SYNC_VARIABLES=1`**, `setup-railway.js` sets **`DASHBOARD_DATABASE_URL`** to the same private URL as the API and **`DASHBOARD_DB_NAME=dashboard_db`** so the app connects to that database (see `dashboard/backend/db.py`).

## If `railway add` says Unauthorized

1. Run the provision script in a **normal terminal** (outside restricted sandboxes), after `railway login`.
2. Or use a **token** (CI-style auth): in [Railway account tokens](https://railway.com/account/tokens), create a token, then in PowerShell:
   ```powershell
   $env:RAILWAY_TOKEN = "your-token-here"
   .\scripts\railway-provision.ps1
   ```
3. Or add resources **in the dashboard**: project **PE-Hackathon** → **New** → **Database** → PostgreSQL, then **New** → **Database** → Redis, then **New** → **GitHub Repo** → pick `nathan-nw/PE-Hackathon-2026` once per app and set **Root Directory** as in the table above. Pushes to the connected branch still trigger deploys.

Cursor’s integrated terminal (and some CI agents) can hit **Unauthorized** on mutating Railway calls even when `railway whoami` works; using a token or your own shell usually fixes it.
