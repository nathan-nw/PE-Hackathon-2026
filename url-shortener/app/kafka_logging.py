"""Kafka log handler — produces log records as JSON to a Kafka topic."""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any


class KafkaLogHandler(logging.Handler):
    """Logging handler that sends JSON log records to a Kafka topic.

    The producer is initialized lazily on first emit() to tolerate Kafka
    not being ready at import time.
    """

    def __init__(self, bootstrap_servers: str, topic: str = "app-logs"):
        super().__init__()
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic
        self._producer = None
        self._failed = False
        self._instance_id = os.environ.get("INSTANCE_ID", "unknown")

    def _get_producer(self):
        if self._producer is None and not self._failed:
            try:
                from confluent_kafka import Producer

                self._producer = Producer(
                    {
                        "bootstrap.servers": self._bootstrap_servers,
                        "queue.buffering.max.ms": 100,
                        "batch.num.messages": 50,
                    }
                )
            except Exception as exc:
                self._failed = True
                print(f"[KafkaLogHandler] Failed to create producer: {exc}", file=sys.stderr)
        return self._producer

    def emit(self, record: logging.LogRecord) -> None:
        try:
            producer = self._get_producer()
            if producer is None:
                return

            payload: dict[str, Any] = {
                "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "instance_id": self._instance_id,
            }
            if record.exc_info and record.exc_info[0] is not None:
                payload["exc_info"] = self.format(record) if self.formatter else str(record.exc_info)
            for key in ("request_id", "trace_id", "method", "path", "status_code", "duration_ms"):
                if hasattr(record, key):
                    payload[key] = getattr(record, key)

            producer.produce(
                self._topic,
                value=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            )
            producer.poll(0)
        except Exception:
            # Never let logging crash the application
            pass
