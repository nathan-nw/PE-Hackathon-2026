"""Dashboard backend — FastAPI service backed by an in-memory Kafka log cache.

Consumes from the app-logs Kafka topic, caches recent entries and aggregates
in memory, and periodically flushes both to a dedicated PostgreSQL database.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cache import LogCache
from db import (
    count_kafka_logs,
    fetch_logs_from_db,
    get_connection,
    init_db,
    introspect_postgres_server,
)
from discord_alerter import DiscordAlerter
from k6_runner import K6Runner
from kafka_consumer import run_consumer

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

KAFKA_BOOTSTRAP_SERVERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "")
KAFKA_TOPIC = os.environ.get("KAFKA_LOG_TOPIC", "app-logs")
# Set empty, omit, or DISABLED for hosts without Kafka (e.g. Railway); logs tab stays empty.
KAFKA_ENABLED = bool(
    KAFKA_BOOTSTRAP_SERVERS.strip() and KAFKA_BOOTSTRAP_SERVERS.strip().upper() != "DISABLED"
)
ALLOW_INSECURE_LOG_INGEST = os.environ.get("ALLOW_INSECURE_LOG_INGEST", "").strip().lower() in (
    "1",
    "true",
    "yes",
)
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "50000"))
DB_FLUSH_INTERVAL = float(os.environ.get("DB_FLUSH_INTERVAL", "5"))
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

cache = LogCache(max_entries=CACHE_MAX_ENTRIES)
k6 = K6Runner()


def _log_ingest_token() -> str:
    """Read at call time so Railway/runtime env updates are visible (avoid stale import-time snapshot)."""
    return (os.environ.get("LOG_INGEST_TOKEN") or "").strip()


def _log_entry_key(entry: dict[str, Any]) -> tuple:
    return (
        str(entry.get("timestamp", "")),
        str(entry.get("message", "")),
        str(entry.get("instance_id", "")),
        str(entry.get("logger", "")),
    )


def _merge_logs(
    memory_logs: list[dict[str, Any]],
    db_logs: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Combine ring buffer and DB rows, dedupe identical lines, newest first."""
    combined = list(memory_logs) + list(db_logs)

    def ts_sort_key(e: dict[str, Any]) -> str:
        return str(e.get("timestamp") or "")

    combined.sort(key=ts_sort_key, reverse=True)
    seen: set[tuple] = set()
    out: list[dict[str, Any]] = []
    for e in combined:
        k = _log_entry_key(e)
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
        if len(out) >= limit:
            break
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start Kafka consumer and DB flush loop on startup."""
    # Do not block HTTP readiness on Postgres retries (Railway healthcheck hits PORT immediately).
    threading.Thread(target=init_db, daemon=True).start()

    # Kafka log stream (optional — disabled when no broker / DISABLED)
    if KAFKA_ENABLED:
        alerter = DiscordAlerter(webhook_url=DISCORD_WEBHOOK_URL)
        consumer_thread = threading.Thread(
            target=run_consumer,
            args=(cache, KAFKA_BOOTSTRAP_SERVERS, KAFKA_TOPIC),
            kwargs={"alerter": alerter},
            daemon=True,
        )
        consumer_thread.start()

    # Start periodic DB flush
    cache.start_flush_loop(interval_seconds=DB_FLUSH_INTERVAL)

    yield

    # Shutdown: final flush
    cache.stop_flush_loop()


app = FastAPI(title="Dashboard Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    st = cache.get_stats()
    db_ok = False
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        conn.close()
        db_ok = True
    except Exception:
        db_ok = False
    out: dict[str, Any] = {
        "status": "ok",
        "service": "dashboard-backend",
        "kafka_topic": KAFKA_TOPIC,
        "kafka_enabled": KAFKA_ENABLED,
        "http_ingest_enabled": bool(_log_ingest_token()) or ALLOW_INSECURE_LOG_INGEST,
        "log_cache_ingested": st["total_ingested"],
        "log_cache_buffered": st["buffered_logs"],
        "database_connected": db_ok,
    }
    n = count_kafka_logs()
    if n is not None:
        out["persisted_kafka_logs"] = n
    return out


@app.get("/api/introspect/postgres")
def introspect_postgres(
    profile: str = Query(
        "default",
        description="default = dashboard-backend DB; main = INTROSPECT_DB_URL (Compose db service)",
    ),
):
    """List databases and public tables (Ops UI). ``profile=main`` uses ``INTROSPECT_DB_URL``."""
    return introspect_postgres_server(profile)


@app.post("/api/ingest")
async def ingest_logs(request: Request):
    """Receive the same JSON payloads as the Kafka topic (Railway without Kafka).

    When ``LOG_INGEST_TOKEN`` is set, require header ``X-Log-Ingest-Token`` (or
    ``Authorization: Bearer …``). If unset, reject unless ``ALLOW_INSECURE_LOG_INGEST=1``
    (local development only).
    """
    expected = _log_ingest_token()
    if expected:
        got = request.headers.get("x-log-ingest-token") or ""
        if not got:
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                got = auth[7:].strip()
        if got != expected:
            raise HTTPException(status_code=401, detail="Invalid log ingest token")
    elif not ALLOW_INSECURE_LOG_INGEST:
        raise HTTPException(
            status_code=503,
            detail="Set LOG_INGEST_TOKEN on this service (and the same value as LOG_INGEST_TOKEN on url-shortener replicas), or ALLOW_INSECURE_LOG_INGEST=1 for local dev only",
        )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON body required") from None

    if isinstance(body, list):
        entries = body
    elif isinstance(body, dict) and "entries" in body:
        entries = body["entries"]
        if not isinstance(entries, list):
            raise HTTPException(status_code=400, detail="entries must be a list")
    elif isinstance(body, dict):
        entries = [body]
    else:
        raise HTTPException(status_code=400, detail="Expected JSON object or array")

    n = 0
    for e in entries:
        if isinstance(e, dict):
            cache.add(e)
            n += 1
    return {"ingested": n, "status": "ok"}


@app.get("/api/logs")
def get_logs(
    limit: int = Query(100, ge=1, le=50000),
    level: str | None = Query(None),
    instance_id: str | None = Query(None),
    search: str | None = Query(None, description="Case-insensitive substring in message/logger/path"),
    source: str = Query(
        "merged",
        description="memory | db | merged — merged combines ring buffer + Postgres kafka_logs",
    ),
):
    """Return recent logs: memory-only, DB-only, or merged (default; survives restarts)."""
    src = source.lower().strip() if source else "merged"
    if src not in ("memory", "db", "merged"):
        src = "merged"
    if src == "memory":
        return {
            "logs": cache.get_logs(
                limit=limit,
                level=level,
                instance_id=instance_id,
                search=search,
            ),
            "source": src,
        }
    if src == "db":
        return {
            "logs": fetch_logs_from_db(
                limit=limit,
                level=level,
                instance_id=instance_id,
                search=search,
            ),
            "source": src,
        }
    mem = cache.get_logs(
        limit=min(2000, CACHE_MAX_ENTRIES),
        level=level,
        instance_id=instance_id,
        search=search,
    )
    db_rows = fetch_logs_from_db(
        limit=min(2000, max(limit * 3, 100)),
        level=level,
        instance_id=instance_id,
        search=search,
    )
    return {"logs": _merge_logs(mem, db_rows, limit), "source": "merged"}


@app.get("/api/stats")
def get_stats():
    """Return per-instance and global aggregate statistics plus persisted row count when DB works."""
    st = cache.get_stats()
    n = count_kafka_logs()
    if n is not None:
        st["persisted_kafka_logs"] = n
    return st


@app.post("/api/flush")
def force_flush():
    """Manually trigger a flush of cached data to the database."""
    cache.flush_to_db()
    return {"status": "flushed"}


@app.get("/api/errors")
def get_errors(
    window_minutes: int = Query(60, ge=1, le=1440),
    log_limit: int = Query(200, ge=1, le=10000),
):
    """Return per-minute error buckets and recent error log entries.

    Queries the DB first (has all flushed data), falls back to in-memory cache.
    """
    from datetime import datetime, timezone
    from db import query_error_buckets

    db_result = query_error_buckets(window_minutes=window_minutes, log_limit=log_limit)

    if db_result is not None:
        buckets_map = db_result["buckets_map"]

        # Fill in empty minute slots for the full window
        now = __import__("time").time()
        window_start = now - window_minutes * 60
        for i in range(window_minutes + 1):
            t = datetime.fromtimestamp(window_start + i * 60, tz=timezone.utc)
            key = t.strftime("%H:%M")
            if key not in buckets_map:
                buckets_map[key] = {
                    "minute": key,
                    "timestamp": (window_start + i * 60) * 1000,
                    "total": 0,
                    "errors": 0,
                    "error_rate": 0.0,
                    "status_breakdown": {},
                }

        sorted_buckets = sorted(buckets_map.values(), key=lambda x: x["timestamp"])

        total_errors = sum(b["errors"] for b in sorted_buckets)
        total_requests = sum(b["total"] for b in sorted_buckets)
        peak_errors = max((b["errors"] for b in sorted_buckets), default=0)

        recent_buckets = sorted_buckets[-5:]
        recent_total = sum(b["total"] for b in recent_buckets)
        recent_errors = sum(b["errors"] for b in recent_buckets)
        current_rate = round((recent_errors / recent_total) * 100, 2) if recent_total > 0 else 0.0

        return {
            "buckets": sorted_buckets,
            "error_logs": db_result["error_logs"],
            "summary": {
                "total_errors": total_errors,
                "total_requests": total_requests,
                "peak_errors": peak_errors,
                "current_rate": current_rate,
            },
        }

    # Fallback: use in-memory cache
    return cache.get_error_buckets(window_minutes=window_minutes, log_limit=log_limit)


@app.post("/api/errors/clear")
def clear_errors():
    """Clear all log data from both DB and in-memory cache."""
    from db import clear_logs
    cache.clear()
    deleted = clear_logs()
    return {"status": "cleared", "deleted_rows": deleted}


# ── k6 Load Testing ─────────────────────────────────────────────────────────


class K6RunRequest(BaseModel):
    preset: str = ""
    vus: int = 50
    duration: str = "30s"
    target_url: str = "http://load-balancer:80"


@app.post("/api/k6/run")
def k6_run(req: K6RunRequest):
    """Start a k6 load test."""
    return k6.start(
        preset=req.preset,
        vus=req.vus,
        duration=req.duration,
        target_url=req.target_url,
    )


@app.get("/api/k6/status")
def k6_status():
    """Get live stats from the running k6 test."""
    return k6.get_status()


@app.post("/api/k6/stop")
def k6_stop():
    """Stop the running k6 test."""
    return k6.stop()
