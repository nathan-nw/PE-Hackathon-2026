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
from urllib.parse import parse_qs, unquote, urlparse

import psycopg2

from log_filters import sql_status_condition
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)


def _default_sslmode_for_postgres_host(hostname: str | None) -> str | None:
    """Match url-shortener/app/database.py — Railway Postgres requires TLS for *.railway.internal / *.rlwy.net."""
    if not hostname or os.environ.get("RAILWAY_DB_SSL_DISABLE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return None
    h = hostname.lower()
    if h.endswith(".railway.internal") or "rlwy.net" in h:
        return "require"
    return None


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
        q = parse_qs(parsed.query)
        sslmode = (q.get("sslmode") or [None])[0]
        if not sslmode:
            sslmode = os.environ.get("PGSSLMODE", "").strip() or None
        if not sslmode:
            sslmode = _default_sslmode_for_postgres_host(parsed.hostname)
        dbname = unquote((parsed.path or "").lstrip("/") or "postgres")
        override_db = os.environ.get("DASHBOARD_DB_NAME", "").strip()
        if override_db:
            dbname = override_db
        cfg: dict[str, Any] = {
            "dbname": dbname,
            "user": unquote(parsed.username or "postgres"),
            "password": unquote(parsed.password or ""),
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 5432,
        }
        if sslmode:
            cfg["sslmode"] = sslmode
        return cfg
    host = os.environ.get("DASHBOARD_DB_HOST", "dashboard-db")
    cfg = {
        "dbname": os.environ.get("DASHBOARD_DB_NAME", "dashboard_db"),
        "user": os.environ.get("DASHBOARD_DB_USER", "postgres"),
        "password": os.environ.get("DASHBOARD_DB_PASSWORD", "postgres"),
        "host": host,
        "port": int(os.environ.get("DASHBOARD_DB_PORT", "5432")),
    }
    sslmode = os.environ.get(
        "PGSSLMODE", ""
    ).strip() or _default_sslmode_for_postgres_host(host)
    if sslmode:
        cfg["sslmode"] = sslmode
    return cfg


def _kwargs_from_database_url(url: str, dbname: str) -> dict[str, Any]:
    """Parse a postgres URL and build psycopg2 kwargs for database ``dbname``."""
    u = url.strip()
    if u.startswith("postgres://"):
        u = "postgresql://" + u[len("postgres://") :]
    parsed = urlparse(u)
    q = parse_qs(parsed.query)
    sslmode = (q.get("sslmode") or [None])[0]
    if not sslmode:
        sslmode = os.environ.get("PGSSLMODE", "").strip() or None
    if not sslmode:
        sslmode = _default_sslmode_for_postgres_host(parsed.hostname)
    cfg: dict[str, Any] = {
        "dbname": dbname,
        "user": unquote(parsed.username or "postgres"),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 5432,
    }
    if sslmode:
        cfg["sslmode"] = sslmode
    return cfg


def _connection_kwargs_explicit_db(dbname: str) -> dict[str, Any]:
    """Same host/user/password as the dashboard app, but connect to ``dbname`` (ignores ``DASHBOARD_DB_NAME``)."""
    url = (
        os.environ.get("DASHBOARD_DATABASE_URL", "").strip()
        or os.environ.get("DATABASE_URL", "").strip()
    )
    if url:
        return _kwargs_from_database_url(url, dbname)
    host = os.environ.get("DASHBOARD_DB_HOST", "dashboard-db")
    cfg = {
        "dbname": dbname,
        "user": os.environ.get("DASHBOARD_DB_USER", "postgres"),
        "password": os.environ.get("DASHBOARD_DB_PASSWORD", "postgres"),
        "host": host,
        "port": int(os.environ.get("DASHBOARD_DB_PORT", "5432")),
    }
    sslmode = os.environ.get(
        "PGSSLMODE", ""
    ).strip() or _default_sslmode_for_postgres_host(host)
    if sslmode:
        cfg["sslmode"] = sslmode
    return cfg


def _introspect_base_url_for_profile(profile: str) -> str | None:
    """Return a connection URL for listing DBs, or None if not configured."""
    p = (profile or "default").strip().lower()
    if p in ("main", "app", "hackathon"):
        return (
            os.environ.get("INTROSPECT_DB_URL", "").strip()
            or os.environ.get("HACKATHON_DATABASE_URL", "").strip()
        ) or None
    return (
        os.environ.get("DASHBOARD_DATABASE_URL", "").strip()
        or os.environ.get("DATABASE_URL", "").strip()
    ) or None


def get_connection_for_database(dbname: str, *, base_url: str | None = None):
    """Open a connection to ``dbname``. If ``base_url`` is set, use its host/credentials."""
    if base_url:
        return psycopg2.connect(**_kwargs_from_database_url(base_url, dbname))
    return psycopg2.connect(**_connection_kwargs_explicit_db(dbname))


def introspect_postgres_server(profile: str = "default") -> dict[str, Any]:
    """List non-template databases and public tables per DB (for Ops UI)."""
    p = (profile or "default").strip().lower()
    result: dict[str, Any] = {
        "databases": [],
        "tables_by_database": {},
        "dashboard_db_present": False,
        "errors": [],
        "profile": p,
        "introspect_configured": True,
    }

    base_url = _introspect_base_url_for_profile(p)
    if p in ("main", "app", "hackathon") and not base_url:
        result["introspect_configured"] = False
        result["errors"].append(
            {
                "scope": "config",
                "message": (
                    "Set INTROSPECT_DB_URL or HACKATHON_DATABASE_URL on dashboard-backend "
                    "(e.g. postgresql://postgres:postgres@db:5432/hackathon_db for Compose service db)."
                ),
            }
        )
        return result

    def connect_admin():
        if base_url:
            return get_connection_for_database("postgres", base_url=base_url)
        return get_connection_for_database("postgres")

    try:
        conn = connect_admin()
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
                )
                dbs = [r[0] for r in cur.fetchall()]
        conn.close()
        result["databases"] = dbs
        result["dashboard_db_present"] = "dashboard_db" in dbs
    except Exception as exc:
        logger.warning("introspect list databases: %s", exc)
        result["errors"].append({"scope": "list_databases", "message": str(exc)})
        return result

    for db in dbs:
        try:
            if base_url:
                c2 = get_connection_for_database(db, base_url=base_url)
            else:
                c2 = get_connection_for_database(db)
            with c2:
                with c2.cursor() as cur:
                    cur.execute(
                        """
                        SELECT tablename FROM pg_tables
                        WHERE schemaname = 'public'
                        ORDER BY tablename
                        """
                    )
                    tables = [r[0] for r in cur.fetchall()]
            c2.close()
            result["tables_by_database"][db] = tables
        except Exception as exc:
            logger.warning("introspect tables for %s: %s", db, exc)
            result["errors"].append({"scope": f"tables:{db}", "message": str(exc)})
            result["tables_by_database"][db] = []

    return result


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

