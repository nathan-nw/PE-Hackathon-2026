"""Per-replica identity and lightweight stats for the UI and Prometheus."""

from __future__ import annotations

import os
import socket
import time
from collections import deque

import psutil

START_TIME = time.time()
REQUEST_COUNT = 0
LATENCY_MS_SAMPLES: deque[float] = deque(maxlen=200)


def get_instance_id() -> str:
    """Human-friendly replica id from INSTANCE_ID (default ``1``)."""
    raw = os.environ.get("INSTANCE_ID", "1").strip()
    return raw if raw else "1"


def record_request_latency_ms(ms: float) -> None:
    LATENCY_MS_SAMPLES.append(ms)


def increment_request_count() -> None:
    global REQUEST_COUNT
    REQUEST_COUNT += 1


def get_instance_stats() -> dict:
    """Snapshot for GET /api/instance-stats (JSON)."""
    proc = psutil.Process()
    # Short interval gives a meaningful CPU% without blocking too long on each poll.
    cpu_pct = round(proc.cpu_percent(interval=0.05), 1)
    mem = proc.memory_info()
    rss_mb = round(mem.rss / (1024 * 1024), 1)
    mem_pct = round(proc.memory_percent(), 1)
    threads = proc.num_threads()

    avg_lat = 0.0
    if LATENCY_MS_SAMPLES:
        avg_lat = round(sum(LATENCY_MS_SAMPLES) / len(LATENCY_MS_SAMPLES), 2)

    uptime = round(time.time() - START_TIME, 1)

    loadavg: tuple[float, ...] | None = None
    if hasattr(os, "getloadavg"):
        try:
            loadavg = os.getloadavg()
        except OSError:
            loadavg = None

    return {
        "instance_id": get_instance_id(),
        "hostname": socket.gethostname(),
        "pid": proc.pid,
        "uptime_seconds": uptime,
        "cpu_percent_process": cpu_pct,
        "memory_rss_mb": rss_mb,
        "memory_percent_process": mem_pct,
        "threads": threads,
        "avg_request_latency_ms": avg_lat,
        "requests_observed": REQUEST_COUNT,
        "load_average_1m": loadavg[0] if loadavg else None,
    }
