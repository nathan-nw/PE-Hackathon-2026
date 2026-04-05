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
   This sets **`feature-hosting`** as the deploy branch and **Root Directory** for **`url-shortener-a`**, **`url-shortener-b`**, **`load-balancer`**, `user-frontend`, `dashboard`, and `dashboard-backend` (same NGINX + two-replica layout as `docker-compose.yml`). Override with `RAILWAY_BRANCH` / `RAILWAY_REPO` if needed. Use `DRY_RUN=1` to print actions only.
5. **Internal DB / Redis references (optional):** with the same token, run:
   ```powershell
   $env:RAILWAY_API_TOKEN = "your-account-token"
   $env:SYNC_VARIABLES = "1"
   node setup-railway.js
   ```
   This upserts [variable references](https://docs.railway.com/reference/variables) aligned with **`docker-compose.yml`** (see **Parity with Docker Compose** below). Highlights: **`url-shortener-a`** / **`url-shortener-b`** get an explicit **`PORT=8080`** so Gunicorn and **`${{ url-shortener-a.PORT }}`** references stay aligned (Railway’s runtime-only `PORT` is not reliably referenceable from other services unless defined as a service variable). Local Docker Compose still uses the image default **`5000`**. They share `DATABASE_URL`, use `INSTANCE_ID` **1** and **2**, `KAFKA_LOG_TOPIC`, optional **`KAFKA_BOOTSTRAP_SERVERS`**, **`RATE_LIMIT_STORAGE`** from Redis or **`memory://`**. **`load-balancer`** gets **`URL_SHORTENER_A_HOST`** / **`URL_SHORTENER_B_HOST`** from each replica’s **`RAILWAY_PRIVATE_DOMAIN`**, plus **`URL_SHORTENER_A_PORT`** / **`URL_SHORTENER_B_PORT`** from **`${{ url-shortener-a.PORT }}`** / **`${{ url-shortener-b.PORT }}`**. **`dashboard-backend`**, **`dashboard`**, **`user-frontend`** as in the parity table; **`user-frontend`** `NEXT_PUBLIC_API_URL` points at the **load-balancer** public URL. Variable sync references **`Postgres.DATABASE_URL`** (private hostname) by default; set **`SYNC_VARIABLES_USE_PUBLIC_DATABASE_URL=1`** to use **`Postgres.DATABASE_PUBLIC_URL`** instead. Variable updates default to **`skipDeploys`**; set **`SKIP_DEPLOY_ON_VARIABLE_SYNC=0`** to trigger a deploy for each change.
6. In the [Railway dashboard](https://railway.com/project/6b429b2a-8ef5-404a-aa8d-7c5091500077), confirm **Root Directory** per service if anything still looks wrong (`url-shortener-a`, `url-shortener-b`, `load-balancer`, `user-frontend`, `dashboard`, `dashboard/backend`).
7. Wire **variables** manually if you did not run step 5: from **Postgres** and **Redis**, use **Variable References** into **`url-shortener-a`** and **`url-shortener-b`** (e.g. `DATABASE_URL`, `RATE_LIMIT_STORAGE`), and set **load-balancer** `URL_SHORTENER_*_HOST` to each API’s private hostname and **`URL_SHORTENER_A_PORT`** / **`URL_SHORTENER_B_PORT`** to `${{ url-shortener-a.PORT }}` / `${{ url-shortener-b.PORT }}` (same port Gunicorn listens on).
8. Accept the **Railway GitHub app** for `nathan-nw/PE-Hackathon-2026` if prompted so webhooks can trigger deploys.

`railway.toml` files under each app folder define Docker builds, health checks, and **watch paths** so changes in one folder do not rebuild unrelated services.

## Seed CSV data (production)

Migrations create tables; **`url-shortener/seed.py`** loads **`csv_data/*.csv`** (users, urls, events). Both API replicas share the same Postgres **`DATABASE_URL`**, so you only need to seed **once** (either service’s env is fine).

From the **repository root**, with the [Railway CLI](https://docs.railway.com/guides/cli) linked to this project:

```powershell
.\scripts\seed-railway.ps1
```

Git Bash / WSL / macOS / Linux:

```bash
./scripts/seed-railway.sh
```

The scripts read **`DATABASE_PUBLIC_URL`** from the **Postgres** plugin (not `railway run --service url-shortener-a`, which can inject an **empty** `DATABASE_URL` and make the app fall back to local `url-shortener/.env` / `127.0.0.1:15432`). Wire **`DATABASE_URL`** on the API services via **`SYNC_VARIABLES=1`** in `setup-railway.js` so deploys see the DB; seeding from your laptop still uses the Postgres public URL.

Equivalent manual command (after exporting a reachable `DATABASE_URL`, e.g. from the Postgres service variables):

```bash
uv run --directory url-shortener python seed.py --merge
```

(`uv run python seed.py` without `--directory` looks for `seed.py` in the **repo root**, which does not exist.)

`--merge` uses PostgreSQL **`ON CONFLICT DO NOTHING`** so repeats are safe. To wipe and reload: `uv run --directory url-shortener python seed.py --drop` (destructive). To skip if data already exists: add **`--if-empty`**.

If the API still returns **503** / “Database not reachable” after seeding, check **Postgres is running** and **`DATABASE_URL`** on **`url-shortener-a`** / **`url-shortener-b`** (run **`SYNC_VARIABLES=1 node setup-railway.js`** so the URL references **`Postgres.DATABASE_URL`** — private `postgres.railway.internal` — or **`Postgres.DATABASE_PUBLIC_URL`** with **`SYNC_VARIABLES_USE_PUBLIC_DATABASE_URL=1`** for the `junction.proxy.rlwy.net` proxy). The Flask and dashboard apps default **`sslmode=require`** for `*.railway.internal` and `*.rlwy.net` hosts when the URL omits `sslmode`; set **`PGSSLMODE`** or **`?sslmode=`** on the URL to override, or **`RAILWAY_DB_SSL_DISABLE=1`** for rare non-TLS cases.

## Parity with Docker Compose

| Compose service / env | Railway / `SYNC_VARIABLES=1` |
|----------------------|------------------------------|
| `db` → `hackathon_db` | Postgres plugin → `DATABASE_URL` on **url-shortener-a** and **url-shortener-b** |
| `dashboard-db` → `dashboard_db` | Same Postgres + `CREATE DATABASE dashboard_db` **or** a second Postgres plugin + `RAILWAY_DASHBOARD_POSTGRES_SERVICE_NAME` |
| Redis (not in default Compose) | Optional Redis plugin → `RATE_LIMIT_STORAGE`; if missing, `memory://` (matches local API default) |
| `kafka:9092` | Optional Kafka/Redpanda plugin → `KAFKA_BOOTSTRAP_SERVERS` (override variable name with `RAILWAY_KAFKA_BOOTSTRAP_VAR` if not `KAFKA_URL`) |
| `url-shortener-a` / `url-shortener-b` | Two Railway services from **`url-shortener/`** with `INSTANCE_ID=1` and `2` |
| `load-balancer` | **load-balancer** service → NGINX upstreams to both replicas. **Railway:** set `URL_SHORTENER_A_HOST` / `URL_SHORTENER_B_HOST` and ports from each API’s **`PORT`** (`SYNC_VARIABLES=1` uses **8080** for APIs). Compose hostnames like `url-shortener-a` **do not** exist on Railway. The container waits for `http://<host>:<port>/live` before starting nginx. |
| `prometheus` / `alertmanager` | Not provisioned; set Next.js **`NEXT_PUBLIC_*`** build args if you add metric UIs elsewhere |
| `kafka-log-consumer`, `db-backup`, Zookeeper | Not provisioned by the script |

## What is not mirrored on Railway

Kafka, Zookeeper, Prometheus, Alertmanager, and `db-backup` are **not** provisioned by the script. The API replicas and dashboard-backend run **without** Kafka unless you add a broker; `setup-railway.js` wires **`KAFKA_*`** when it detects a Kafka-like service. **`kafka-log-consumer`** is Compose-only unless you add a separate deploy.

## Migrating from a single `url-shortener` service

Older setups used one API service. This repo now expects **`url-shortener-a`**, **`url-shortener-b`**, and **`load-balancer`**. Add the new Git-linked services (or run `.\scripts\railway-provision.ps1` on a fresh project), then **`node setup-railway.js`**. Remove or disable the old **`url-shortener`** service to avoid duplicate deploys and confusion.

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
