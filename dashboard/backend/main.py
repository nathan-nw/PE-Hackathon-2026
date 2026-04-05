"""Dashboard backend — FastAPI service backed by an in-memory Kafka log cache.

Consumes from the app-logs Kafka topic, caches recent entries and aggregates
in memory, and periodically flushes both to a dedicated PostgreSQL database.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from cache import LogCache
from db import init_db
from discord_alerter import DiscordAlerter
from kafka_consumer import run_consumer

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

KAFKA_BOOTSTRAP_SERVERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_LOG_TOPIC", "app-logs")
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "1000"))
DB_FLUSH_INTERVAL = float(os.environ.get("DB_FLUSH_INTERVAL", "30"))
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

cache = LogCache(max_entries=CACHE_MAX_ENTRIES)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start Kafka consumer and DB flush loop on startup."""
    # Initialize database tables
    init_db()

    # Start Kafka consumer thread
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
    return {
        "status": "ok",
        "kafka_topic": KAFKA_TOPIC,
        "log_cache_ingested": st["total_ingested"],
        "log_cache_buffered": st["buffered_logs"],
    }


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
