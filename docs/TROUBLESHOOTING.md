# Troubleshooting

If X happens, try Y. Includes real bugs we hit during development and how we fixed them.

---

## Startup Issues

### Docker build seems stuck / no output

**Symptom:** Terminal hangs after `docker compose up --build`.

**Cause:** First build downloads large base images silently in detached mode.

**Fix:**
```bash
# See step-by-step build output
docker compose build --progress=plain
# Then start
docker compose up -d
# Follow logs
docker compose logs -f
```

---

### Containers keep restarting (crash loop)

**Symptom:** `docker compose ps` shows containers flapping between `Up` and `Restarting`.

**Fix:**
```bash
# Check what's crashing
docker compose logs url-shortener-a --tail 50

# Common causes:
# 1. DB not ready yet — wait for healthcheck
# 2. Missing env vars — check docker-compose.yml
# 3. Port conflict — another process on 8080/5432/6379
lsof -i :8080  # check what's using the port
```

---

### Container stays `Exited` after `docker kill`

**Symptom:** You killed a container for chaos testing and it didn't come back, even though `restart: always` is set.

**Cause:** Docker Desktop (especially on Windows) has a known bug where engine-level auto-restart is unreliable after `docker kill`.

**Fix:**
```bash
# Reconcile with Compose (most reliable)
docker compose up -d url-shortener-a url-shortener-b

# Or run the helper script
./scripts/ensure-api-replicas.sh       # macOS/Linux
.\scripts\ensure-api-replicas.ps1      # Windows
```

