"""Golden signals (latency + traffic) from HTTP request logs — no Prometheus.

Uses the same structured log lines as Kafka / HTTP ingest (``status_code``, ``duration_ms``,
``timestamp``). Aggregates into time buckets for the Ops Telemetry tab.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def _parse_ts(entry: dict[str, Any]) -> float | None:
    ts_str = entry.get("timestamp")
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(str(ts_str).replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError, TypeError):
        return None


def _percentile_nearest(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return float("nan")
    if q <= 0:
        return sorted_vals[0]
    if q >= 1:
        return sorted_vals[-1]
    idx = (len(sorted_vals) - 1) * q
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return sorted_vals[lo] + frac * (sorted_vals[hi] - sorted_vals[lo])


def bucket_epoch(ts: float, step: float) -> int:
    return int(ts // step * step)


def aggregate_entries_to_series(
    entries: list[dict[str, Any]],
    *,
    step_seconds: float,
    range_minutes: int,
    now: float | None = None,
) -> dict[str, Any]:
    """Build latency + traffic series from HTTP log dicts."""
    now = now if now is not None else time.time()
    window_start = now - range_minutes * 60
    step = float(step_seconds)

    # bucket_epoch -> latencies, status -> count
    lat_by_bucket: dict[int, list[float]] = defaultdict(list)
    count_by_bucket: dict[int, int] = defaultdict(int)
    count_by_bucket_status: dict[tuple[int, str], int] = defaultdict(int)

    for entry in entries:
        if entry.get("status_code") is None:
            continue
        dur = entry.get("duration_ms")
        if dur is None:
            continue
        try:
            d = float(dur)
        except (TypeError, ValueError):
            continue
        ts = _parse_ts(entry)
        if ts is None or ts < window_start or ts > now:
            continue
        be = bucket_epoch(ts, step)
        lat_by_bucket[be].append(d)
        count_by_bucket[be] += 1
        code = str(int(entry["status_code"]))
        count_by_bucket_status[(be, code)] += 1

    # Deterministic bucket list (even empty middle buckets optional — omit for sparse)
    sorted_epochs = sorted(lat_by_bucket.keys() | count_by_bucket.keys())

    def series_latency(q: float) -> list[list[float]]:
        out: list[list[float]] = []
        for be in sorted_epochs:
            vals = sorted(lat_by_bucket.get(be, []))
            p = _percentile_nearest(vals, q)
            if p == p:  # not NaN
                out.append([float(be), round(p, 4)])
        return out

    total_rps: list[list[float]] = []
    for be in sorted_epochs:
        c = count_by_bucket.get(be, 0)
        total_rps.append([float(be), round(c / step_seconds, 6)])

    by_status: dict[str, list[list[float]]] = defaultdict(list)
    status_codes = {k[1] for k in count_by_bucket_status}
    for code in sorted(status_codes):
        for be in sorted_epochs:
            c = count_by_bucket_status.get((be, code), 0)
            if c:
                by_status[code].append([float(be), round(c / step_seconds, 6)])

    return {
        "latency": {
            "p50": series_latency(0.50),
            "p95": series_latency(0.95),
            "p99": series_latency(0.99),
        },
        "traffic": {
            "total": total_rps,
            "by_status": dict(by_status),
        },
        "buckets_with_data": len(sorted_epochs),
        "requests_in_window": sum(count_by_bucket.values()),
    }


def merge_telemetry_entries(
    db_rows: list[dict[str, Any]],
    memory_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Dedupe memory vs DB rows (prefer DB) using ``request_id`` + ``timestamp``."""

    def row_key(e: dict[str, Any]) -> tuple[str, str]:
        return (
            str(e.get("request_id") or ""),
            str(e.get("timestamp") or ""),
        )

    seen = {row_key(r) for r in db_rows if row_key(r) != ("", "")}
    out = list(db_rows)
    for e in memory_rows:
        k = row_key(e)
        if k in seen and k != ("", ""):
            continue
        out.append(e)
        if k != ("", ""):
            seen.add(k)
    return out


def build_golden_signals(
    cache: Any,
    *,
    range_minutes: int = 30,
    step_seconds: int = 15,
) -> dict[str, Any]:
    """Combine Postgres ``kafka_logs`` with the in-memory ring buffer (recent lines not flushed)."""
    from db import fetch_http_telemetry_rows

    now = time.time()
    db_rows = fetch_http_telemetry_rows(window_minutes=range_minutes)
    if db_rows is None:
        db_rows = []
    memory_rows = cache.get_http_log_entries_for_telemetry(range_minutes)
    merged = merge_telemetry_entries(db_rows, memory_rows)
    series = aggregate_entries_to_series(
        merged,
        step_seconds=float(step_seconds),
        range_minutes=range_minutes,
        now=now,
    )
    series["source"] = "app_logs"
    series["range_minutes"] = range_minutes
    series["step_seconds"] = step_seconds
    return series
