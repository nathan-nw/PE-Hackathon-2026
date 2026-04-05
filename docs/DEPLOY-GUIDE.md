# Deploy Guide

How to get the app live and how to roll it back. Covers both **Docker Compose** (local/self-hosted) and **Railway** (cloud).

---

## Docker Compose (Local / Self-Hosted)

### First Deploy

```bash
# 1. Clone the repo
git clone https://github.com/nathan-nw/PE-Hackathon-2026.git
cd PE-Hackathon-2026

# 2. (Optional) Set Discord webhook for alerts
echo 'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...' > .env

# 3. Build and start everything
docker compose up -d --build

# 4. Wait for all services to be healthy
docker compose ps

# 5. Verify the app is responding
curl http://localhost:8080/health
```

The app auto-creates database tables and seeds a default user on first boot. No manual migration or seeding required.

### Updating (Zero-Downtime)

```bash
git pull origin main
docker compose up -d --build
```

NGINX stays up while the API containers rebuild and restart. The load balancer only routes to healthy containers (it waits for `/live` healthcheck).

### Rollback

```bash
# 1. Find the last known good commit
git log --oneline -10

# 2. Check out that commit
git checkout <commit-hash>

# 3. Rebuild from that version
docker compose up -d --build

# 4. Verify
curl http://localhost:8080/health
```

**If you tagged releases:**
```bash
git checkout v1.0.0
docker compose up -d --build
```

**Emergency rollback (data issue):**
```bash
# Restore database from automatic daily backup
docker compose run --rm db-backup /bin/sh -c "ls /backups"   # list available backups
# Then restore with pg_restore or psql into the db container
```

Daily backups are handled by the `db-backup` service (see `docker-compose.yml`), stored in the `pg_backups` volume with 7-day retention.

### Stopping / Resetting

```bash
# Stop everything (preserves data)
docker compose down

# Full reset — deletes all data volumes (databases, Redis, backups)
docker compose down -v
```

### Variant Deploys

```bash
# TLS mode (self-signed certs, HSTS on HTTPS)
docker compose -f docker-compose.yml -f docker-compose.tls.yml up --build -d

# HA edge (second NGINX instance on :8082)
docker compose -f docker-compose.yml -f docker-compose.ha.yml up --build -d
```

---

## Railway (Cloud)

Full Railway setup details: [infra/RAILWAY.md](infra/RAILWAY.md)

### First Deploy

```bash
# 1. Install Railway CLI
npm i -g @railway/cli
railway login

# 2. Link to the project
railway link -p PE-Hackathon

# 3. Provision services (Postgres, Redis, app replicas, LB, dashboard)
./scripts/railway-provision.ps1   # PowerShell
# or: pwsh ./scripts/railway-provision.ps1   # Git Bash / macOS

# 4. Set deploy branch and wire variables
export RAILWAY_API_TOKEN="your-account-token"
node setup-railway.js

# 5. Sync environment variables (DB URLs, Kafka, rate limiting)
SYNC_VARIABLES=1 node setup-railway.js

# 6. Seed the database
./scripts/seed-railway.sh         # macOS / Linux
# or: .\scripts\seed-railway.ps1  # PowerShell
```

Pushes to the `staging` branch auto-trigger deploys via Railway's GitHub integration.

### Updating

Push to the configured branch (default: `staging`). Railway auto-builds and deploys each service whose watched files changed.

```bash
git push origin staging
```

Each service has a `railway.toml` with **watch paths** so changes in one folder don't rebuild unrelated services.

### Rollback

**Option 1 — Railway Dashboard (fastest):**
1. Go to the [Railway project](https://railway.com/project/6b429b2a-8ef5-404a-aa8d-7c5091500077)
2. Click the service to roll back (e.g., `url-shortener-a`)
3. Go to **Deployments** tab
4. Find the last working deployment and click **Redeploy**
5. Repeat for any other affected services

**Option 2 — Git revert:**
```bash
# Revert the bad commit
git revert <bad-commit-hash>
git push origin staging
# Railway auto-deploys the reverted code
```

**Option 3 — Force deploy a specific commit:**
```bash
# Point the branch to a known good commit
git reset --hard <good-commit-hash>
git push --force origin staging
```

> **Note:** Force-pushing rewrites history. Only do this if the revert approach doesn't work.

---

## Pre-Deploy Checklist

- [ ] All tests pass: `uv run pytest -v`
- [ ] Linter clean: `uv run ruff check .`
- [ ] Health endpoints respond: `/live`, `/ready`, `/health`
- [ ] Environment variables set (see [Configuration Reference](DOCUMENTATION.md#configuration-reference))
- [ ] `.env` file has `DISCORD_WEBHOOK_URL` if alerts are needed

## Post-Deploy Verification

```bash
# Health check
curl http://localhost:8080/health

# Liveness (should return 200 instantly)
curl http://localhost:8080/live

# Readiness (verifies DB connection)
curl http://localhost:8080/ready

# Test a shorten request
curl -X POST http://localhost:8080/shorten \
  -H "Content-Type: application/json" \
  -d '{"original_url": "https://example.com", "user_id": 1}'

# Check all containers are healthy
docker compose ps
```

## What to Do When Things Go Wrong

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `502 Bad Gateway` | App containers not ready yet | Wait for healthchecks, or `docker compose restart url-shortener-a url-shortener-b` |
| `503 Database not reachable` | Postgres is down | `docker compose restart db`, wait for healthcheck |
| Containers stuck in `Exited` | Docker Desktop restart bug | `docker compose up -d url-shortener-a url-shortener-b` (see [ARCHITECTURE.md](ARCHITECTURE.md#if-a-replica-stays-exited-after-docker-kill)) |
| `429 Too Many Requests` | Rate limiter kicking in | Adjust `RATE_LIMIT_DEFAULT` in `docker-compose.yml` |
| Redis connection refused | Redis container down | `docker compose restart redis` — app degrades gracefully to direct DB queries |

For the full troubleshooting guide, see [DOCUMENTATION.md — Troubleshooting](DOCUMENTATION.md#troubleshooting-guide).
