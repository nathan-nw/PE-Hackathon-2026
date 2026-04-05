"""Dashboard backend — FastAPI service backed by an in-memory Kafka log cache.

Consumes from the app-logs Kafka topic, caches recent entries and aggregates
in memory, and periodically flushes both to a dedicated PostgreSQL database.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from cache import LogCache
from db import init_db
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
LOG_INGEST_TOKEN = os.environ.get("LOG_INGEST_TOKEN", "").strip()
ALLOW_INSECURE_LOG_INGEST = os.environ.get("ALLOW_INSECURE_LOG_INGEST", "").strip().lower() in (
    "1",
    "true",
    "yes",
)
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "1000"))
DB_FLUSH_INTERVAL = float(os.environ.get("DB_FLUSH_INTERVAL", "30"))

cache = LogCache(max_entries=CACHE_MAX_ENTRIES)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start Kafka consumer and DB flush loop on startup."""
    # Do not block HTTP readiness on Postgres retries (Railway healthcheck hits PORT immediately).
    threading.Thread(target=init_db, daemon=True).start()

    # Kafka log stream (optional — disabled when no broker / DISABLED)
    if KAFKA_ENABLED:
        consumer_thread = threading.Thread(
            target=run_consumer,
            args=(cache, KAFKA_BOOTSTRAP_SERVERS, KAFKA_TOPIC),
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
    return {
        "status": "ok",
        "kafka_topic": KAFKA_TOPIC,
        "kafka_enabled": KAFKA_ENABLED,
        "http_ingest_enabled": bool(LOG_INGEST_TOKEN) or ALLOW_INSECURE_LOG_INGEST,
        "log_cache_ingested": st["total_ingested"],
        "log_cache_buffered": st["buffered_logs"],
    }


@app.post("/api/ingest")
async def ingest_logs(request: Request):
    """Receive the same JSON payloads as the Kafka topic (Railway without Kafka).

    When ``LOG_INGEST_TOKEN`` is set, require header ``X-Log-Ingest-Token`` (or
    ``Authorization: Bearer …``). If unset, reject unless ``ALLOW_INSECURE_LOG_INGEST=1``
    (local development only).
    """
    if LOG_INGEST_TOKEN:
        got = request.headers.get("x-log-ingest-token") or ""
        if not got:
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                got = auth[7:].strip()
        if got != LOG_INGEST_TOKEN:
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
    limit: int = Query(100, ge=1, le=1000),
    level: str | None = Query(None),
    instance_id: str | None = Query(None),
    search: str | None = Query(None, description="Case-insensitive substring in message/logger/path"),
):
    """Return recent log entries from the cache (newest first)."""
    return {
        "logs": cache.get_logs(
            limit=limit,
            level=level,
            instance_id=instance_id,
            search=search,
        ),
    }


@app.get("/api/stats")
def get_stats():
    """Return per-instance and global aggregate statistics."""
    return cache.get_stats()


@app.post("/api/flush")
def force_flush():
    """Manually trigger a flush of cached data to the database."""
    cache.flush_to_db()
    return {"status": "flushed"}
