"""PostgreSQL persistence for the dashboard cache.

Tables:
  - kafka_logs: raw log entries flushed periodically from the in-memory buffer
  - instance_stats_snapshots: periodic snapshots of per-instance aggregates
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any
from urllib.parse import unquote, urlparse

import psycopg2
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)


def _db_config() -> dict[str, Any]:
    """Build psycopg2 kwargs from DASHBOARD_DATABASE_URL / DATABASE_URL or DASHBOARD_DB_*."""
    url = (
        os.environ.get("DASHBOARD_DATABASE_URL", "").strip()
        or os.environ.get("DATABASE_URL", "").strip()
    )
    if url:
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        parsed = urlparse(url)
        dbname = unquote((parsed.path or "").lstrip("/") or "postgres")
        override_db = os.environ.get("DASHBOARD_DB_NAME", "").strip()
        if override_db:
            dbname = override_db
        return {
            "dbname": dbname,
            "user": unquote(parsed.username or "postgres"),
            "password": unquote(parsed.password or ""),
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 5432,
        }
    return {
        "dbname": os.environ.get("DASHBOARD_DB_NAME", "dashboard_db"),
        "user": os.environ.get("DASHBOARD_DB_USER", "postgres"),
        "password": os.environ.get("DASHBOARD_DB_PASSWORD", "postgres"),
        "host": os.environ.get("DASHBOARD_DB_HOST", "dashboard-db"),
        "port": int(os.environ.get("DASHBOARD_DB_PORT", "5432")),
    }

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS kafka_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ,
    level VARCHAR(16),
    logger VARCHAR(128),
    message TEXT,
    instance_id VARCHAR(32),
    request_id VARCHAR(128),
    trace_id VARCHAR(128),
    method VARCHAR(8),
    path VARCHAR(512),
    status_code INTEGER,
    duration_ms DOUBLE PRECISION,
    raw_json JSONB NOT NULL,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kafka_logs_timestamp ON kafka_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_kafka_logs_instance ON kafka_logs (instance_id);
CREATE INDEX IF NOT EXISTS idx_kafka_logs_level ON kafka_logs (level);

CREATE TABLE IF NOT EXISTS instance_stats_snapshots (
    id BIGSERIAL PRIMARY KEY,
    instance_id VARCHAR(32) NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    avg_duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    error_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    status_codes JSONB NOT NULL DEFAULT '{}',
    levels JSONB NOT NULL DEFAULT '{}',
    snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stats_snapshots_instance ON instance_stats_snapshots (instance_id);
CREATE INDEX IF NOT EXISTS idx_stats_snapshots_time ON instance_stats_snapshots (snapshot_at DESC);
"""


def get_connection():
    """Create a new database connection."""
    return psycopg2.connect(**_db_config())


def init_db() -> bool:
    """Create tables if they don't exist. Returns True on success."""
    max_attempts = int(os.environ.get("DASHBOARD_DB_INIT_ATTEMPTS", "20"))
    sleep_s = float(os.environ.get("DASHBOARD_DB_INIT_SLEEP_SEC", "1"))
    for attempt in range(max_attempts):
        try:
            conn = get_connection()
            with conn:
                with conn.cursor() as cur:
                    cur.execute(CREATE_TABLES_SQL)
            conn.close()
            logger.info("Dashboard database initialized")
            return True
        except Exception as exc:
            logger.warning(
                "Waiting for dashboard DB (attempt %d/%d): %s",
                attempt + 1,
                max_attempts,
                exc,
            )
            time.sleep(sleep_s)
    logger.error("Could not connect to dashboard DB after %d attempts", max_attempts)
    return False


def flush_logs(logs: list[dict[str, Any]]) -> int:
    """Bulk-insert log entries into kafka_logs. Returns count inserted."""
    if not logs:
        return 0
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                rows = []
                for entry in logs:
                    rows.append((
                        entry.get("timestamp"),
                        entry.get("level"),
                        entry.get("logger"),
                        entry.get("message"),
                        str(entry.get("instance_id", "unknown")),
                        entry.get("request_id"),
                        entry.get("trace_id"),
                        entry.get("method"),
                        entry.get("path"),
                        entry.get("status_code"),
                        entry.get("duration_ms"),
                        json.dumps(entry, ensure_ascii=False),
                    ))
                execute_values(
                    cur,
                    """INSERT INTO kafka_logs
                       (timestamp, level, logger, message, instance_id,
                        request_id, trace_id, method, path, status_code,
                        duration_ms, raw_json)
                       VALUES %s""",
                    rows,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                )
                count = len(rows)
        conn.close()
        logger.info("Flushed %d log entries to DB", count)
        return count
    except Exception as exc:
        logger.error("Failed to flush logs to DB: %s", exc)
        return 0


def flush_stats(stats: dict[str, dict[str, Any]]) -> int:
    """Insert a snapshot of per-instance stats. Returns count inserted."""
    if not stats:
        return 0
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                rows = []
                for instance_id, s in stats.items():
                    rows.append((
                        instance_id,
                        s.get("request_count", 0),
                        s.get("error_count", 0),
                        s.get("avg_duration_ms", 0.0),
                        s.get("error_rate", 0.0),
                        json.dumps(s.get("status_codes", {})),
                        json.dumps(s.get("levels", {})),
                    ))
                execute_values(
                    cur,
                    """INSERT INTO instance_stats_snapshots
                       (instance_id, request_count, error_count,
                        avg_duration_ms, error_rate, status_codes, levels)
                       VALUES %s""",
                    rows,
                    template="(%s, %s, %s, %s, %s, %s, %s)",
                )
                count = len(rows)
        conn.close()
        logger.info("Flushed stats snapshot for %d instances to DB", count)
        return count
    except Exception as exc:
        logger.error("Failed to flush stats to DB: %s", exc)
        return 0
