# URL Shortener — Project Documentation

## Table of Contents

### Bronze: The Map
- [Setup Instructions](#setup-instructions)
- [Architecture Diagram](#architecture-diagram)
- [API Documentation](#api-documentation)

### Silver: The Manual
- [Deployment Guide](#deployment-guide)
- [Troubleshooting Guide](#troubleshooting-guide)
- [Configuration Reference](#configuration-reference)

### Gold: The Codex
- [Runbooks](#runbooks)
- [Decision Log](#decision-log)
- [Capacity Plan](#capacity-plan)

---

# Bronze: The Map

## Setup Instructions

### Prerequisites
- **Docker Desktop** (v4.x+) — [Install](https://docs.docker.com/desktop/)
- **k6** (for load testing) — [Install](https://k6.io/docs/getting-started/installation/)
- **Git**

### Quick Start (Docker — recommended)

```bash
# 1. Clone the repo
git clone https://github.com/nathan-nw/mlh-pe-hackathon.git
cd "Prod Eng Hack/Version V1"

# 2. Start all services (PostgreSQL, Redis, 2 app instances, Nginx, frontends)
docker compose up --build -d

# 3. Verify everything is running
docker ps

# 4. Seed the database with sample data
docker compose exec url-shortener-a uv run --no-sync seed.py --drop

# 5. Open the app
#   - URL Shortener API:  http://localhost:8080
#   - Dashboard:          http://localhost:3001
#   - User Frontend:      http://localhost:3002
```

### Local Development (without Docker)

```bash
# 1. Navigate to the app directory
cd url-shortener

# 2. Copy the environment file
cp .env.example .env

# 3. Start PostgreSQL and Redis (via Docker, or local installs)
docker compose up db redis -d

# 4. Install dependencies
uv sync

# 5. Seed the database
uv run seed.py --drop

# 6. Run the dev server
uv run flask --app run:app run --debug --port 5000
```

### Running Load Tests

```bash
# Bronze: 50 concurrent users (baseline)
k6 run load-tests/bronze.js

# Silver: 200 concurrent users (scale-out)
k6 run load-tests/silver.js

# Gold: 500 concurrent users (with caching)
k6 run load-tests/gold.js

# Stress test: ramp from 50 → 500 (find the breaking point)
k6 run load-tests/stress.js
```

---

## Architecture Diagram

### Production Architecture (Gold Tier)

```
                    ┌─────────────────────────┐
                    │      Client / k6         │
                    └────────────���────────────┘
                                 │ :8080
                    ┌────────────▼────���───────┐
                    │     Nginx Load Balancer   │
                    │      (least_conn)         │
                    └─────┬──────────────┬─────┘
                          │              │
                ┌─────────▼───┐   ┌──────▼────────┐
                │  App Inst A  │   │  App Inst B    │
                │  (Gunicorn)  │   │  (Gunicorn)    │
                │  :5000       │   │  :5000         │
                └──┬───────┬──┘   └──┬───────┬────┘
                   │       │         │       │
          ┌────────▼───┐ ┌─▼─────────▼──┐    │
          │ PostgreSQL  │ │    Redis      │◄───┘
          │   :5432     │ │  :6379        │
          │ (persistent)│ │ /0 = cache    │
          │             │ │ /1 = rate lim │
          └──���──────────┘ └──────────────┘

    ┌──────────────┐    ┌───���──────────┐
    │  Dashboard    │    │ User Frontend │
    │  :3001        │    │  :3002        │
    └──────────────┘    └──────────────┘
```

### Data Flow: Redirect (Cache Hit)
```
Client → Nginx → App → Redis (HIT) → 302 Redirect
                        (no DB query)
```

### Data Flow: Redirect (Cache Miss)
```
Client �� Nginx → App → Redis (MISS) → PostgreSQL → App → Redis (SET) → 302 Redirect
```

### Data Flow: Create Short URL
```
Client → Nginx → App → PostgreSQL (INSERT) → Redis (prime cache + invalidate lists) → 201 Created
```

---

## API Documentation

**Base URL:** `http://localhost:8080`

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Returns service health including DB and circuit breaker status |

**Response (200):**
```json
{
  "status": "ok",
  "database": "ok",
  "circuit_breaker": {
    "name": "database",
    "state": "CLOSED",
    "failure_count": 0,
    "failure_threshold": 5,
    "recovery_timeout": 30
  }
}
```

**Response (503):** Database unreachable — `"status": "degraded"`

---

### Create Short URL

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/shorten` | Create a new shortened URL |

**Request Body:**
```json
{
  "original_url": "https://example.com/very-long-path",
  "user_id": 1,
  "title": "My Link",
  "short_code": "custom"  // optional — auto-generated if omitted
}
```

**Response (201):**
```json
{
  "id": 42,
  "user_id": 1,
  "short_code": "aB3kX9",
  "original_url": "https://example.com/very-long-path",
  "title": "My Link",
  "is_active": true,
  "created_at": "2026-04-04T12:00:00+00:00",
  "updated_at": "2026-04-04T12:00:00+00:00"
}
```

**Errors:**
- `400` — Missing `original_url` or `user_id`
- `404` — User not found
- `409` — Short code already exists

---

### List URLs (Paginated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/urls` | List all URLs, newest first |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `per_page` | int | 20 | Items per page (max 100) |

**Response (200):**
```json
{
  "data": [ /* array of URL objects */ ],
  "page": 1,
  "per_page": 20,
  "total": 150
}
```

---

### Get Single URL

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/urls/<id>` | Get a URL by its numeric ID |

**Response (200):** URL object
**Errors:** `404` — URL not found

---

### Update URL

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/urls/<id>` | Update a URL's properties |

**Request Body (all fields optional):**
```json
{
  "original_url": "https://new-destination.com",
  "title": "Updated Title",
  "is_active": false
}
```

**Response (200):** Updated URL object
**Errors:** `400` — No data, `404` — URL not found

---

### Delete URL (Soft Delete)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `DELETE` | `/urls/<id>` | Soft-delete a URL (sets `is_active=false`) |

**Response (200):**
```json
{ "message": "URL deleted (soft delete)" }
```

---

### Redirect

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/<short_code>` | Redirect to the original URL |

**Response:** `302 Redirect` to `original_url`
**Errors:** `404` — Short code not found, `410` — URL deactivated

---

### List User's URLs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/users/<user_id>/urls` | List all URLs for a specific user |

**Response (200):** Array of URL objects

---

### List URL Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/urls/<url_id>/events` | List audit events for a URL |

**Response (200):** Array of event objects (created, updated, deleted)

---

### Frontend Pages

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | HTML frontend (served by Flask) |

---

# Silver: The Manual

## Deployment Guide

### Production Deployment

```bash
# 1. Clone and enter the project
git clone <repo-url>
cd "Prod Eng Hack/Version V1"

# 2. Build and start all services
docker compose up --build -d

# 3. Wait for health checks to pass
docker compose ps  # all services should show "healthy" or "running"

# 4. Seed the database (first deploy only)
docker compose exec url-shortener-a uv run --no-sync seed.py --drop

# 5. Verify the app is responding
curl http://localhost:8080/health
```

### Updating (Zero-downtime)

```bash
# Pull latest code
git pull origin main

# Rebuild and restart (Nginx stays up while containers cycle)
docker compose up --build -d

# Verify
curl http://localhost:8080/health
```

### Rollback

```bash
# Option 1: Roll back to a specific commit
git log --oneline -10          # find the good commit
git checkout <commit-hash>     # switch to it
docker compose up --build -d   # rebuild from that version

# Option 2: If you tagged releases
git checkout v1.0.0
docker compose up --build -d
```

### Stopping Services

```bash
# Stop everything (preserves data volumes)
docker compose down

# Stop everything AND delete data (full reset)
docker compose down -v
```

---

## Troubleshooting Guide

### Problem: `502 Bad Gateway` from Nginx

**Cause:** App containers haven't started yet, or they crashed.
```bash
# Check if app containers are running
docker ps

# Check app logs for errors
docker compose logs url-shortener-a --tail 50
docker compose logs url-shortener-b --tail 50
```
**Fix:** Wait for health checks, or restart: `docker compose restart url-shortener-a url-shortener-b`

---

### Problem: `503 Database not reachable`

**Cause:** PostgreSQL isn't running or the app can't connect.
```bash
# Check if the DB container is healthy
docker ps | grep hackathon_db

# Check DB logs
docker compose logs db --tail 20

# Test connectivity from inside an app container
docker compose exec url-shortener-a python -c "from app.database import db; db.connect(); print('OK')"
```
**Fix:** `docker compose restart db` — then wait for the healthcheck to pass before restarting app containers.

---

### Problem: Docker build fails with permission errors

**Cause (actual bug we hit):** The Dockerfile created a non-root `appuser` but didn't give ownership of `/app`.
**Fix:** The Dockerfile now includes `chown -R appuser:appuser /app` before the `USER appuser` directive.

---

### Problem: Slow container startup (5-10s delay)

**Cause (actual bug we hit):** `uv run gunicorn ...` was triggering a dependency re-sync on every container start.
**Fix:** Changed CMD to `uv run --no-sync gunicorn ...` — dependencies are already installed at build time.

---

### Problem: `429 Too Many Requests` during load testing

**Cause:** Rate limiter is capping requests. Default is 1000/min per IP.
```bash
# Check current rate limit config
docker compose exec url-shortener-a env | grep RATE_LIMIT
```
**Fix:** Adjust `RATE_LIMIT_DEFAULT` in `docker-compose.yml` environment section. For aggressive load testing, temporarily set to `"10000 per minute"`.

---

### Problem: Redis connection refused

**Cause:** Redis container isn't running.
```bash
docker ps | grep redis
docker compose logs redis --tail 10
```
**Fix:** `docker compose restart redis`. The app degrades gracefully — it will fall back to direct DB queries if Redis is down. You'll see `"Redis unavailable — caching disabled"` in app logs.

---

### Problem: IPv6 / localhost issues on Windows

**Cause:** Windows resolves `localhost` to IPv6 `::1` but Docker Desktop publishes ports on IPv4 `127.0.0.1`.
**Fix:** The app's `database.py` already handles this — it converts `localhost` to `127.0.0.1` on Windows. For local `.env` files, always use `DATABASE_HOST=127.0.0.1`.

---

## Configuration Reference

### Environment Variables

#### Database
| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_NAME` | `hackathon_db` | PostgreSQL database name |
| `DATABASE_HOST` | `127.0.0.1` | Database host (use `db` in Docker Compose) |
| `DATABASE_PORT` | `5432` | Database port (use `15432` for local dev with Docker) |
| `DATABASE_USER` | `postgres` | Database username |
| `DATABASE_PASSWORD` | `postgres` | Database password |
| `DB_MAX_CONNECTIONS` | `20` | Max connections in the pool per app instance |
| `DB_STALE_TIMEOUT` | `300` | Seconds before a pooled connection is considered stale |
| `DB_TIMEOUT` | `10` | Seconds to wait for a connection from the pool |
| `DB_CONNECT_TIMEOUT` | `5` | Seconds to wait for initial TCP connection to Postgres |

#### Redis
| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis connection URL for caching (database 0) |

#### Rate Limiting
| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_DEFAULT` | `200 per minute` | Default rate limit per IP address |
| `RATE_LIMIT_STORAGE` | `memory://` | Rate limit backend (`memory://` for dev, `redis://redis:6379/1` for prod) |

#### Application
| Variable | Default | Description |
|----------|---------|-------------|
| `FLASK_DEBUG` | `false` | Enable Flask debug mode (never in production) |
| `LOG_LEVEL` | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

#### Gunicorn (Production Server)
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Port Gunicorn binds to |
| `GUNICORN_WORKERS` | `2 * CPU + 1` | Number of worker processes |
| `GUNICORN_TIMEOUT` | `30` | Worker timeout in seconds |
| `GUNICORN_MAX_REQUESTS` | `1000` | Restart worker after N requests (prevents memory leaks) |

### Ports Map

| Service | Internal Port | External Port | URL |
|---------|--------------|---------------|-----|
| Nginx (Load Balancer) | 80 | **8080** | `http://localhost:8080` |
| App Instance A | 5000 | — (internal) | — |
| App Instance B | 5000 | — (internal) | — |
| PostgreSQL | 5432 | **15432** | `localhost:15432` |
| Redis | 6379 | **6379** | `localhost:6379` |
| Dashboard | 80 | **3001** | `http://localhost:3001` |
| User Frontend | 80 | **3002** | `http://localhost:3002` |

---

# Gold: The Codex

## Runbooks

### Runbook: High Error Rate Alert (>5%)

**Trigger:** Load test or monitoring shows error rate exceeding 5%.

1. **Identify the error type:**
   ```bash
   docker compose logs url-shortener-a --tail 100 | grep -i error
   docker compose logs url-shortener-b --tail 100 | grep -i error
   ```

2. **Check service health:**
   ```bash
   curl http://localhost:8080/health
   ```

3. **If database errors:**
   ```bash
   docker compose logs db --tail 20
   docker compose restart db
   # Wait for healthcheck, then restart app instances
   docker compose restart url-shortener-a url-shortener-b
   ```

4. **If Redis errors (cache failures):**
   ```bash
   docker compose logs redis --tail 20
   docker compose restart redis
   ```
   Note: App continues to function without Redis (graceful degradation) — errors may indicate Redis was overwhelmed, not that the app is broken.

5. **If rate limit errors (429s):**
   - Check if load test is exceeding the configured limit.
   - Temporarily increase: edit `RATE_LIMIT_DEFAULT` in `docker-compose.yml` and run `docker compose up -d`.

6. **If connection pool exhaustion:**
   ```bash
   # Check active connections in PostgreSQL
   docker compose exec db psql -U postgres -d hackathon_db -c "SELECT count(*) FROM pg_stat_activity;"
   ```
   - If near `max_connections`: increase `DB_MAX_CONNECTIONS` or add more app instances.

---

### Runbook: Slow Response Times (p95 > 3s)

**Trigger:** Load test shows p95 latency exceeding 3 seconds.

1. **Check if Redis is caching:**
   ```bash
   docker compose logs url-shortener-a | grep "Redis cache connected"
   # Should see: "Redis cache connected: redis://redis:6379/0"
   ```

2. **Verify cache hits:**
   ```bash
   docker compose exec redis redis-cli INFO stats | grep keyspace_hits
   # keyspace_hits should be increasing
   ```

3. **Check Nginx upstream status:**
   ```bash
   docker compose logs load-balancer --tail 20
   ```

4. **Check DB query times:**
   - If `/urls` is slow: the URL list cache may have expired (10s TTL). This is expected during write-heavy tests.
   - If redirects are slow: check that `redirect:*` keys exist in Redis:
     ```bash
     docker compose exec redis redis-cli KEYS "redirect:*" | head -10
     ```

5. **Escalation:** Add more app instances or increase Gunicorn workers.

---

### Runbook: Container Restart Loop

**Trigger:** `docker ps` shows a container restarting repeatedly.

1. **Check the crash logs:**
   ```bash
   docker compose logs <service-name> --tail 50
   ```

2. **Common causes:**
   - Database not ready → app crashes on startup. Fix: the `depends_on: condition: service_healthy` should handle this. If not, restart the DB first.
   - Port conflict → another process is using the port. Fix: `docker compose down` then `docker compose up -d`.
   - Out of memory → Docker Desktop memory limit too low. Fix: increase in Docker Desktop Settings → Resources.

---

## Decision Log

### Why Redis?

**Decision:** Use Redis 7 as a caching layer and rate limiter backend.

**Alternatives considered:**
- **Memcached** — simpler, but lacks persistence. Redis can snapshot to disk (`redisdata` volume), so cache survives restarts.
- **Application-level caching (Python dict / LRU)** — zero infrastructure, but each container has its own cache. With 2+ instances behind a load balancer, user A might get a cache hit on container A but a miss on container B. Redis gives a single shared cache.
- **No cache** — simpler, but the Gold tier requires handling 500+ users. Without caching, every redirect and list query hits PostgreSQL, and the DB becomes the bottleneck.

**Why Redis won:** Shared cache across containers, sub-millisecond reads, built-in TTL expiry, and `flask-limiter` has native Redis support (so the rate limiter gets shared state for free).

---

### Why Nginx?

**Decision:** Use Nginx as the load balancer / reverse proxy.

**Alternatives considered:**
- **HAProxy** — excellent L4/L7 balancer, but more complex configuration for our needs.
- **Traefik** — auto-discovers Docker containers, but adds unnecessary complexity. We have a fixed number of upstream services.
- **Caddy** — great for auto-HTTPS, but we're running locally and don't need TLS termination.

**Why Nginx won:** Minimal config, battle-tested at massive scale, low resource usage, and `least_conn` balancing is ideal for our mixed read/write workload. The team already had familiarity with Nginx.

---

### Why `least_conn` Load Balancing?

**Decision:** Use `least_conn` instead of the default `round_robin`.

**Reasoning:** Our endpoints have very different response times — `/health` returns in <1ms, while `POST /shorten` involves a DB write (~10-50ms). Round-robin would blindly alternate, potentially sending many slow writes to one instance while the other is idle. `least_conn` sends each new request to whichever instance has fewer active connections, naturally balancing the load.

---

### Why Gunicorn with Sync Workers?

**Decision:** Use `sync` worker class (default) with `2 * CPU + 1` workers.

**Alternatives considered:**
- **`gthread`** — threaded workers, better for I/O-bound apps. Would increase concurrency per worker.
- **`gevent`** — async workers using greenlets. Highest concurrency, but requires all libraries to be gevent-compatible.

**Why sync won (for now):** Simplest, most debuggable. With 2 containers × ~5 workers each = ~10 parallel request handlers, which is sufficient for 500 VUs when Redis cache eliminates most DB queries. If we needed to scale further, `gthread` would be the next step.

---

### Why Soft Deletes?

**Decision:** `DELETE /urls/<id>` sets `is_active=false` instead of removing the row.

**Reasoning:** Hard deletes lose data permanently. Soft deletes allow recovery, audit trails (the `events` table records who deleted what), and the redirect endpoint can return a meaningful `410 Gone` instead of `404 Not Found`.

---

### Why Separate Redis Databases for Cache vs. Rate Limiter?

**Decision:** Cache uses `redis://redis:6379/0`, rate limiter uses `redis://redis:6379/1`.

**Reasoning:** If we ever need to flush the cache (e.g., after a major data migration), we can `FLUSHDB` on database 0 without resetting all rate limit counters. Conversely, if rate limits misbehave, we can flush database 1 without losing cached redirects. Isolation is cheap and prevents accidental cross-contamination.

---

## Capacity Plan

### Current Architecture

| Component | Configuration | Capacity |
|-----------|--------------|----------|
| Nginx | `worker_connections 2048`, `keepalive 32` | ~4,000+ concurrent connections |
| App Instances | 2 × Gunicorn (`2*CPU+1` workers each) | ~8-10 parallel request handlers |
| Redis | Default config, 7-alpine | ~100,000 ops/sec |
| PostgreSQL | `max_connections=100` (default) | ~100 concurrent queries |
| DB Connection Pool | 20 per instance × 2 instances | 40 pooled connections |

### Tested Capacity

| Tier | Concurrent Users | p95 Latency | Error Rate | Status |
|------|-----------------|-------------|------------|--------|
| Bronze | 50 | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` | Passed |
| Silver | 200 | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` |
| Gold | 500 | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` |

### Where Is the Limit?

**Current ceiling: ~500-1000 concurrent users** (estimated).

The limiting factor at maximum load is **PostgreSQL write throughput**. Every `POST /shorten` does:
1. Check if short code exists (`SELECT`)
2. Validate user (`SELECT`)
3. Insert URL + Insert event (inside a transaction)

Redis caching eliminates most read overhead, but writes must always hit the database.

### Scaling Beyond Current Limits

| Lever | Effort | Expected Gain |
|-------|--------|---------------|
| Add 2 more app containers | 5 min | ~2× write throughput |
| Switch to `gthread` workers | 10 min | ~2-3× concurrency per container |
| Increase DB `max_connections` | 2 min | Higher connection ceiling |
| PostgreSQL read replicas | Hours | ~10× read throughput |
| Async task queue for events | Hours | Decouple event writes from request path |
| Database connection pooler (PgBouncer) | 30 min | Better connection utilization |
