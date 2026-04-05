# Capacity Plan

How many users can we handle, where the limits are, and how to scale beyond them.

---

## Current Architecture Limits

| Component | Configuration | Capacity |
|-----------|--------------|----------|
| NGINX | `worker_connections 2048`, `keepalive 32` | ~4,000+ concurrent connections |
| App Instances | 2 x Gunicorn (`2*CPU+1` workers each) | ~8-10 parallel request handlers |
| Redis | Redis 7, default config | ~100,000 ops/sec |
| PostgreSQL | `max_connections=100` (default) | ~100 concurrent queries |
| DB Connection Pool | 50 per instance x 2 instances | 100 pooled connections |

---

## Load Test Results

| Tier | Concurrent Users | p95 Latency | Avg Latency | Throughput | Error Rate | Status |
|------|-----------------|-------------|-------------|------------|------------|--------|
| Bronze | 50 | 93.78ms | 30.8ms | 164.83 req/s | <15% | Passed |
| Silver | 200 | 187.48ms | 47.67ms | 617.96 req/s | ~0% | Passed |
| Gold | 500 | 2,650ms | — | 268.66 req/s | 0.00% | Passed |

**Bronze note:** The ~15% error rate is from rate limiting/IP bans engaging, not application failures.

**Gold note:** p95 latency increased significantly at 500 users but error rate stayed at 0% — the system bends but doesn't break.

---

## Where Is the Bottleneck?

**PostgreSQL write throughput** is the ceiling. Every `POST /shorten` requires:

1. `SELECT` — check if short code exists
2. `SELECT` — validate user
3. `INSERT` url + `INSERT` event (inside a transaction)

Redis caching eliminates most **read** overhead (redirects and list queries hit cache), but **writes always hit the database**.

At 500 users, Postgres becomes saturated and latency spikes. The system still serves all requests (0% error rate) but response times degrade.

**Estimated ceiling: 500-1000 concurrent users** with the current 2-replica setup.

---

## Scaling Levers

What to pull when we need to handle more:

| Lever | Effort | Expected Gain |
|-------|--------|---------------|
| Add 2 more app containers | 5 min | ~2x write throughput |
| Switch Gunicorn to `gthread` workers | 10 min | ~2-3x concurrency per container |
| Add PgBouncer connection pooler | 30 min | Better connection utilization |
| Increase Postgres `max_connections` | 2 min | Higher connection ceiling |
| PostgreSQL read replicas | Hours | ~10x read throughput |
| Async event writes (task queue) | Hours | Decouple event inserts from request path |
| Database sharding | Days | Horizontal write scaling |

**Cheapest wins first:** More app containers + `gthread` workers would likely push the ceiling past 1,000 users with minimal effort.
