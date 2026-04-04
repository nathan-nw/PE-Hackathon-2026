"""Optional JSON log lines for central log aggregation (set LOG_FORMAT=json)."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any


class JsonFormatter(logging.Formatter):
    """One JSON object per line; includes trace correlation when passed via logging extra."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        for key in (
            "request_id",
            "trace_id",
            "method",
            "path",
            "status_code",
            "duration_ms",
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, log_level, logging.INFO)
    fmt = os.environ.get("LOG_FORMAT", "text").lower()

    if fmt == "json":
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        root = logging.getLogger()
        root.handlers.clear()
        root.addHandler(handler)
        root.setLevel(level)
    else:
        logging.basicConfig(
            level=level,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    # Add Kafka log handler if configured (idempotent — safe for gunicorn post_worker_init)
    kafka_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS")
    if kafka_servers:
        from app.kafka_logging import KafkaLogHandler

        root = logging.getLogger()
        for h in list(root.handlers):
            if isinstance(h, KafkaLogHandler):
                root.removeHandler(h)

        kafka_handler = KafkaLogHandler(bootstrap_servers=kafka_servers)
        kafka_handler.setLevel(level)
        root.addHandler(kafka_handler)
