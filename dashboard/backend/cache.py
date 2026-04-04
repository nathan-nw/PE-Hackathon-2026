"""In-memory cache for Kafka log stream data.

Stores recent log entries in a ring buffer and maintains rolling
aggregates (request counts, error rates, latency) per instance.
"""

from __future__ import annotations

import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any


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
    """Thread-safe in-memory cache for log entries and per-instance stats."""

    def __init__(self, max_entries: int = 1000):
        self._logs: deque[dict[str, Any]] = deque(maxlen=max_entries)
        self._stats: dict[str, InstanceStats] = {}
        self._lock = threading.Lock()
        self._total_ingested: int = 0

    def add(self, entry: dict[str, Any]) -> None:
        """Ingest a single log entry from Kafka."""
        with self._lock:
            self._logs.append(entry)
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
    ) -> list[dict[str, Any]]:
        """Return recent logs, newest first, with optional filters."""
        with self._lock:
            logs = list(self._logs)

        if level:
            level_upper = level.upper()
            logs = [e for e in logs if e.get("level") == level_upper]
        if instance_id:
            logs = [e for e in logs if str(e.get("instance_id")) == instance_id]

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
            "instances": per_instance,
            "global": {
                "total_requests": total_requests,
                "total_errors": total_errors,
                "error_rate": round(total_errors / total_requests, 4) if total_requests else 0.0,
            },
        }

    def clear(self) -> None:
        """Reset all cached data."""
        with self._lock:
            self._logs.clear()
            self._stats.clear()
            self._total_ingested = 0