CREATE TABLE IF NOT EXISTS incident_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'warning',
    title VARCHAR(256) NOT NULL,
    description TEXT,
    source VARCHAR(32) NOT NULL DEFAULT 'prometheus',
    alert_name VARCHAR(128),
    status VARCHAR(16) NOT NULL DEFAULT 'firing',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_events_created ON incident_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_events_type ON incident_events (event_type);
CREATE INDEX IF NOT EXISTS idx_incident_events_status ON incident_events (status);
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
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                rows = []
                for entry in logs:
                    rows.append(
                        (
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
                        )
                    )
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
        logger.info("Flushed %d log entries to DB", count)
        return count
    except Exception as exc:
        logger.error("Failed to flush logs to DB: %s", exc)
        return 0
    finally:
        if conn:
            conn.close()


def query_error_buckets(
    window_minutes: int = 60, log_limit: int = 5000
) -> dict[str, Any] | None:
    """Query per-minute error buckets and recent error logs from the DB.

    Returns None if the query fails (caller should fall back to cache).
    """
    conn = None
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
                        "error_rate": round((errors / total) * 100, 2)
                        if total > 0
                        else 0.0,
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

        return result
    except Exception as exc:
        logger.error("query_error_buckets failed: %s", exc)
        return None
    finally:
        if conn:
            conn.close()


