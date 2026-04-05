"""In-memory cache for Kafka log stream data.

Stores recent log entries in a ring buffer and maintains rolling
aggregates (request counts, error rates, latency) per instance.
Periodically flushes to PostgreSQL for durable storage.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class InstanceStats:
    """Rolling aggregates for a single app instance."""

    request_count: int = 0
    error_count: int = 0  # 4xx + 5xx
    total_duration_ms: float = 0.0
    status_codes: Counter = field(default_factory=Counter)
    levels: Counter = field(default_factory=Counter)
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)

    @property
    def avg_duration_ms(self) -> float:
        if self.request_count == 0:
            return 0.0
        return round(self.total_duration_ms / self.request_count, 2)

    @property
    def error_rate(self) -> float:
        if self.request_count == 0:
            return 0.0
        return round(self.error_count / self.request_count, 4)

    def to_dict(self) -> dict[str, Any]:
        return {
            "request_count": self.request_count,
            "error_count": self.error_count,
            "avg_duration_ms": self.avg_duration_ms,
            "error_rate": self.error_rate,
            "status_codes": dict(self.status_codes),
            "levels": dict(self.levels),
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
        }


class LogCache:
    """Thread-safe in-memory cache for log entries and per-instance stats.

    Supports periodic flushing of logs and stats snapshots to PostgreSQL.
    """

    def __init__(self, max_entries: int = 1000):
        self._logs: deque[dict[str, Any]] = deque(maxlen=max_entries)
        self._stats: dict[str, InstanceStats] = {}
        self._lock = threading.Lock()
        self._total_ingested: int = 0
        # Unflushed logs accumulate here until the next DB flush
        self._pending_flush: list[dict[str, Any]] = []
        self._flush_timer: threading.Timer | None = None
        self._flush_running = False

    def add(self, entry: dict[str, Any]) -> None:
        """Ingest a single log entry from Kafka."""
        with self._lock:
            self._logs.append(entry)
            self._pending_flush.append(entry)
            self._total_ingested += 1
            self._update_stats(entry)

    def _update_stats(self, entry: dict[str, Any]) -> None:
        instance_id = str(entry.get("instance_id", "unknown"))
        if instance_id not in self._stats:
            self._stats[instance_id] = InstanceStats()

        stats = self._stats[instance_id]
        stats.last_seen = time.time()
        stats.levels[entry.get("level", "UNKNOWN")] += 1

        # Only count as a request if it has HTTP fields
        if "status_code" in entry:
            stats.request_count += 1
            code = int(entry["status_code"])
            stats.status_codes[str(code)] += 1
            if code >= 400:
                stats.error_count += 1
            if "duration_ms" in entry:
                stats.total_duration_ms += float(entry["duration_ms"])

    def get_logs(
        self,
        limit: int = 100,
        level: str | None = None,
        instance_id: str | None = None,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return recent logs, newest first, with optional filters."""
        with self._lock:
            logs = list(self._logs)

        if level:
            level_upper = level.upper()
            logs = [e for e in logs if e.get("level") == level_upper]
        if instance_id:
            logs = [e for e in logs if str(e.get("instance_id")) == instance_id]
        if search and search.strip():
            q = search.strip().casefold()
            logs = [
                e
                for e in logs
                if q in str(e.get("message", "")).casefold()
                or q in str(e.get("logger", "")).casefold()
                or q in str(e.get("path", "")).casefold()
            ]

        # Newest first
        logs.reverse()
        return logs[:limit]

    def get_stats(self) -> dict[str, Any]:
        """Return per-instance aggregates and global summary."""
        with self._lock:
            per_instance = {k: v.to_dict() for k, v in self._stats.items()}
            total_requests = sum(s.request_count for s in self._stats.values())
            total_errors = sum(s.error_count for s in self._stats.values())

        return {
            "total_ingested": self._total_ingested,
            "buffered_logs": len(self._logs),
            "pending_flush": len(self._pending_flush),
            "instances": per_instance,
            "global": {
                "total_requests": total_requests,
                "total_errors": total_errors,
                "error_rate": round(total_errors / total_requests, 4) if total_requests else 0.0,
            },
        }

    def flush_to_db(self) -> None:
        """Flush pending logs and a stats snapshot to PostgreSQL."""
        from db import flush_logs, flush_stats

        # Grab pending logs under lock, then release before doing I/O
        with self._lock:
            to_flush = list(self._pending_flush)
            self._pending_flush.clear()
            stats_snapshot = {k: v.to_dict() for k, v in self._stats.items()}

        if to_flush:
            flushed = flush_logs(to_flush)
            if flushed == 0:
                # Put them back so we retry next cycle
                with self._lock:
                    self._pending_flush = to_flush + self._pending_flush

        if stats_snapshot:
            flush_stats(stats_snapshot)

    def start_flush_loop(self, interval_seconds: float = 30.0) -> None:
        """Start a repeating background timer that flushes to DB."""
        self._flush_running = True

        def _tick():
            if not self._flush_running:
                return
            try:
                self.flush_to_db()
            except Exception as exc:
                logger.error("Flush tick failed: %s", exc)
            # Schedule next tick
            if self._flush_running:
                self._flush_timer = threading.Timer(interval_seconds, _tick)
                self._flush_timer.daemon = True
                self._flush_timer.start()

        self._flush_timer = threading.Timer(interval_seconds, _tick)
        self._flush_timer.daemon = True
        self._flush_timer.start()
        logger.info("DB flush loop started (every %.0fs)", interval_seconds)

    def stop_flush_loop(self) -> None:
        """Stop the flush timer and do one final flush."""
        self._flush_running = False
        if self._flush_timer:
            self._flush_timer.cancel()
        # Final flush
        try:
            self.flush_to_db()
        except Exception as exc:
            logger.error("Final flush failed: %s", exc)

    def get_error_buckets(self, window_minutes: int = 60, log_limit: int = 200) -> dict[str, Any]:
        """Server-side per-minute error bucketing over the full cache.

        Returns:
            buckets: list of {minute, total, errors, error_rate, status_breakdown}
            error_logs: recent error log entries (newest first, up to log_limit)
            summary: {total_errors, total_requests, peak_errors, current_rate}
        """
        from datetime import datetime, timezone

        now = time.time()
        window_start = now - window_minutes * 60

        with self._lock:
            logs = list(self._logs)

        # Build minute buckets
        buckets: dict[str, dict[str, Any]] = {}
        for i in range(window_minutes + 1):
            t = datetime.fromtimestamp(window_start + i * 60, tz=timezone.utc)
            key = t.strftime("%H:%M")
            buckets[key] = {
                "minute": key,
                "timestamp": (window_start + i * 60) * 1000,
                "total": 0,
                "errors": 0,
                "error_rate": 0.0,
                "status_breakdown": {},
            }

        error_logs: list[dict[str, Any]] = []

        for entry in logs:
            ts_str = entry.get("timestamp")
            status_code = entry.get("status_code")
            if not ts_str or status_code is None:
                continue

            try:
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
            except (ValueError, AttributeError):
                continue

            if ts < window_start:
                continue

            t = datetime.fromtimestamp(ts, tz=timezone.utc)
            key = t.strftime("%H:%M")
            bucket = buckets.get(key)
            if not bucket:
                continue

            bucket["total"] += 1
            code = int(status_code)
            if code >= 400:
                bucket["errors"] += 1
                code_str = str(code)
                bucket["status_breakdown"][code_str] = bucket["status_breakdown"].get(code_str, 0) + 1
                error_logs.append(entry)

        # Compute error rates
        for b in buckets.values():
            b["error_rate"] = round((b["errors"] / b["total"]) * 100, 2) if b["total"] > 0 else 0.0

        sorted_buckets = sorted(buckets.values(), key=lambda x: x["timestamp"])

        total_errors = sum(b["errors"] for b in sorted_buckets)
        total_requests = sum(b["total"] for b in sorted_buckets)
        peak_errors = max((b["errors"] for b in sorted_buckets), default=0)

        recent_buckets = sorted_buckets[-5:]
        recent_total = sum(b["total"] for b in recent_buckets)
        recent_errors = sum(b["errors"] for b in recent_buckets)
        current_rate = round((recent_errors / recent_total) * 100, 2) if recent_total > 0 else 0.0

        # Sort error logs newest first, limit
        error_logs.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
        error_logs = error_logs[:log_limit]

        return {
            "buckets": sorted_buckets,
            "error_logs": error_logs,
            "summary": {
                "total_errors": total_errors,
                "total_requests": total_requests,
                "peak_errors": peak_errors,
                "current_rate": current_rate,
            },
        }

    def clear(self) -> None:
        """Reset all cached data."""
        with self._lock:
            self._logs.clear()
            self._stats.clear()
            self._pending_flush.clear()
            self._total_ingested = 0
