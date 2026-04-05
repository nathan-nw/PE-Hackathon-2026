"""Kafka log handler — produces log records as JSON to a Kafka topic."""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any


def log_record_to_payload(record: logging.LogRecord, instance_id: str) -> dict[str, Any]:
    """Structured log dict — same shape consumed by dashboard-backend (Kafka or HTTP ingest)."""
    payload: dict[str, Any] = {
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "level": record.levelname,
        "logger": record.name,
        "message": record.getMessage(),
        "instance_id": instance_id,
    }
    for key in ("request_id", "trace_id", "method", "path", "status_code", "duration_ms"):
        if hasattr(record, key):
            payload[key] = getattr(record, key)
    return payload


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
        self._delivery_errors = 0

    def _delivery_report(self, err, _msg):
        if err is not None:
            self._delivery_errors += 1
            if self._delivery_errors <= 3:
                print(f"[KafkaLogHandler] Delivery failed: {err}", file=sys.stderr)

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

            payload = log_record_to_payload(record, self._instance_id)
            if record.exc_info and record.exc_info[0] is not None:
                payload["exc_info"] = self.format(record) if self.formatter else str(record.exc_info)

            producer.produce(
                self._topic,
                value=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                callback=self._delivery_report,
            )
            producer.poll(0)
        except Exception as exc:
            # Never let logging crash the application; surface occasionally for ops.
            if not getattr(self, "_emit_error_logged", False):
                self._emit_error_logged = True
                print(f"[KafkaLogHandler] emit failed: {exc}", file=sys.stderr)
