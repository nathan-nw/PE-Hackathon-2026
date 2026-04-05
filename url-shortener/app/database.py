import logging
import os
import sys
import time
from functools import wraps
from urllib.parse import parse_qs, unquote, urlparse

from flask import request
from peewee import DatabaseProxy, Model, OperationalError
from playhouse.pool import PooledPostgresqlDatabase

logger = logging.getLogger(__name__)

db = DatabaseProxy()


class BaseModel(Model):
    class Meta:
        database = db


def _database_host() -> str:
    """Resolve host for psycopg2.

    On Windows, `localhost` often resolves to IPv6 (::1) first while Docker Desktop
    published ports are commonly only on IPv4 — use 127.0.0.1 for local dev.
    """
    host = os.environ.get("DATABASE_HOST", "127.0.0.1")
    if host == "localhost" and sys.platform == "win32":
        return "127.0.0.1"
    return host


def _default_sslmode_for_postgres_host(hostname: str | None) -> str | None:
    """Railway Postgres (private *.railway.internal or public *.rlwy.net TCP proxy) expects TLS.

    Without sslmode, psycopg2 often fails to connect. Set PGSSLMODE or add ?sslmode= to the URL
    to override; set RAILWAY_DB_SSL_DISABLE=1 to skip this default on Railway-shaped hosts.
    """
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


def _postgres_connection_kwargs():
    """Build Peewee kwargs from DATABASE_URL (e.g. Railway) or discrete DATABASE_* vars."""
    url = os.environ.get("DATABASE_URL", "").strip()
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
        kw = {
            "database": unquote((parsed.path or "").lstrip("/") or "postgres"),
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 5432,
            "user": unquote(parsed.username or "postgres"),
            "password": unquote(parsed.password or ""),
        }
        if sslmode:
            kw["sslmode"] = sslmode
        return kw
    discrete_host = _database_host()
    kw = {
        "database": os.environ.get("DATABASE_NAME", "hackathon_db"),
        "host": discrete_host,
        "port": int(os.environ.get("DATABASE_PORT", 5432)),
        "user": os.environ.get("DATABASE_USER", "postgres"),
        "password": os.environ.get("DATABASE_PASSWORD", "postgres"),
    }
    sslmode = os.environ.get("PGSSLMODE", "").strip() or _default_sslmode_for_postgres_host(
        discrete_host
    )
    if sslmode:
        kw["sslmode"] = sslmode
    return kw


def init_db(app):
    """Initialize database with connection pooling and reliability features."""
    conn = _postgres_connection_kwargs()
    database = PooledPostgresqlDatabase(
        conn.pop("database"),
        **conn,
        max_connections=int(os.environ.get("DB_MAX_CONNECTIONS", 20)),
        stale_timeout=int(os.environ.get("DB_STALE_TIMEOUT", 300)),
        timeout=int(os.environ.get("DB_TIMEOUT", 10)),
        connect_timeout=int(os.environ.get("DB_CONNECT_TIMEOUT", 5)),
    )
    db.initialize(database)

    @app.before_request
    def _db_connect():
        # `index`: HTML shell only (JS hits `/urls` etc. on follow-up requests).
        # `health`: connects lazily in the view so a bad DB does not hang or 500 in before_request.
        if request.endpoint in ("index", "health", "metrics", "instance_stats", "live", "ready"):
            return
        try:
            db.connect(reuse_if_open=True)
        except OperationalError as e:
            logger.error(f"Database connection failed: {e}")
            raise

    @app.teardown_appcontext
    def _db_close(exc):
        if not db.is_closed():
            db.close()


def retry_on_failure(max_retries=3, delay=0.5, backoff=2.0):
    """Decorator that retries database operations on transient failures.

    Uses exponential backoff: delay * (backoff ** attempt).
    Only retries on OperationalError (connection issues, timeouts).
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except OperationalError as e:
                    last_exception = e
                    wait_time = delay * (backoff**attempt)
                    logger.warning(
                        f"DB operation failed (attempt {attempt + 1}/{max_retries}): {e}. "
                        f"Retrying in {wait_time:.1f}s..."
                    )
                    time.sleep(wait_time)
                    # Force reconnect on next attempt
                    if not db.is_closed():
                        db.close()
            logger.error(f"DB operation failed after {max_retries} attempts: {last_exception}")
            raise last_exception

        return wrapper

    return decorator
