"""Dashboard backend — FastAPI service backed by an in-memory Kafka log cache."""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from cache import LogCache
from kafka_consumer import run_consumer

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

KAFKA_BOOTSTRAP_SERVERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_LOG_TOPIC", "app-logs")
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "1000"))

cache = LogCache(max_entries=CACHE_MAX_ENTRIES)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the Kafka consumer thread on startup, let it die on shutdown."""
    consumer_thread = threading.Thread(
        target=run_consumer,
        args=(cache, KAFKA_BOOTSTRAP_SERVERS, KAFKA_TOPIC),
        daemon=True,
    )
    consumer_thread.start()
    yield


app = FastAPI(title="Dashboard Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/logs")
def get_logs(
    limit: int = Query(100, ge=1, le=1000),
    level: str | None = Query(None),
    instance_id: str | None = Query(None),
):
    """Return recent log entries from the cache (newest first)."""
    return {
        "logs": cache.get_logs(limit=limit, level=level, instance_id=instance_id),
    }


@app.get("/api/stats")
def get_stats():
    """Return per-instance and global aggregate statistics."""
    return cache.get_stats()