See [ARCHITECTURE.md](ARCHITECTURE.md#if-a-replica-stays-exited-after-docker-kill) for full details.

---

## Network & Connectivity

### `502 Bad Gateway` from NGINX

**Symptom:** Browser shows 502 when hitting `http://localhost:8080`.

**Cause:** App containers haven't started or have crashed. NGINX has no healthy upstream.

**Fix:**
```bash
# Check container status
docker compose ps

# Check app logs
docker compose logs url-shortener-a --tail 50
docker compose logs url-shortener-b --tail 50

# Restart the app replicas
docker compose restart url-shortener-a url-shortener-b
```

---

### `503 Database not reachable`

**Symptom:** API returns `{"error": "Database not reachable"}`.

**Cause:** PostgreSQL container is down or the app can't connect.

**Fix:**
```bash
# Check DB status
docker ps | grep hackathon_db
docker compose logs db --tail 20

# Restart DB and wait for healthcheck
docker compose restart db

# Test connectivity from inside the app
docker compose exec url-shortener-a python -c "from app.database import db; db.connect(); print('OK')"
```

---

### Redis connection refused

**Symptom:** App logs show Redis connection errors. Caching and rate limiting may not work.

**Cause:** Redis container isn't running.

**Fix:**
```bash
docker compose restart redis
```

The app degrades gracefully — it falls back to direct DB queries when Redis is down. You'll see `"Redis unavailable — caching disabled"` in logs.

---

## Real Bugs We Hit (and Fixed)

### DB connection leak in dashboard backend

**Symptom:** Dashboard backend gradually consumed all Postgres connections, then started returning 503s.

**Cause:** Database connections weren't being released in `finally` blocks. Functions in `dashboard/backend/db.py` opened connections but didn't close them on exceptions.

**Fix:** Wrapped all DB functions with `try/finally` to ensure connections are always returned to the pool. (Commit `57b7a7d`)

---

### Slow container startup (5-10s delay on every restart)

**Symptom:** Containers took 5-10 seconds longer than expected to start, even when nothing changed.

**Cause:** `uv run gunicorn ...` was triggering a full dependency re-sync on every container start, re-checking all packages.

**Fix:** Changed CMD to `uv run --no-sync gunicorn ...` — dependencies are already installed at build time, so the sync is unnecessary.

---

### Dockerfile permission errors (non-root user)

**Symptom:** Build succeeded but the container crashed immediately with permission denied errors.

**Cause:** The Dockerfile created a non-root `appuser` but didn't give it ownership of `/app`.

**Fix:** Added `chown -R appuser:appuser /app` before the `USER appuser` directive in the Dockerfile.

---

### Discord webhook blocked by Cloudflare (error 1010)

**Symptom:** Discord alerts silently failed. Dashboard-backend logs showed HTTP 1010 responses from Cloudflare.

**Cause:** Discord's CDN (Cloudflare) blocks requests without a proper `User-Agent` header.

**Fix:** Added a custom `User-Agent` header to all Discord webhook calls in `dashboard/backend/discord_alerter.py`.

---

### PostgreSQL sequence desync after seeding

**Symptom:** After importing seed data from CSV, new `INSERT` statements failed with duplicate key errors.

**Cause:** PostgreSQL auto-increment sequences weren't updated after bulk importing rows with explicit IDs.

**Fix:**
```sql
SELECT setval('<table>_id_seq', (SELECT MAX(id) FROM <table>));
```
Run this for `users`, `urls`, and `events` tables after any seed import.

---

### CI failing — missing Redis service container

**Symptom:** Tests passed locally but failed in GitHub Actions with Redis connection errors.

**Cause:** The CI workflow didn't include a Redis service container, but the app tried to connect to Redis during tests.

**Fix:** Added Redis service containers to both `ci.yml` and `tests.yml` GitHub Actions workflows. (Commit `9534774`)

---

### Tests not discovered by pytest

**Symptom:** `uv run pytest` found 0 tests.

**Cause:** Pytest couldn't find the test directory because `pythonpath` wasn't configured and `uv sync --group dev` was run from the wrong directory.

**Fix:**
1. Added `pythonpath = ["url-shortener", "dashboard/backend"]` to `pyproject.toml`
2. Always run `uv sync --group dev` from the **repo root**, not from `url-shortener/`

---

### IPv6 / localhost issues on Windows

**Symptom:** App can't connect to the database on Windows even though Postgres is running.

**Cause:** Windows resolves `localhost` to IPv6 `::1` but Docker Desktop publishes ports on IPv4 `127.0.0.1`.

**Fix:** The app's `database.py` converts `localhost` to `127.0.0.1` on Windows automatically. For local `.env` files, always use `DATABASE_HOST=127.0.0.1`.

---

### Kafka consumers miss all historical messages

**Symptom:** Started a Kafka consumer and it shows nothing, even though messages were produced earlier.

**Cause:** Consumers use `auto.offset.reset: latest` — they only see new messages, not historical ones.

**Fix:** This is by design. If you need historical messages, change `auto.offset.reset` to `earliest` in the consumer config. For the dashboard, this isn't needed since it also persists logs to the dashboard DB.

---

## Rate Limiting & Bans

### `429 Too Many Requests` during load testing

**Symptom:** Load tests hit rate limits and get 429 responses.

**Fix:**
```bash
# Check current rate limit
docker compose exec url-shortener-a env | grep RATE_LIMIT

# Option 1: Increase the limit in docker-compose.yml
# RATE_LIMIT_DEFAULT: "50000 per minute"

# Option 2: Use the load test bypass header
# k6 scripts already send X-Load-Test-Bypass which skips rate limiting
```

---

### Getting IP-banned during development

**Symptom:** All requests return `403` with "Your IP has been banned."

**Cause:** The rate limiter has an escalation system: warning -> 1-hour ban -> permanent ban.

**Fix:**
```bash
# Use the admin API to check/clear bans
curl http://localhost:8080/admin/bans

# Toggle ban enforcement off
curl -X POST http://localhost:8080/admin/bans/toggle

# Or restart the containers (bans are in-memory via Redis)
docker compose restart url-shortener-a url-shortener-b
```

---

## Dashboard Issues

### Log panel shows "Can't reach the log service"

**Symptom:** Ops dashboard log tab shows an error instead of logs.

**Cause:** `dashboard-backend` (FastAPI) is down or still starting.

**Fix:**
```bash
docker compose logs dashboard-backend --tail 20
docker compose restart dashboard-backend
```

The backend needs Kafka and dashboard-db to be healthy first. Check those if it keeps crashing.

---

### Dashboard shows stale/no data after Kafka restart

**Symptom:** Kafka was restarted and now the dashboard shows no new logs.

**Cause:** Kafka consumers need to reconnect (retry loop: 30 attempts, 2s apart). With `auto.offset.reset: latest`, messages produced during downtime are lost.

**Fix:** Wait ~60 seconds for reconnection. New messages will appear after the consumer reconnects. Historical data is still in the dashboard DB.

---

## Quick Reference

| Symptom | First thing to try |
|---------|-------------------|
| 502 Bad Gateway | `docker compose ps` then `docker compose restart url-shortener-a url-shortener-b` |
| 503 Database not reachable | `docker compose restart db` |
| Container won't restart | `docker compose up -d <service-name>` |
| 429 Rate limited | Increase `RATE_LIMIT_DEFAULT` or use bypass header |
| 403 IP banned | `curl -X POST http://localhost:8080/admin/bans/toggle` |
| No logs in dashboard | `docker compose restart dashboard-backend` |
| Redis errors | `docker compose restart redis` (app degrades gracefully) |
| Tests not found | Run `uv sync --group dev` from repo root, not url-shortener/ |
| Discord alerts failing | Check `DISCORD_WEBHOOK_URL` in `.env` and ensure `User-Agent` header is set |
| Duplicate key on insert | Run `SELECT setval(...)` to fix Postgres sequences after seed |
