# Brief — URL Shortener Platform

A production-grade URL shortener with load balancing, observability, event streaming, and a real-time ops dashboard. Built for the PE Hackathon 2026.

## Quick Start

```bash
# Start everything (Postgres, Kafka, two API replicas, NGINX LB, dashboard, monitoring)
docker compose up -d --build

# Follow logs
docker compose logs -f

# Stop
docker compose down
```

That's it. The app auto-creates tables and seeds a default user on first boot.

**One-command scripts:** `./scripts/start.sh` (Mac/Linux/WSL) or `.\scripts\start.ps1` (Windows PowerShell).

### Access Points

| Service | URL |
|---------|-----|
| App (via load balancer) | http://localhost:8080 |
| Ops Dashboard | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |

## Architecture at a Glance

```
                            ┌──────────────────┐
                            │  Browser / curl   │
                            └────────┬─────────┘
                                     │
                         ┌───────────▼───────────┐
                         │  NGINX Load Balancer   │
                         │       :8080            │
                         └─────┬───────────┬─────┘
                               │           │
                    ┌──────────▼──┐   ┌────▼──────────┐
                    │ shortener-a │   │  shortener-b   │
                    │  (Flask)    │   │   (Flask)      │
                    └──┬───┬──┬──┘   └──┬───┬──┬──────┘
                       │   │  │         │   │  │
              ┌────────▼┐ ┌▼──▼─────┐ ┌─▼───▼┐ │
              │PostgreSQL│ │  Redis  │ │      │ │
              │  :15432  │ │  :6379  │ │      │ │
              └──────────┘ └────────┘  │ Kafka│◄┘
                                       │:29092│
                         ┌─────────────┼──────┤
                         │             │      │
                   ┌─────▼─────┐ ┌─────▼────┐ │
                   │  log-     │ │dashboard-│ │
                   │  consumer │ │ backend  │ │
                   │ (stdout)  │ │ (FastAPI)│ │
                   └───────────┘ └──┬────┬──┘ │
                                    │    │    │
                              ┌─────▼┐ ┌─▼────▼──────┐
                              │Dash  │ │   Discord    │
                              │DB    │ │   Webhooks   │
                              └──────┘ └─────────────┘

  Observability: Prometheus :9090 ──► Alertmanager :9093 ──► Discord
  Infra: compose-watchdog (auto-restart) · db-backup (daily pg_dump)
  Frontends: Dashboard :3001 · User UI :3002
```

Two stateless Flask replicas behind NGINX (`least_conn`). Every HTTP request streams to Kafka, consumed independently by the log consumer and dashboard-backend. Redis handles caching and rate limiting. Full Mermaid diagram in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project Structure

```
.
├── url-shortener/       # Flask API (app factory, Peewee ORM, circuit breaker)
├── load-balancer/       # NGINX config (load balancing, rate limiting)
├── dashboard/           # Ops dashboard — Next.js frontend + FastAPI backend
├── user-frontend/       # Public URL shortening UI (Next.js)
├── prometheus/          # Prometheus scrape config + alert rules
├── alertmanager/        # Alertmanager routing config
├── tests/               # Pytest suite (unit + integration)
├── load-tests/          # k6 load testing scripts
├── scripts/             # Start scripts, replica recovery, Railway deploy
├── k8s/                 # Kubernetes manifests
├── infra/               # Infrastructure configs
├── docs/                # All documentation (see below)
└── docker-compose.yml   # Full stack orchestration
```

## Documentation

Everything lives in [`docs/`](docs/):

```
docs/
├── ARCHITECTURE.md                # System diagram, health probes, how pieces connect
├── DOCUMENTATION.md               # Full setup, API endpoints, architecture deep-dive
├── TESTING.md                     # How to run unit, integration, and load tests
├── CONTRIBUTING.md                # Branching strategy, code standards
│
├── Track1Req/                     # Track 1 — Reliability
│   ├── FAILURE-MODES.md           #   What breaks, what happens, how to fix it
│   ├── error_handling.md          #   Graceful failure design
│   └── verification/              #   Bronze/Silver/Gold proof artifacts
│       ├── bronze/                #     CI, health checks, unit tests
│       ├── silver/                #     Integration tests, 50% coverage
│       └── gold/                  #     70% coverage, chaos testing, graceful fail
│
├── Track2Req/                     # Track 2 — Scalability
│   ├── bottleneck_analysis.md     #   Performance limits and capacity planning
│   ├── bronze_users.md            #   50-user load test results
│   ├── silver_users.md            #   200-user load test results
│   ├── gold_users.md              #   500-user load test results
│   ├── testing.md                 #   Load testing methodology
│   └── Verification/              #   Bronze/Silver/Gold proof artifacts
│       ├── Bronze/                #     50 users, latency/error baselines
│       ├── Silver/                #     200 users, load balancer, multi-instance
│       └── Gold/                  #     500 users, caching, <5% error rate
│
├── Track3Req/                     # Track 3 — Incident Response
│   ├── runbook.md                 #   Step-by-step incident response guide
│   ├── notifications_overview.md  #   Alerting pipeline overview
│   └── verification/              #   Bronze/Silver/Gold proof artifacts
│       ├── bronze/                #     Logs, metrics, dashboard
│       ├── silver/                #     Alert config, latency alerts, notifications
│       └── gold/                  #     Dashboard UI, root cause analysis
│
├── discord_alerting/              # Discord alert system
│   ├── alert_rules.md             #   What triggers alerts and why
│   ├── architecture_overview.md   #   Alerting pipeline architecture
│   ├── configuration_map.md       #   Config reference for alerting
│   └── live_demo.md               #   How to demo alerting live
│
├── url-shortener/                 # URL shortener internals
│   ├── architecture_overview.md   #   Service architecture
│   └── app/
│       ├── app_core_logic.md      #   App factory, middleware, circuit breaker
│       ├── models/
│       │   └── database_schema.md #   User, Url, Event models
│       └── routes/
│           └── api_endpoints.md   #   Full API endpoint reference
│
├── dashboard/                     # Ops dashboard docs
│   ├── dashboard_overview.md      #   Dashboard features and layout
│   ├── backend/
│   │   └── python_engine.md       #   FastAPI backend, Kafka consumer, cache
│   └── src/
│       └── nextjs_frontend.md     #   Next.js frontend components
│
├── infra/                         # Infrastructure
│   ├── RAILWAY.md                 #   Railway deployment guide
│   └── postgres/
│       └── replication-notes.md   #   Postgres replication setup
│
├── kafka/
│   └── kafka-streams.md           #   Event streaming pipeline docs
│
├── scripts/
│   └── scripts.md                 #   What each helper script does
│
└── user-frontend/
    └── user-frontend.md           #   Public UI docs
```

## Running Tests

```bash
# Install dev dependencies
uv sync --group dev

# Run all tests
uv run pytest -v

# Integration tests (requires docker compose up)
export TEST_LOAD_BALANCER_URL=http://127.0.0.1:8080
uv run pytest tests/integration -m integration -v
```

## Environment Variables

Key variables are configured in `docker-compose.yml` and `.env`:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
| `DISCORD_WEBHOOK_URL` | Discord alerts (set in `.env` at repo root) |
| `FLASK_ENV` | `production` or `development` |
| `INSTANCE_ID` | Replica identifier (`1` or `2`) |

## Variant Compose Files

```bash
# TLS mode (self-signed certs, HSTS)
docker compose -f docker-compose.yml -f docker-compose.tls.yml up --build

# HA edge (second NGINX on :8082)
docker compose -f docker-compose.yml -f docker-compose.ha.yml up --build
```
