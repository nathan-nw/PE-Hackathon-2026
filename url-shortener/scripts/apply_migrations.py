#!/usr/bin/env python3
"""Apply ordered SQL files under url-shortener/migrations/ (tracked in schema_migrations).

Run against Postgres (Compose: DATABASE_HOST=db). From repo root:
  uv run python url-shortener/scripts/apply_migrations.py

Or from url-shortener with env loaded:
  uv run python scripts/apply_migrations.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import psycopg2
from psycopg2.extensions import connection as PGConnection

# Avoid hanging the whole container before Gunicorn binds (Railway health checks /live on PORT).
_DEFAULT_CONNECT_TIMEOUT_SEC = 15


def _with_connect_timeout(url: str, seconds: int) -> str:
    """Ensure libpq connect_timeout is set so unreachable DB fails fast."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    parsed = urlparse(url)
    q = parse_qs(parsed.query, keep_blank_values=True)
    if "connect_timeout" not in q:
        q["connect_timeout"] = [str(seconds)]
    new_query = urlencode(q, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def _connect() -> PGConnection:
    timeout = int(
        os.environ.get("DATABASE_CONNECT_TIMEOUT_SEC", str(_DEFAULT_CONNECT_TIMEOUT_SEC))
    )
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return psycopg2.connect(_with_connect_timeout(url, timeout))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", "5432")),
        dbname=os.environ.get("DATABASE_NAME", "hackathon_db"),
        user=os.environ.get("DATABASE_USER", "postgres"),
        password=os.environ.get("DATABASE_PASSWORD", "postgres"),
        connect_timeout=timeout,
    )


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    migrations_dir = root / "migrations"
    if not migrations_dir.is_dir():
        print("No migrations directory; nothing to do.", file=sys.stderr)
        return 0

    conn = _connect()
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.commit()

    for path in sorted(migrations_dir.glob("*.sql")):
        cur.execute("SELECT 1 FROM schema_migrations WHERE filename = %s", (path.name,))
        if cur.fetchone():
            continue
        sql = path.read_text(encoding="utf-8")
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s)",
                (path.name,),
            )
            conn.commit()
            print(f"Applied {path.name}")
        except Exception:
            conn.rollback()
            raise

    cur.close()
    conn.close()
    print("Migrations complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
