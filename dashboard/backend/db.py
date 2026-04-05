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

import psycopg2
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)

DB_CONFIG = {
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
CREATE INDEX IF NOT EXISTS idx_kafka_logs_ts_status ON kafka_logs (timestamp DESC, status_code);
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
    return psycopg2.connect(**DB_CONFIG)


def init_db() -> bool:
    """Create tables if they don't exist. Returns True on success."""
    for attempt in range(30):
        try:
            conn = get_connection()
            with conn:
                with conn.cursor() as cur:
                    cur.execute(CREATE_TABLES_SQL)
            conn.close()
            logger.info("Dashboard database initialized")
            return True
        except Exception as exc:
            logger.warning("Waiting for dashboard DB (attempt %d/30): %s", attempt + 1, exc)
            time.sleep(2)
    logger.error("Could not connect to dashboard DB after 30 attempts")
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


def query_error_buckets(window_minutes: int = 60, log_limit: int = 5000) -> dict[str, Any] | None:
    """Query per-minute error buckets and recent error logs from the DB.

    Returns None if the query fails (caller should fall back to cache).
    """
    try:
        conn = get_connection()
        result: dict[str, Any] = {"buckets_map": {}, "error_logs": []}
        with conn:
            with conn.cursor() as cur:
                cutoff = f"{window_minutes} minutes"

                # Query 1: per-minute totals and error counts
                cur.execute(
                    """
                    SELECT
                        to_char(date_trunc('minute', timestamp) AT TIME ZONE 'UTC', 'HH24:MI') AS minute,
                        EXTRACT(EPOCH FROM date_trunc('minute', timestamp)) * 1000 AS ts_ms,
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE status_code >= 400) AS errors
                    FROM kafka_logs
                    WHERE timestamp >= NOW() - %s::interval
                      AND status_code IS NOT NULL
                    GROUP BY date_trunc('minute', timestamp)
                    ORDER BY date_trunc('minute', timestamp)
                    """,
                    (cutoff,),
                )
                for row in cur.fetchall():
                    minute_key, ts_ms, total, errors = row
                    result["buckets_map"][minute_key] = {
                        "minute": minute_key,
                        "timestamp": float(ts_ms),
                        "total": total,
                        "errors": errors,
                        "error_rate": round((errors / total) * 100, 2) if total > 0 else 0.0,
                        "status_breakdown": {},
                    }

                # Query 2: per-minute status code breakdown for errors only
                cur.execute(
                    """
                    SELECT
                        to_char(date_trunc('minute', timestamp) AT TIME ZONE 'UTC', 'HH24:MI') AS minute,
                        status_code::text AS code,
                        COUNT(*) AS cnt
                    FROM kafka_logs
                    WHERE timestamp >= NOW() - %s::interval
                      AND status_code >= 400
                    GROUP BY date_trunc('minute', timestamp), status_code
                    ORDER BY date_trunc('minute', timestamp)
                    """,
                    (cutoff,),
                )
                for row in cur.fetchall():
                    minute_key, code, cnt = row
                    bucket = result["buckets_map"].get(minute_key)
                    if bucket:
                        bucket["status_breakdown"][code] = cnt

                # Query 3: recent error log entries
                cur.execute(
                    """
                    SELECT raw_json
                    FROM kafka_logs
                    WHERE timestamp >= NOW() - %s::interval
                      AND status_code >= 400
                    ORDER BY timestamp DESC
                    LIMIT %s
                    """,
                    (cutoff, log_limit),
                )
                result["error_logs"] = [row[0] for row in cur.fetchall()]

        conn.close()
        return result
    except Exception as exc:
        logger.error("query_error_buckets failed: %s", exc)
        return None


def clear_logs() -> int:
    """Delete all rows from kafka_logs. Returns count deleted."""
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM kafka_logs")
                count = cur.rowcount
        conn.close()
        logger.info("Cleared %d log entries from DB", count)
        return count
    except Exception as exc:
        logger.error("Failed to clear logs from DB: %s", exc)
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
