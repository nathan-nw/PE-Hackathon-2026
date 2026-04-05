# Configuration Reference

All environment variables needed to run the stack. Defaults are set in `docker-compose.yml` — you only need a `.env` file at the repo root for secrets like `DISCORD_WEBHOOK_URL`.

## URL Shortener (Flask API)

| Variable | Default | Description |
|----------|---------|-------------|
| `INSTANCE_ID` | `1` | Replica identifier (used in metrics and logs) |
| `DATABASE_NAME` | `hackathon_db` | PostgreSQL database name |
| `DATABASE_HOST` | `db` | Database host (`127.0.0.1` for local dev without Docker) |
| `DATABASE_PORT` | `5432` | Database port (mapped to `15432` on host) |
| `DATABASE_USER` | `postgres` | Database username |
| `DATABASE_PASSWORD` | `postgres` | Database password |
| `DB_MAX_CONNECTIONS` | `50` | Max connections per app instance |
| `REDIS_URL` | `redis://redis:6379/0` | Redis for caching (database 0) |
| `RATE_LIMIT_STORAGE` | `redis://redis:6379/1` | Redis for rate limiting (database 1) |
| `RATE_LIMIT_DEFAULT` | `50000 per minute` | Rate limit per IP |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | Kafka broker for request logging |
| `FLASK_DEBUG` | `false` | Debug mode (never enable in production) |
| `LOAD_TEST_BYPASS_TOKEN` | `pe-hackathon-k6-edge-bypass` | Header token to skip rate limiting during load tests |

## Dashboard Backend (FastAPI)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Port the FastAPI server binds to |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | Kafka broker address |
| `KAFKA_LOG_TOPIC` | `app-logs` | Kafka topic to consume |
| `CACHE_MAX_ENTRIES` | `1000` | In-memory log ring buffer size |
| `DB_FLUSH_INTERVAL` | `30` | Seconds between flushing logs to DB |
| `DASHBOARD_DB_NAME` | `dashboard_db` | Dashboard database name |
| `DASHBOARD_DB_HOST` | `dashboard-db` | Dashboard database host |
| `DASHBOARD_DB_PORT` | `5432` | Dashboard database port (mapped to `15433` on host) |
| `DASHBOARD_DB_USER` | `postgres` | Dashboard database username |
| `DASHBOARD_DB_PASSWORD` | `postgres` | Dashboard database password |
| `INTROSPECT_DB_URL` | `postgresql://postgres:postgres@db:5432/hackathon_db` | App DB URL for Ops tab introspection |
| `DISCORD_WEBHOOK_URL` | _(empty)_ | Discord webhook for alerts (set in `.env`) |

## Dashboard Frontend (Next.js)

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_BACKEND_URL` | `http://dashboard-backend:8000` | FastAPI backend URL |
| `VISIBILITY_COMPOSE_PROJECT` | `pe-hackathon-2026` | Docker Compose project filter |
| `VISIBILITY_ALERTMANAGER_URL` | `http://alertmanager:9093` | Alertmanager internal URL |
| `VISIBILITY_PROMETHEUS_URL` | `http://prometheus:9090` | Prometheus internal URL |
| `WATCHDOG_STATUS_URL` | `http://compose-watchdog:8099` | Watchdog status endpoint |
| `CHAOS_KILL_ENABLED` | `1` | Enable chaos kill from dashboard (`0` to disable) |
| `NEXT_PUBLIC_PROMETHEUS_URL` | `http://localhost:9090` | Prometheus URL for browser links (build-time) |
| `NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL` | `http://localhost:9093` | Alertmanager URL for browser links (build-time) |

## Load Balancer (NGINX)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOAD_TEST_BYPASS_TOKEN` | `pe-hackathon-k6-edge-bypass` | Bypass edge rate limiting for load tests |

## Host Port Overrides (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `LB_HTTP_PORT` | `8080` | Load balancer HTTP port on host |
| `LB_STUB_STATUS_PORT` | `8081` | NGINX stub_status port on host |
| `WATCHDOG_HTTP_PUBLISH` | `8099` | Watchdog HTTP port on host |
| `DISCORD_WEBHOOK_URL` | _(none)_ | Discord webhook — set this in `.env` at repo root |

## Watchdog

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPOSE_PROJECT` | `pe-hackathon-2026` | Docker Compose project to monitor |
| `WATCHDOG_INTERVAL_SEC` | `15` | Seconds between health polls |
| `WATCHDOG_EXCLUDE_SERVICES` | _(empty)_ | Comma-separated services to skip |
