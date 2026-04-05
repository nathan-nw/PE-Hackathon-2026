# Decision Log

Why we chose what we chose. Every major technical decision and the alternatives we considered.

---

### Why Flask?

**Decision:** Flask as the URL shortener API framework.

**Alternatives:** Django, FastAPI.

**Why Flask:** Lightweight, minimal boilerplate for a CRUD API. The app factory pattern (`create_app()`) gives clean testability. Peewee ORM integrates simply. FastAPI would add async complexity we don't need — our bottleneck is DB writes, not I/O concurrency. Django is overkill for a single-resource API.

---

### Why Peewee ORM?

**Decision:** Peewee over SQLAlchemy for database access.

**Why Peewee:** Simpler API for a small schema (3 models: User, Url, Event). `DatabaseProxy` makes it easy to swap SQLite for tests and Postgres for production. SQLAlchemy's session management adds complexity we didn't need.

---

### Why PostgreSQL?

**Decision:** PostgreSQL 16 as the primary database.

**Alternatives:** SQLite, MySQL.

**Why Postgres:** ACID transactions for URL creation + event logging in a single atomic block. Supports `ON CONFLICT` for safe idempotent seeding. Sequence-based auto-increment. Proven at scale. The `pg_isready` healthcheck integrates cleanly with Docker Compose.

---

### Why Redis?

**Decision:** Redis 7 as a caching layer and rate limiter backend.

**Alternatives:** Memcached (no persistence), in-process Python LRU cache (per-container, not shared), no cache.

**Why Redis:** Shared cache across both API containers — without it, container A and B have separate caches and users get inconsistent results. Sub-millisecond reads. Built-in TTL expiry. `flask-limiter` has native Redis support so rate limiting gets shared state for free. Cache survives container restarts via the `redisdata` volume.

---

### Why Separate Redis Databases (0 vs 1)?

**Decision:** Cache on `redis://redis:6379/0`, rate limiter on `redis://redis:6379/1`.

**Why:** If we need to flush the cache (e.g., after a data migration), `FLUSHDB` on database 0 won't reset rate limit counters. And vice versa. Isolation is free and prevents accidental cross-contamination.

---

### Why NGINX?

**Decision:** NGINX as the load balancer / reverse proxy.

**Alternatives:** HAProxy (more complex config), Traefik (auto-discovery adds unnecessary complexity for 2 fixed upstreams), Caddy (great for auto-HTTPS but we don't need TLS locally).

**Why NGINX:** Minimal config, battle-tested at massive scale, low resource usage. The team already had familiarity with it.

---

### Why `least_conn` Load Balancing?

**Decision:** `least_conn` instead of default `round_robin`.

**Why:** Our endpoints have very different response times — `/health` returns in <1ms, `POST /shorten` takes 10-50ms (DB write). Round-robin would blindly alternate, potentially queuing slow writes on one instance while the other is idle. `least_conn` sends each request to whichever instance has fewer active connections.

---

### Why Kafka?

**Decision:** Kafka for streaming HTTP request logs from the API to consumers.

**Alternatives:** Direct HTTP POST to dashboard-backend, write logs to Postgres directly, stdout-only logging.

**Why Kafka:** Decouples producers (Flask replicas) from consumers (log printer, dashboard-backend, discord alerter). Each consumer uses its own consumer group so they all receive every message independently. The API never blocks on log delivery — Kafka producer is fire-and-forget. If a consumer dies, messages are retained in the topic until it recovers.

---

### Why Gunicorn with Sync Workers?

**Decision:** `sync` worker class with `2 * CPU + 1` workers.

**Alternatives:** `gthread` (threaded, better I/O concurrency), `gevent` (async greenlets, highest concurrency but requires compatible libraries).

**Why sync:** Simplest and most debuggable. With 2 containers x ~5 workers = ~10 parallel handlers, which handles 500 VUs when Redis cache eliminates most DB reads. `gthread` would be the next step if we needed more.

---

### Why Soft Deletes?

**Decision:** `DELETE /urls/<id>` sets `is_active=false` instead of removing the row.

**Why:** Hard deletes lose data permanently. Soft deletes allow recovery, audit trails (the `events` table records who deleted what), and the redirect endpoint returns `410 Gone` instead of a confusing `404`.

---

### Why Two Separate Postgres Instances?

**Decision:** App DB (`db:15432`) and dashboard DB (`dashboard-db:15433`) are separate containers.

**Why:** The dashboard-backend writes high-volume log data (every HTTP request). Keeping it in a separate database prevents log table bloat from affecting API query performance. Either DB can be restarted independently without taking down the other.

---

### Why Docker Compose Watchdog?

**Decision:** Custom `compose-watchdog` service that polls Docker API and restarts crashed containers.

**Why:** Docker Desktop's `restart: always` policy is unreliable after `docker kill` on some platforms (known Docker Desktop bug). The watchdog provides a reliable self-healing layer that works consistently across Mac, Windows, and Linux. It also exposes an HTTP status endpoint for the dashboard's Chaos tab.

---

### Why Circuit Breaker on DB Access?

**Decision:** Custom circuit breaker (`app/circuit_breaker.py`) wrapping database operations.

**Why:** Without it, a Postgres outage causes every request to hang waiting for a DB timeout (5-10s), then fail. The circuit breaker trips after 5 consecutive failures and immediately returns 503 for 30 seconds, then tests one request (half-open). This means: faster failure response, less load on a struggling DB, and automatic recovery when the DB comes back.

---

### Why Discord for Alerts?

**Decision:** Discord webhooks for alert notifications instead of PagerDuty/Slack/email.

**Why:** Zero cost, zero setup beyond creating a webhook URL. The team already uses Discord. Webhook API is simple (single POST). Good enough for a hackathon — in production you'd swap for PagerDuty or Opsgenie.

---

## Summary

| Choice | Why | Over |
|--------|-----|------|
| Flask | Lightweight, app factory pattern | Django, FastAPI |
| Peewee | Simple ORM for 3 models | SQLAlchemy |
| PostgreSQL | ACID, `ON CONFLICT`, proven | SQLite, MySQL |
| Redis | Shared cache + rate limiter | Memcached, in-process cache |
| NGINX | Minimal config, `least_conn` | HAProxy, Traefik, Caddy |
| Kafka | Decoupled async log streaming | Direct HTTP, DB writes |
| Gunicorn sync | Simple, debuggable, sufficient | gthread, gevent |
| Soft deletes | Audit trail, `410 Gone` | Hard deletes |
| Circuit breaker | Fast failure, auto-recovery | Raw timeouts |
| Discord | Free, simple, team uses it | PagerDuty, Slack |
