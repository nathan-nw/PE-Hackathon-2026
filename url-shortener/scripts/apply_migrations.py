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
    """Match app/database.py resolution: DATABASE_URL, or DATABASE_* / Railway PG* vars.

    Railway Postgres often exposes PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE on the
    plugin; referencing those into this service works if DATABASE_URL is not set.
    """
    timeout = int(
        os.environ.get("DATABASE_CONNECT_TIMEOUT_SEC", str(_DEFAULT_CONNECT_TIMEOUT_SEC))
    )
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return psycopg2.connect(_with_connect_timeout(url, timeout))

    host = os.environ.get("PGHOST") or os.environ.get("DATABASE_HOST")
    if not host:
        print(
            "apply_migrations: DATABASE_URL is unset and PGHOST/DATABASE_HOST is missing.\n"
            "On Railway: url-shortener → Variables → add DATABASE_URL referencing Postgres, e.g.\n"
            "  ${{ Postgres.DATABASE_PRIVATE_URL }}  or  ${{ Postgres.DATABASE_URL }}\n"
            "Or set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE from the Postgres service.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    port = int(os.environ.get("PGPORT") or os.environ.get("DATABASE_PORT", "5432"))
    dbname = (
        os.environ.get("PGDATABASE")
        or os.environ.get("DATABASE_NAME")
        or "hackathon_db"
    )
    user = os.environ.get("PGUSER") or os.environ.get("DATABASE_USER", "postgres")
    password = os.environ.get("PGPASSWORD") or os.environ.get("DATABASE_PASSWORD", "")
    kwargs: dict = {
        "host": host,
        "port": port,
        "dbname": dbname,
        "user": user,
        "password": password,
        "connect_timeout": timeout,
    }
    sslmode = os.environ.get("PGSSLMODE") or os.environ.get("DATABASE_SSLMODE")
    if sslmode:
        kwargs["sslmode"] = sslmode
    return psycopg2.connect(**kwargs)


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
