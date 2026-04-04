import logging
import os
import time
from functools import wraps

from flask import request
from peewee import DatabaseProxy, Model, OperationalError
from playhouse.pool import PooledPostgresqlDatabase

logger = logging.getLogger(__name__)

db = DatabaseProxy()


class BaseModel(Model):
    class Meta:
        database = db


def init_db(app):
    """Initialize database with connection pooling and reliability features."""
    database = PooledPostgresqlDatabase(
        os.environ.get("DATABASE_NAME", "hackathon_db"),
        host=os.environ.get("DATABASE_HOST", "localhost"),
        port=int(os.environ.get("DATABASE_PORT", 5432)),
        user=os.environ.get("DATABASE_USER", "postgres"),
        password=os.environ.get("DATABASE_PASSWORD", "postgres"),
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
        if request.endpoint in ("index", "health"):
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
