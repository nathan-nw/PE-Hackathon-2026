# Kafka Streams

## Overview

The project uses Kafka as a centralized log aggregation system. Two URL-shortener instances produce logs to a single Kafka topic, and two consumers process them downstream.

## Data Flow

```
URL-Shortener (instance a & b)
    -> Kafka topic "app-logs"
        |-> kafka-log-consumer (prints color-coded logs to stdout)
        |-> dashboard-backend (caches in memory + persists to PostgreSQL)
```

## What Gets Logged

Every HTTP request produces a JSON message to the `app-logs` topic. The payload looks like:

```json
{
  "timestamp": "2026-04-04T10:00:00Z",
  "level": "INFO",
  "logger": "app.middleware",
  "message": "GET /shorten -> 201",
  "instance_id": "1",
  "request_id": "abc123",
  "trace_id": "abc123",
  "method": "GET",
  "path": "/shorten",
  "status_code": 201,
  "duration_ms": 42.5,
  "exc_info": null
}
```

Key fields:

- **instance_id** — which replica (1 or 2) produced the log
- **request_id / trace_id** — for correlating logs across services, propagated via `X-Request-ID` header
- **method, path, status_code, duration_ms** — full HTTP request context
- **exc_info** — stack trace, present only on errors

## How It Logs (Producer)

The producer lives in `url-shortener/app/kafka_logging.py` as a custom `KafkaLogHandler` attached to Python's standard logging system.

- Middleware in `url-shortener/app/middleware.py` captures request timing on `before_request` and logs everything on `after_request`
- The handler is **lazily initialized** — the Kafka producer is only created on the first log emission, so the app tolerates Kafka being unavailable at startup
- Logs are sent **fire-and-forget** with delivery callbacks that track failures but never crash the app
- Only enabled when the `KAFKA_BOOTSTRAP_SERVERS` env var is set — otherwise logs just go to stdout
- Producer is configured with 100ms buffering and batches of 50 messages

## Consumers

### Log Printer (`url-shortener/kafka_consumer.py`)

- Consumer group: `log-printer`
- Reads from `app-logs` and prints color-coded formatted logs to stdout
- Useful for tailing logs during development

### Dashboard Backend (`dashboard/backend/kafka_consumer.py`)

- Consumer group: `dashboard-cache`
- Caches up to 1000 log entries in memory (thread-safe deque)
- Computes per-instance stats: request counts, error counts, average latency, error rate, status code histogram
- Flushes to PostgreSQL every 30 seconds
- Exposes data via API:
  - `GET /api/logs` — query cached logs with filters (limit, level, instance_id, search)
  - `GET /api/stats` — aggregated per-instance statistics
  - `POST /api/flush` — force immediate DB flush

Both consumers use `auto.offset.reset: latest` (only new logs, no historical replay) with auto-commit enabled.

## Configuration

Relevant environment variables:

| Variable | Default | Description |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | — | Kafka broker address (e.g. `kafka:9092`) |
| `KAFKA_LOG_TOPIC` | `app-logs` | Topic name for log messages |
| `LOG_LEVEL` | `INFO` | Minimum log level |
| `LOG_FORMAT` | `text` | `text` or `json` |
| `CACHE_MAX_ENTRIES` | `1000` | Max logs kept in dashboard memory |
| `DB_FLUSH_INTERVAL` | `30` | Seconds between DB flushes |

## Design Notes

- **Graceful degradation** — if Kafka is down, the URL-shortener still works; logs fall back to stdout
- **Lazy init** — producer tolerates startup race conditions with Kafka
- **Correlation** — `X-Request-ID` headers are propagated end-to-end for tracing
- **Auto-created topic** — `app-logs` is auto-created via `KAFKA_AUTO_CREATE_TOPICS_ENABLE` in docker-compose
