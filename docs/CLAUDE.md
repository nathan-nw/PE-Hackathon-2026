# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
# Start everything (all services, builds images)
docker compose up -d --build

# Rebuild a single service
docker compose up --build <service-name> -d

# TLS mode (self-signed, HSTS)
docker-compose -f docker-compose.yml -f docker-compose.tls.yml up --build

# HA edge (second NGINX on 8082)
docker-compose -f docker-compose.yml -f docker-compose.ha.yml up --build
```

## Test Commands

```bash
# Install dev dependencies (from repo root)
uv sync --group dev

# Run all tests
uv run pytest -v

# Run a single test file
uv run pytest tests/url_shortener/routes/test_health.py -v

# Run tests matching a keyword
uv run pytest -k "test_shorten" -v

# Skip coverage (faster)
uv run pytest --no-cov

# Integration tests (requires docker compose up first)
export TEST_LOAD_BALANCER_URL=http://127.0.0.1:8080
export TEST_NGINX_STUB_STATUS_URL=http://127.0.0.1:8081/nginx_status
uv run pytest tests/integration -m integration -v
```

Tests use SQLite swapped in for PostgreSQL via fixtures in `tests/url_shortener/conftest.py`. Pytest config is in the root `pyproject.toml` with `pythonpath = ["url-shortener", "dashboard/backend"]`.

## Lint & Format

```bash
# From url-shortener/ or repo root
uv run ruff check .
uv run ruff format --check .

# Auto-fix
uv run ruff check --fix .
uv run ruff format .
```

Ruff is the sole linter/formatter. Config in `url-shortener/pyproject.toml`: Python 3.13, line-length 120, rules E/F/I/W/UP/B/SIM.

## Architecture

Two stateless Flask API replicas (`url-shortener-a`, `url-shortener-b`) behind an NGINX load balancer (`least_conn`). Both write to a shared PostgreSQL database via Peewee ORM and stream every HTTP request as JSON to a Kafka topic (`app-logs`).

```
Clients → NGINX LB (:8080) → url-shortener-a/b → PostgreSQL
                                    ↓ (Kafka: app-logs)
                    ┌───────────────┼────────────────┐
                    ↓               ↓                ↓
            kafka-log-consumer  dashboard-backend  discord-alerter
            (stdout printer)    (FastAPI cache+DB) (webhook alerts)
```

**Kafka consumers** each use their own consumer group so they all receive every message independently.

### Key services and ports

| Service | Port | Purpose |
|---------|------|---------|
| load-balancer | 8080, 8081 | API + NGINX stub_status |
| url-shortener-a/b | 5000 (internal) | Flask API replicas |
| db | 15432 | App PostgreSQL |
| kafka | 29092 (host) | Event streaming |
| prometheus | 9090 | Metrics |
| alertmanager | 9093 | Alert routing |
| dashboard | 3001 | Next.js ops UI |
| dashboard-backend | 8000 | FastAPI log cache API |
| dashboard-db | 15433 | Dashboard PostgreSQL |
| user-frontend | 3002 | Public URL shortening UI |

### URL shortener (Flask)

- App factory pattern in `url-shortener/app/__init__.py`
- Models: `app/models/` (User, Url, Event) using Peewee ORM with DatabaseProxy
- Routes: `app/routes/urls.py` — CRUD for short URLs
- Health probes: `/live` (liveness), `/ready` (DB reachable), `/health` (human-friendly)
- Metrics: `/metrics` (Prometheus text format)
- Circuit breaker: `app/circuit_breaker.py` wraps DB access
- Middleware: `app/middleware.py` adds request timing, request IDs (`X-Request-ID`), and Kafka logging
- Kafka producer: `app/kafka_logging.py` — custom logging.Handler, lazy-initialized, fire-and-forget

### Dashboard backend (FastAPI)

- `dashboard/backend/main.py` — lifespan starts Kafka consumer thread + DB flush loop
- `dashboard/backend/cache.py` — thread-safe LogCache (ring buffer, per-instance stats)
- `dashboard/backend/kafka_consumer.py` — consumes `app-logs`, feeds cache + alerter
- `dashboard/backend/discord_alerter.py` — Discord webhook alerts on 5xx/ERROR/CRITICAL

### Dashboard frontend (Next.js)

**Important:** The Next.js version in this project has breaking changes from standard Next.js. Read `node_modules/next/dist/docs/` before modifying dashboard frontend code. Heed deprecation notices.

## Branching

`feature/*` → `staging` → `main`. Never push directly to main. PRs must pass ruff + tests.

## Known Gotchas

- PostgreSQL sequences can desync after seed data imports. Fix with: `SELECT setval('<table>_id_seq', (SELECT MAX(id) FROM <table>));`
- Kafka consumers use `auto.offset.reset: latest` — they only see new messages, not historical
- Discord webhook calls require a custom `User-Agent` header or Cloudflare blocks them (error 1010)
- The `DISCORD_WEBHOOK_URL` env var goes in `.env` at repo root; docker-compose passes it through
- Tests require `uv sync --group dev` from repo root, not from url-shortener/