def query_log_insights(
    window_minutes: int = 60,
    level: str | None = None,
    instance_id: str | None = None,
    search: str | None = None,
    status_code: str | None = None,
) -> dict[str, Any] | None:
    """Per-minute buckets with the same filters (DB path).

    Buckets only include rows with ``status_code IS NOT NULL`` (HTTP request lines).
    """
    try:
        conn = get_connection()
        result: dict[str, Any] = {"buckets_map": {}}
        cutoff = f"{window_minutes} minutes"

        def base_params(*, http_only: bool) -> tuple[str, list[Any]]:
            conditions: list[str] = ["timestamp >= NOW() - %s::interval"]
            params: list[Any] = [cutoff]
            if http_only:
                conditions.append("status_code IS NOT NULL")
            if level:
                conditions.append("UPPER(TRIM(level)) = UPPER(TRIM(%s))")
                params.append(level)
            if instance_id:
                conditions.append("instance_id = %s")
                params.append(instance_id)
            if search and search.strip():
                q = f"%{search.strip()}%"
                conditions.append(
                    "(message ILIKE %s OR logger ILIKE %s OR COALESCE(path, '') ILIKE %s)"
                )
                params.extend([q, q, q])
            st_sql, st_params = sql_status_condition(status_code)
            if st_sql:
                conditions.append(f"({st_sql})")
                params.extend(st_params)
            return " AND ".join(conditions), params

        with conn:
            with conn.cursor() as cur:
                where_http, params_http = base_params(http_only=True)
                cur.execute(
                    f"""
                    SELECT
                        to_char(date_trunc('minute', timestamp) AT TIME ZONE 'UTC', 'HH24:MI') AS minute,
                        EXTRACT(EPOCH FROM date_trunc('minute', timestamp)) * 1000 AS ts_ms,
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE status_code >= 400) AS errors
                    FROM kafka_logs
                    WHERE {where_http}
                    GROUP BY date_trunc('minute', timestamp)
                    ORDER BY date_trunc('minute', timestamp)
                    """,
                    params_http,
                )
                for row in cur.fetchall():
                    minute_key, ts_ms, total, errors = row
                    result["buckets_map"][minute_key] = {
                        "minute": minute_key,
                        "timestamp": float(ts_ms),
                        "total": total,
                        "errors": errors,
                        "error_rate": round((errors / total) * 100, 2)
                        if total > 0
                        else 0.0,
                        "status_breakdown": {},
                    }

                where_err, params_err = base_params(http_only=True)
                cur.execute(
                    f"""
                    SELECT
                        to_char(date_trunc('minute', timestamp) AT TIME ZONE 'UTC', 'HH24:MI') AS minute,
                        status_code::text AS code,
                        COUNT(*) AS cnt
                    FROM kafka_logs
                    WHERE {where_err}
                      AND status_code >= 400
                    GROUP BY date_trunc('minute', timestamp), status_code
                    ORDER BY date_trunc('minute', timestamp)
                    """,
                    params_err,
                )
                for row in cur.fetchall():
                    minute_key, code, cnt = row
                    bucket = result["buckets_map"].get(minute_key)
                    if bucket:
                        bucket["status_breakdown"][code] = cnt

        conn.close()
        return result
    except Exception as exc:
        logger.error("query_log_insights failed: %s", exc)
        return None


def clear_logs() -> int:
    """Delete all rows from kafka_logs. Returns count deleted."""
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM kafka_logs")
                count = cur.rowcount
        logger.info("Cleared %d log entries from DB", count)
        return count
    except Exception as exc:
        logger.error("Failed to clear logs from DB: %s", exc)
        return 0
    finally:
        if conn:
            conn.close()


def flush_stats(stats: dict[str, dict[str, Any]]) -> int:
    """Insert a snapshot of per-instance stats. Returns count inserted."""
    if not stats:
        return 0
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                rows = []
                for instance_id, s in stats.items():
                    rows.append(
                        (
                            instance_id,
                            s.get("request_count", 0),
                            s.get("error_count", 0),
                            s.get("avg_duration_ms", 0.0),
                            s.get("error_rate", 0.0),
                            json.dumps(s.get("status_codes", {})),
                            json.dumps(s.get("levels", {})),
                        )
                    )
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
        logger.info("Flushed stats snapshot for %d instances to DB", count)
        return count
    except Exception as exc:
        logger.error("Failed to flush stats to DB: %s", exc)
        return 0
    finally:
        if conn:
            conn.close()


def count_kafka_logs() -> int | None:
    """Return row count in kafka_logs, or None if the query fails."""
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM kafka_logs")
                row = cur.fetchone()
        return int(row[0]) if row else 0
    except Exception as exc:
        logger.warning("count_kafka_logs: %s", exc)
        return None
    finally:
        if conn:
            conn.close()


