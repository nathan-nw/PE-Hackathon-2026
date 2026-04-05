"""
Create ``dashboard_db`` on Railway Postgres if it does not exist.

Uses ``DATABASE_PUBLIC_URL`` or ``DATABASE_URL`` from the environment (e.g.
``railway run -s Postgres -- uv run --directory url-shortener python ...``).

Safe to run multiple times.
"""
from __future__ import annotations

import os
import sys

try:
    import psycopg2
except ImportError:
    print("psycopg2 required (url-shortener venv)", file=sys.stderr)
    sys.exit(1)

DB_NAME = "dashboard_db"


def _normalize_url(u: str) -> str:
    if u.startswith("postgres://"):
        return "postgresql://" + u[len("postgres://") :]
    return u


def _admin_connect_url(u: str) -> str:
    """Connect to maintenance DB ``postgres`` to run CREATE DATABASE."""
    from urllib.parse import urlparse, urlunparse

    p = urlparse(_normalize_url(u))
    return urlunparse(p._replace(path="/postgres"))


def main() -> int:
    u = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if not u:
        print("No DATABASE_PUBLIC_URL or DATABASE_URL in environment.", file=sys.stderr)
        return 1

    admin_url = _admin_connect_url(u)
    conn = psycopg2.connect(admin_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s",
                (DB_NAME,),
            )
            if cur.fetchone():
                print(f"Database '{DB_NAME}' already exists — nothing to do.")
                return 0
            cur.execute(f'CREATE DATABASE "{DB_NAME}"')
            print(f"Created database '{DB_NAME}'.")
            return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
