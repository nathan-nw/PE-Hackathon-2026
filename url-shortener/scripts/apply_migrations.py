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

import psycopg2
from psycopg2.extensions import connection as PGConnection


def _connect() -> PGConnection:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", "5432")),
        dbname=os.environ.get("DATABASE_NAME", "hackathon_db"),
        user=os.environ.get("DATABASE_USER", "postgres"),
        password=os.environ.get("DATABASE_PASSWORD", "postgres"),
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