def fetch_logs_from_db(
    limit: int = 100,
    level: str | None = None,
    instance_id: str | None = None,
    search: str | None = None,
    status_code: str | None = None,
) -> list[dict[str, Any]]:
    """Load recent rows from kafka_logs (newest first). Payload shape matches Kafka / HTTP ingest."""
    if limit < 1:
        return []
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                conditions: list[str] = []
                params: list[Any] = []
                if level:
                    conditions.append("UPPER(TRIM(level)) = UPPER(TRIM(%s))")
                    params.append(level)
                if instance_id:
                    conditions.append("instance_id = %s")
                    params.append(instance_id)
                if search and search.strip():
                    q = f"%{search.strip()}%"
                    conditions.append(
                        "(message ILIKE %s OR logger ILIKE %s OR COALESCE(path, '') ILIKE %s)"
                    )
                    params.extend([q, q, q])
                st_sql, st_params = sql_status_condition(status_code)
                if st_sql:
                    conditions.append(f"({st_sql})")
                    params.extend(st_params)
                where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
                sql = f"""
                    SELECT raw_json FROM kafka_logs
                    {where}
                    ORDER BY COALESCE(timestamp, ingested_at) DESC NULLS LAST
                    LIMIT %s
                """
                params.append(limit)
                cur.execute(sql, params)
                rows = cur.fetchall()
        out: list[dict[str, Any]] = []
        for (rj,) in rows:
            if isinstance(rj, dict):
                out.append(rj)
            elif rj is not None:
                out.append(json.loads(rj) if isinstance(rj, str) else rj)
        return out
    except Exception as exc:
        logger.error("fetch_logs_from_db failed: %s", exc)
        return []
    finally:
        if conn:
            conn.close()


# ── Incident Events ──────────────────────────────────────────────────────────


def insert_incident_event(
    event_type: str,
    severity: str,
    title: str,
    description: str = "",
    source: str = "prometheus",
    alert_name: str = "",
    status: str = "firing",
    metadata: dict[str, Any] | None = None,
) -> int | None:
    """Insert an incident timeline event. Returns the new row id or None on failure."""
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO incident_events
                       (event_type, severity, title, description, source, alert_name, status, metadata)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       RETURNING id""",
                    (
                        event_type,
                        severity,
                        title,
                        description,
                        source,
                        alert_name,
                        status,
                        json.dumps(metadata or {}),
                    ),
                )
                row = cur.fetchone()
        return int(row[0]) if row else None
    except Exception as exc:
        logger.error("insert_incident_event failed: %s", exc)
        return None
    finally:
        if conn:
            conn.close()


def fetch_incident_events(
    limit: int = 100,
    event_type: str | None = None,
    severity: str | None = None,
    window_hours: int = 24,
) -> list[dict[str, Any]]:
    """Return recent incident events, newest first."""
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                conditions = ["created_at >= NOW() - (%s || ' hours')::interval"]
                params: list[Any] = [str(window_hours)]
                if event_type:
                    conditions.append("event_type = %s")
                    params.append(event_type)
                if severity:
                    conditions.append("severity = %s")
                    params.append(severity)
                where = " WHERE " + " AND ".join(conditions)
                cur.execute(
                    f"""SELECT id, event_type, severity, title, description, source,
                               alert_name, status, metadata, created_at
                        FROM incident_events
                        {where}
                        ORDER BY created_at DESC
                        LIMIT %s""",
                    (*params, limit),
                )
                cols = [d[0] for d in cur.description]
                rows = []
                for row in cur.fetchall():
                    d = dict(zip(cols, row))
                    d["created_at"] = (
                        d["created_at"].isoformat() if d["created_at"] else None
                    )
                    if isinstance(d["metadata"], str):
                        d["metadata"] = json.loads(d["metadata"])
                    rows.append(d)
        return rows
    except Exception as exc:
        logger.error("fetch_incident_events failed: %s", exc)
        return []
    finally:
        if conn:
            conn.close()


def clear_incident_events() -> int:
    """Delete all incident events. Returns count deleted."""
    conn = None
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM incident_events")
                count = cur.rowcount
        return count
    except Exception as exc:
        logger.error("clear_incident_events failed: %s", exc)
        return 0
    finally:
        if conn:
            conn.close()
