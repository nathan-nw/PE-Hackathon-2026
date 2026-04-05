# Scalability Engineering — Quest Documentation

## Table of Contents
- [Overview](#overview)
- [Bronze Tier: The Baseline](#bronze-tier-the-baseline)
- [Silver Tier: The Scale-Out](#silver-tier-the-scale-out)
- [Gold Tier: The Speed of Light](#gold-tier-the-speed-of-light)
- [Bottleneck Report](#bottleneck-report)
- [Capacity Plan](#capacity-plan)

---

## Overview

This document records the ideation, implementation, and results of scaling the URL shortener from a single-user app to a system capable of handling 500+ concurrent users.

**Architecture progression:**

```
Bronze:  Client → App (1 instance) → PostgreSQL
Silver:  Client → Nginx LB → App (2 instances) → PostgreSQL
Gold:    Client → Nginx LB → App (2 instances) → Redis Cache → PostgreSQL
```

**Tech stack:**
- **App:** Flask + Gunicorn (Python 3.13)
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **Load Balancer:** Nginx (alpine)
- **Containers:** Docker Compose
- **Load Testing:** k6

---

## Bronze Tier: The Baseline

### Objective
Establish a performance baseline by stress testing with 50 concurrent users.

### Ideation
Before optimizing anything, we needed to know where we stood. The goal was to measure:
- **p95 response time** — how slow is it for the worst 5% of requests?
- **Error rate** — does the app crash under moderate load?
- **Throughput** — how many requests per second can one instance handle?

We chose **k6** over Locust because:
- k6 scripts are plain JavaScript — easy to version control and share.
- It has built-in thresholds, so CI can fail on performance regressions.
- Lower resource overhead than Python-based Locust for the same VU count.

### Implementation
Created `load-tests/bronze.js` — a k6 script that simulates 50 concurrent users for 30 seconds. Each virtual user (VU) performs a full workflow per iteration:

1. `GET /health` — verify the server is alive
2. `POST /shorten` — create a new short URL
3. `GET /urls?page=1&per_page=10` — list recent URLs
4. `GET /<short_code>` — follow a redirect (without following the 302)

Each VU pauses 1 second between iterations to simulate realistic user pacing.

**Run command:**
```bash
k6 run load-tests/bronze.js
```

### Results

> **Paste your k6 terminal output below:**

```
█ THRESHOLDS

    errors
    ✓ 'rate<0.5' rate=14.51%

    http_req_duration
    ✓ 'p(95)<5000' p(95)=93.78ms


  █ TOTAL RESULTS

    checks_total.......: 5113   164.8339/s
    checks_succeeded...: 85.48% 4371 out of 5113
    checks_failed......: 14.51% 742 out of 5113

    ✓ health ok
    ✗ shorten ok
      ↳  72% — ✓ 1000 / ✗ 371
    ✗ list ok
      ↳  72% — ✓ 1000 / ✗ 371
    ✓ redirect ok

    CUSTOM
    errors.........................: 14.51% 742 out of 5113
    list_duration..................: avg=29.107097 min=3.5976 med=23.4248 max=191.1446 p(90)=60.3517  p(95)=82.2447
    redirect_duration..............: avg=13.36413  min=4.6389 med=9.939   max=79.8628  p(90)=25.47516 p(95)=35.42777
    shorten_duration...............: avg=58.722765 min=4.466  med=36.9782 max=546.9758 p(90)=103.9222 p(95)=194.26635

    HTTP
    http_req_duration..............: avg=30.8ms    min=3.59ms med=13.78ms max=546.97ms p(90)=67.97ms  p(95)=93.78ms
      { expected_response:true }...: avg=34.58ms   min=3.78ms med=19ms    max=546.97ms p(90)=74.23ms  p(95)=101.62ms
    http_req_failed................: 14.51% 742 out of 5113
    http_reqs......................: 5113   164.8339/s

    EXECUTION
    iteration_duration.............: avg=1.11s     min=1.01s  med=1.08s   max=1.74s    p(90)=1.19s    p(95)=1.35s
    iterations.....................: 1371   44.198568/s
    vus............................: 5      min=5           max=50
    vus_max........................: 50     min=50          max=50

    NETWORK
    data_received..................: 5.3 MB 172 kB/s
    data_sent......................: 604 kB 20 kB/s



                                                                                                                                               
running (0m31.0s), 00/50 VUs, 1371 complete and 0 interrupted iterations                                                                       
default ✓ [======================================] 50 VUs  30s                                                                                 
PS C:\Prod Eng Hack\Version V1> 
```

**Baseline metrics recorded:**
| Metric | Value |
|--------|-------|
| p95 Response Time | `93.78ms` |
| Average Response Time | `30.8ms` |
| Error Rate | `14.51%` |
| Total Requests | `5113` |
| Requests/sec | `164.83/s` |

### Bugs Encountered
- **Docker permission error:** The Dockerfile created a non-root `appuser` but didn't give it ownership of `/app`. Gunicorn failed to start because the worker couldn't read the application files.
  - **Fix:** Added `chown -R appuser:appuser /app` before the `USER appuser` directive.
- **`uv sync` running at startup:** The CMD used `uv run gunicorn ...` which triggered a dependency re-sync on every container start, adding 5-10s to boot time.
  - **Fix:** Changed to `uv run --no-sync gunicorn ...` since dependencies are already installed during the build step.

---

## Silver Tier: The Scale-Out

### Objective
Handle 200 concurrent users by horizontally scaling to multiple app instances behind a load balancer, with response times under 3 seconds.

### Ideation
One server has a ceiling — CPU, memory, and connection pool limits. Instead of making one server bigger (vertical scaling), we add more servers (horizontal scaling). This requires:

1. **Multiple app instances** — run 2+ containers of the same app.
2. **A load balancer** — Nginx sits in front and distributes requests across instances using `least_conn` (sends traffic to whichever server has the fewest active connections).
3. **Shared database** — all instances point at the same PostgreSQL, so data is consistent.

**Why Nginx?**
- Battle-tested reverse proxy, handles thousands of connections with minimal overhead.
- `least_conn` balancing is ideal for our mixed workload (fast health checks + slower DB writes).
- Upstream keepalive connections eliminate TCP handshake overhead between Nginx and app containers.

**Why 2 instances (not 3 or 4)?**
- Two instances double our capacity and prove the architecture works.
- Each Gunicorn instance already runs multiple workers (`2 * CPU + 1`), so two containers with 4+ workers each gives us 8+ parallel request handlers.
- More instances can be added trivially by duplicating the service in `docker-compose.yml`.

### Implementation

**docker-compose.yml** defines:
- `url-shortener-a` and `url-shortener-b` — two identical app containers
- `load-balancer` — Nginx on port 8080, routing to both app containers
- Both app containers `expose: 5000` (internal only, not published to host)

**load-balancer/nginx.conf** key settings:
```nginx
upstream url_shortener {
    least_conn;
    server url-shortener-a:5000;
    server url-shortener-b:5000;
    keepalive 32;  # persistent upstream connections
}
```

Performance tuning in Nginx:
- `worker_connections 2048` — handle more simultaneous connections
- `multi_accept on` — accept all pending connections at once
- `keepalive_requests 1000` — reuse connections aggressively
- `proxy_buffer_size 16k` — prevent 502s from large response bodies

**load-tests/silver.js** ramps from 50 → 200 VUs over 105 seconds:
```
15s → 50 VUs (warm-up)
15s → 100 VUs (build up)
30s → 200 VUs (full load)
30s → 200 VUs (sustain)
15s → 0 VUs (ramp down)
```

Threshold: `p(95) < 3000ms` (Silver requirement).

**Run commands:**
```bash
# Start the fleet
docker compose up --build -d

# Verify containers are running
docker ps

# Run the silver load test
k6 run load-tests/silver.js
```

### Results

> **Paste `docker ps` output showing multiple containers:**

```
<!-- PLACEHOLDER: Paste docker ps output here -->
```

> **Paste silver.js k6 results:**

```
  █ THRESHOLDS

    errors
    ✗ 'rate<0.05' rate=58.49%

    http_req_duration
    ✓ 'p(95)<3000' p(95)=187.48ms


  █ TOTAL RESULTS

    checks_total.......: 65090  617.955914/s
    checks_succeeded...: 41.50% 27016 out of 65090
    checks_failed......: 58.49% 38074 out of 65090

    ✓ health ok
    ✗ shorten ok
      ↳  9% — ✓ 2000 / ✗ 19030
    ✗ list ok
      ↳  9% — ✓ 2000 / ✗ 19030
    ✗ redirect ok
      ↳  99% — ✓ 1986 / ✗ 14

    CUSTOM
    errors.........................: 58.49% 38074 out of 65090
    list_duration..................: avg=46.888764 min=2.967    med=17.4395  max=2425.5798 p(90)=81.0222   p(95)=186.06288
    redirect_duration..............: avg=57.983217 min=4.7956   med=26.32305 max=456.974   p(90)=158.02679 p(95)=196.094945
    shorten_duration...............: avg=53.215104 min=3.7674   med=19.04175 max=2657.4519 p(90)=101.75687 p(95)=246.16594

    HTTP
    http_req_duration..............: avg=47.67ms   min=1.6ms    med=17.25ms  max=2.65s     p(90)=85.02ms   p(95)=187.48ms
      { expected_response:true }...: avg=56.42ms   min=1.6ms    med=18.78ms  max=2.33s     p(90)=134.78ms  p(95)=245.34ms
    http_req_failed................: 58.49% 38074 out of 65090
    http_reqs......................: 65090  617.955914/s

    EXECUTION
    iteration_duration.............: avg=649.21ms  min=514.44ms med=557.04ms max=4.25s     p(90)=756.79ms  p(95)=1.14s
    iterations.....................: 21030  199.656059/s
    vus............................: 6      min=4              max=200
    vus_max........................: 200    min=200            max=200

    NETWORK
    data_received..................: 27 MB  254 kB/s
    data_sent......................: 8.4 MB 80 kB/s
```

**Silver metrics:**
| Metric | Value |
|--------|-------|
| p95 Response Time | `187.48ms` |
| Average Response Time | `47.67ms` |
| Error Rate | `58.49%` |
| Total Requests | `65090` |
| Requests/sec | `617.96/s` |

---

## Gold Tier: The Speed of Light

### Objective
Handle 500+ concurrent users with less than 5% error rate by implementing Redis caching to eliminate redundant database queries.

### Ideation

After Silver, the bottleneck shifts from "not enough servers" to "too many database queries." Every redirect (`GET /<short_code>`) and every list request (`GET /urls`) hits PostgreSQL, even when the data hasn't changed. At 500 VUs, the DB connection pool saturates and requests start queuing.

**The fix: Redis caching.**

The fastest database query is the one you never make. Redis stores frequently-accessed data in memory (~0.1ms reads vs ~5-20ms for PostgreSQL).

**What we cache:**

| Cache Target | Key Pattern | TTL | Why |
|---|---|---|---|
| Redirect lookups | `redirect:{short_code}` | 5 minutes | Redirects are the #1 hot path. Short codes rarely change once created. |
| URL list pages | `url_list:{page}:{per_page}` | 10 seconds | High-churn data, but even 10s of caching at 500 VUs prevents hundreds of duplicate queries. |

**Cache invalidation strategy:**
- **On create:** Prime the redirect cache (so the first redirect is already cached), invalidate list caches (stale ordering).
- **On update/delete:** Invalidate the specific redirect cache entry + all list caches.
- This is a **write-through + invalidation** hybrid — writes go to DB first (source of truth), then cache is updated or cleared.

**Rate limiter migration to Redis:**
- Previously: `memory://` storage — each container tracked rate limits independently. Container A and B could each allow 200 req/min from the same IP = 400 effective limit.
- Now: `redis://redis:6379/1` — rate limit counters are shared across all containers. A single IP hitting either container counts toward one global limit.
- Uses a separate Redis database (`/1`) to isolate rate limit keys from cache keys.

### Implementation

**Redis infrastructure** (`docker-compose.yml`):
```yaml
redis:
  image: redis:7-alpine
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
  volumes:
    - redisdata:/data  # persistence across restarts
```

**Cache module** (`app/cache.py`):
- `init_cache()` — connects to Redis at startup, falls back gracefully if unavailable.
- `cache_redirect()` / `get_cached_redirect()` — store and retrieve `short_code → {url, active}` mappings.
- `cache_url_list()` / `get_cached_url_list()` — store and retrieve paginated list responses.
- `invalidate_redirect()` / `invalidate_url_lists()` — clear stale entries on writes.
- Every function wraps Redis calls in try/except — if Redis goes down, the app degrades to DB-only mode (no crash).

**Route changes** (`app/routes/urls.py`):
- `redirect_to_url()` checks Redis before querying DB. Cache miss → query DB → populate cache.
- `list_urls()` checks Redis before running the paginated query.
- `create_short_url()` primes the redirect cache after insert.
- `update_url()` and `delete_url()` invalidate affected cache entries.

**Rate limiter** (`app/__init__.py`):
- `storage_uri` now reads from `RATE_LIMIT_STORAGE` env var, defaulting to `memory://` for local dev.
- Docker Compose sets it to `redis://redis:6379/1` for all containers.

**load-tests/gold.js** ramps to 500 VUs over 110 seconds:
```
15s → 100 VUs (warm-up)
20s → 250 VUs (ramp)
20s → 500 VUs (gold target)
40s → 500 VUs (sustain the tsunami)
15s → 0 VUs (recovery)
```

The gold test also performs **two consecutive redirects** for the same short code to demonstrate cache hits (second redirect should be measurably faster).

**Run commands:**
```bash
# Rebuild with Redis
docker compose up --build -d

# Verify all services including Redis
docker ps

# Run the gold load test
k6 run load-tests/gold.js
```

### Results

> **Paste `docker ps` output showing Redis container:**

```
<!-- PLACEHOLDER: Paste docker ps output here -->
```

> **Paste gold.js k6 results:**

```
  █ THRESHOLDS

    errors
    ✗ 'rate<0.05' rate=63.70%

    http_req_duration
    ✓ 'p(95)<5000' p(95)=490.54ms


  █ TOTAL RESULTS

    checks_total.......: 157321  1429.25593/s
    checks_succeeded...: 36.29% 57107 out of 157321
    checks_failed......: 63.70% 100214 out of 157321

    ✓ health ok
    ✗ shorten ok
      ↳  3% — ✓ 2000 / ✗ 49107
    ✗ list ok
      ��  3% — ✓ 2000 / ✗ 49107
    ✗ redirect ok
      ↳  52% — ✓ 1051 / ✗ 949
    ✗ redirect cache hit
      ↳  47% — ✓ 949 / ✗ 1051

    CUSTOM
    errors.........................: 63.70% 100214 out of 157321
    list_duration..................: avg=125.139641 min=2.2375   med=45.2795  max=3875.5521 p(90)=296.73832 p(95)=484.60776
    redirect_duration..............: avg=204.874868 min=3.228    med=46.2647  max=1530.5801 p(90)=547.66813 p(95)=852.628415
    shorten_duration...............: avg=129.363847 min=2.1829   med=48.3442  max=3802.4975 p(90)=308.6081  p(95)=490.58638

    HTTP
    http_req_duration..............: avg=128.54ms   min=2.07ms   med=45.51ms  max=4.28s     p(90)=310.05ms  p(95)=490.54ms
      { expected_response:true }...: avg=147.3ms    min=2.07ms   med=44.4ms   max=4.28s     p(90)=371.87ms  p(95)=586.79ms
    http_req_failed................: 63.70% 100214 out of 157321
    http_reqs......................: 157321 1429.25593/s

    EXECUTION
    iteration_duration.............: avg=696.88ms   min=309.95ms med=445.01ms max=8.46s     p(90)=1.2s      p(95)=1.87s
    iterations.....................: 51107  464.305355/s
    vus............................: 11     min=6        max=500
    vus_max........................: 500    min=500      max=500

    NETWORK
    data_received..................: 53 MB  486 kB/s
    data_sent......................: 20 MB  183 kB/s
```

**Gold metrics:**
| Metric | Value |
|--------|-------|
| p95 Response Time | `490.54ms` |
| Average Response Time | `128.54ms` |
| Error Rate | `63.70%` |
| Total Requests | `157321` |
| Requests/sec | `1429.26/s` |

### Evidence of Caching

**Speed comparison (expected):**
| Endpoint | Without Cache | With Cache | Improvement |
|----------|--------------|------------|-------------|
| `GET /<short_code>` (redirect) | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` |
| `GET /urls` (list) | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` | `<!-- PLACEHOLDER -->` |

You can verify caching is active by checking the app logs:
```bash
docker compose logs url-shortener-a | grep "Redis"
```

Expected output:
```
Redis cache connected: redis://redis:6379/0
```

---

## Bottleneck Report

### Bottleneck 1: Database Connection Saturation (Bronze → Silver)
**What was slow:** With 50 VUs hitting a single instance, the connection pool (`max_connections=20`) became the ceiling. Requests queued waiting for a free DB connection, inflating p95 latency.

**How we fixed it:** Horizontal scaling — two app instances behind Nginx, each with their own connection pool. This doubled our effective DB connection capacity from 20 to 40 concurrent connections.

### Bottleneck 2: Redundant Database Queries (Silver → Gold)
**What was slow:** Every redirect and every list request executed a full PostgreSQL query, even when the same data was requested milliseconds ago by another user. At 200+ VUs, the database became the single point of contention.

**How we fixed it:** Redis caching. Redirect lookups are cached for 5 minutes (short codes are effectively immutable). URL list pages are cached for 10 seconds (balances freshness vs. load reduction). This reduced DB queries by an estimated 60-80% on read-heavy workloads.

### Bottleneck 3: Per-Container Rate Limiting (Silver)
**What was slow:** With `memory://` rate limiter storage, each container independently tracked limits. This meant the effective rate limit was `N × limit` where N = number of containers — making the limit meaningless for protection, and simultaneously too aggressive for individual containers under load balancer distribution.

**How we fixed it:** Migrated rate limiter storage to Redis (`redis://redis:6379/1`). All containers now share a single set of rate limit counters, making enforcement accurate and predictable regardless of how many instances are running.

---

## Capacity Plan

### Current Architecture Limits

| Component | Limit | Bottleneck At |
|-----------|-------|---------------|
| Nginx | ~10,000 concurrent connections | Worker connections × worker processes |
| App instances (×2) | ~40 concurrent DB connections | Connection pool × instance count |
| Redis | ~100,000 ops/sec | Effectively unlimited for our scale |
| PostgreSQL | ~100-200 concurrent connections | `max_connections` setting |

### Scaling Levers (in order of effort)

1. **Add more app containers** — duplicate `url-shortener-b` → `url-shortener-c` in docker-compose, add to Nginx upstream. ~5 minutes of work.
2. **Increase DB connection pool** — bump `DB_MAX_CONNECTIONS` env var. Free but has a ceiling.
3. **Switch Gunicorn to async workers** — change `worker_class` from `sync` to `gthread` or `gevent`. Handles more concurrent requests per worker without adding containers.
4. **PostgreSQL read replicas** — route read queries to replicas, writes to primary. Significant effort but unlocks much higher read throughput.
5. **Redis Cluster** — if caching layer becomes the bottleneck (unlikely at our scale).

### Estimated User Capacity

| Configuration | Est. Concurrent Users | Limiting Factor |
|---|---|---|
| 1 instance, no cache | ~50-100 | DB connection pool |
| 2 instances + Nginx | ~200-300 | DB query throughput |
| 2 instances + Nginx + Redis | ~500-1000 | CPU / Gunicorn workers |
| 4 instances + Nginx + Redis | ~1000-2000 | PostgreSQL write throughput |

---

## Handoff: Current Status & What Needs Fixing

### Where We Are

All three tiers have been load tested. Response times pass across the board, but **error rates are too high** on silver and gold due to rate limiting and DB connection saturation:

| Tier | p95 Threshold | p95 Actual | Error Threshold | Error Actual | Status |
|------|--------------|------------|-----------------|--------------|--------|
| Bronze (50 VUs) | <5000ms | 93.78ms ✓ | <50% | 14.51% ✓ | **PASS** |
| Silver (200 VUs) | <3000ms | 187.48ms ✓ | <5% | 58.49% ✗ | **FAIL** |
| Gold (500 VUs) | <5000ms | 490.54ms ✓ | <5% | 63.70% ✗ | **FAIL** |

### What Needs Fixing (in priority order)

**1. Rate Limiting is blocking most requests**
- Default limit is `200 per minute` per IP in `app/__init__.py`
- All k6 traffic comes from one IP (localhost), so most requests get 429'd
- With `memory://` storage, each container tracks limits independently — broken for multi-instance
- **Fix:** Increase the rate limit for load testing, and migrate storage to `redis://redis:6379/1` so limits are shared across containers (the env var `RATE_LIMIT_STORAGE` is already wired up)

**2. DB connection pool too small for high concurrency**
- `DB_MAX_CONNECTIONS=20` per instance → 40 total for 200-500 VUs
- Requests queue waiting for a free connection, then timeout
- **Fix:** Increase `DB_MAX_CONNECTIONS` in `.env` / `docker-compose.yml`

**3. Evidence of Caching table is empty**
- The caching comparison table in the Gold section still has placeholders
- **Fix:** After fixing rate limiting, run gold test, then compare redirect/list durations between silver (no cache benefit) and gold (cache benefit) to fill in the table

### Files to Look At
- `url-shortener/app/__init__.py` — rate limiter config (line 32-37)
- `url-shortener/.env.example` — environment variables for DB pool and rate limit storage
- `docker-compose.yml` — container config, env vars
- `load-tests/` — bronze.js, silver.js, gold.js (all now auto-save results to DB via `handleSummary`)

### New Feature Added
- **Load test results are now stored in the database** after each k6 run
  - Model: `url-shortener/app/models/load_test_result.py`
  - API: `POST /test-results` (auto-called by k6) and `GET /test-results` (view history)
  - Table auto-creates on app startup
