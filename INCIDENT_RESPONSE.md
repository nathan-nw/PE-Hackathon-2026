# Incident Response — Quest Documentation

## Table of Contents
- [Overview](#overview)
- [Bronze: Structured Logging & Metrics](#bronze-structured-logging--metrics)
- [Silver: Alerting & Response Pipeline](#silver-alerting--response-pipeline)
- [Gold: Golden Signals Dashboard & Sherlock Mode](#gold-golden-signals-dashboard--sherlock-mode)

---

## Overview

End-to-end observability stack: structured JSON logs stream through Kafka to a persistent dashboard, Prometheus scrapes application metrics, Alertmanager fires alerts to Discord, and a Golden Signals dashboard provides real-time SRE visibility.

```
Flask Replicas → /metrics (Prometheus scrape)
       ↓ (Kafka: app-logs)
  Kafka Consumer → LogCache → PostgreSQL
       ↓                         ↓
  Discord Alerter         Dashboard Backend API
  (5xx/ERROR/CRITICAL)         ↓
                         Next.js Dashboard
                    ┌──────────┼──────────┐
                    Logs    Errors    Golden Signals
                    Tab      Tab         Tab

Prometheus → Alert Rules (slo.yml) → Alertmanager → Discord
```

---

## Bronze: Structured Logging & Metrics

### Structured JSON Logging
Every HTTP request produces a structured JSON log entry via `KafkaLogHandler`:

```json
{
  "timestamp": "2026-04-05T12:34:56.789Z",
  "level": "INFO",
  "method": "GET",
  "path": "/abc123",
  "status_code": 302,
  "duration_ms": 4.2,
  "instance_id": "url-shortener-a",
  "request_id": "a1b2c3d4",
  "ip": "172.19.0.1",
  "logger": "url_shortener"
}
```

**Key files:** `url-shortener/app/middleware.py` (request timing + request IDs), `url-shortener/app/kafka_logging.py` (Kafka producer handler)

### Prometheus Metrics
Each Flask replica exposes `/metrics` in Prometheus text format:

| Metric | Type | Purpose |
|--------|------|---------|
| `http_requests_total` | Counter | Request count by method, endpoint, status_code |
| `http_request_duration_seconds` | Histogram | Latency distribution (p50/p95/p99) |

**Scrape config:** `prometheus/prometheus.yml` scrapes both replicas every 15s.

### Log Viewer (Dashboard → Logs Tab)
- Real-time log stream from Kafka → ring buffer + PostgreSQL persistence
- Filterable by level, instance, keyword search
- Merged view: combines in-memory buffer with DB for data that survives restarts
- **API:** `GET /api/logs?limit=100&level=ERROR&source=merged`

---

## Silver: Alerting & Response Pipeline

### Prometheus Alert Rules (`prometheus/rules/slo.yml`)

| Alert | Condition | Severity | For |
|-------|-----------|----------|-----|
| `High5xxRate` | >0.5 5xx/s over 5m | warning | 5m |
| `High429Rate` | >1 rate-limited/s over 5m | warning | 5m |
| `APITargetDown` | Prometheus can't scrape replica | critical | 2m |
| `HighLatencyP99` | p99 > 2s over 5m | warning | 10m |

### Dual Alert Paths

**Path 1: Kafka Consumer → Discord** (real-time, per-request)
- `discord_alerter.py` watches the Kafka stream
- Fires on any 5xx status or ERROR/CRITICAL log level
- Rate-limited to 1 message/second to respect Discord limits
- Latency: <2s from request to Discord notification

**Path 2: Prometheus → Alertmanager → Discord** (aggregated, rule-based)
- Alertmanager receives firing/resolved alerts from Prometheus
- `alertmanager.yml` routes to `http://dashboard-backend:8000/api/alertmanager-webhook`
- Dashboard-backend translates Alertmanager JSON → Discord embed format
- Critical alerts repeat every 15m; warnings every 1h
- Sends "resolved" notifications when alerts clear

### Error Monitor (Dashboard → Errors Tab)
- Per-minute error bucketing from PostgreSQL (survives restarts)
- Time-series graph showing error rate over 60-minute window
- Status code breakdown per bucket (400, 404, 429, 500, etc.)
- Summary stats: total errors, peak errors/min, current error rate
- Clear button to reset data between test runs
- **API:** `GET /api/errors?window_minutes=60&log_limit=100`

---

## Gold: Golden Signals Dashboard & Sherlock Mode

### Golden Signals (Dashboard → Telemetry Tab)

All four SRE golden signals on one screen, auto-refreshing every 15s:

| Signal | Source | PromQL / API |
|--------|--------|-------------|
| **Latency** | Prometheus histogram | `histogram_quantile(0.5/0.95/0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` |
| **Traffic** | Prometheus counter | `sum(rate(http_requests_total[1m])) by (status_code)` — stacked by 2xx/4xx/5xx |
| **Errors** | Prometheus counter | `sum(rate(http_requests_total{status_code=~"5.."}[1m]))` vs total |
| **Saturation** | Load Balancer `/api/instance-stats` | CPU %, memory %, thread count, load average per instance |

Each signal has:
- Mini SVG chart (30-minute window, 15s resolution)
- Current value + trend indicator
- Color-coded legend

### Sherlock Mode — Incident Diagnosis Walkthrough

> **Scenario:** During a Gold chaos test (500 VUs), the Error Monitor spiked to 40%+ error rate.

**Step 1: Detect** — Discord alert fires: `High5xxRate` from Alertmanager + per-request 5xx alerts from Kafka consumer. Error Monitor graph shows sharp spike.

**Step 2: Triage (Errors Tab)** — Status breakdown reveals mix of 429 (rate limit) and 500 (server error). 429s are expected under chaos load; 500s indicate a real problem.

**Step 3: Correlate (Telemetry Tab)**
- **Traffic**: Confirms VU ramp — request rate jumped from ~50/s to ~1400/s
- **Latency**: p99 climbed from 50ms to 2.6s — DB connection pool saturating
- **Saturation**: CPU spiked to 85% on both instances, thread count maxed out

**Step 4: Drill Down (Logs Tab)** — Filter `level=ERROR`, `instance_id=url-shortener-a`. Log entries show `peewee.OperationalError: connection pool exhausted` — confirms DB saturation as root cause.

**Step 5: Resolve** — Remediation options from runbooks (see `DOCUMENTATION.md → Runbooks`):
- Short-term: Increase `DB_MAX_CONNECTIONS`, restart affected containers
- Long-term: Redis caching (already implemented) reduces DB load by 60-80%

**Step 6: Verify** — After fix, Golden Signals show latency returning to baseline, error rate dropping to 0%, saturation normalizing. Alertmanager sends "resolved" notification to Discord.

### Runbook References

Detailed operational runbooks live in `DOCUMENTATION.md → Runbooks` section. Key procedures:
- **High Error Rate** — check Errors tab → identify status codes → check logs for stack traces → scale or restart
- **High Latency** — check Saturation tab → if CPU/memory high, scale horizontally → if DB, check connection pool
- **Instance Down** — Prometheus `APITargetDown` alert → check `docker ps` → restart container → verify via health endpoint

---

## Infrastructure Summary

| Component | Config File | Purpose |
|-----------|------------|---------|
| Prometheus | `prometheus/prometheus.yml` | Scrapes /metrics from Flask replicas |
| Alert Rules | `prometheus/rules/slo.yml` | 4 SLO-based alert rules |
| Alertmanager | `alertmanager/alertmanager.yml` | Routes alerts → Discord via webhook bridge |
| Discord Alerter | `dashboard/backend/discord_alerter.py` | Real-time Kafka-based 5xx/error alerts |
| Webhook Bridge | `dashboard/backend/main.py` → `/api/alertmanager-webhook` | Translates Alertmanager → Discord embeds |
| Dashboard Backend | `dashboard/backend/main.py` | FastAPI: logs, errors, stats, k6 runner |
| Dashboard Frontend | `dashboard/src/components/` | Next.js: Logs, Errors, Telemetry, Load Test tabs |

### How to Demo

```bash
# 1. Start everything
docker compose up --build -d

# 2. Open dashboard
open http://localhost:3001

# 3. Run a chaos load test from the Load Test tab (or CLI)
k6 run dashboard/backend/load-test.js -e PRESET=chaos

# 4. Watch in real-time:
#    - Errors Tab: error rate spike, status breakdown
#    - Telemetry Tab: latency/traffic/saturation correlation
#    - Discord: alert notifications arriving
#    - Alertmanager UI: http://localhost:9093

# 5. Stop the test → watch alerts resolve
```
