"""
Seed the database with CSV data.

Usage:
    uv run seed.py                          # seed from default CSV path
    uv run seed.py --csv-dir /path/to/csvs  # seed from custom path
    uv run seed.py --drop                   # drop and recreate tables first
    uv run seed.py --merge                  # INSERT .. ON CONFLICT DO NOTHING (idempotent; safe for Railway re-runs)
    uv run seed.py --if-empty               # skip if users table already has rows (unless --drop)

Railway (from repo root, linked project):
    See scripts/seed-railway.ps1 — uses Postgres DATABASE_PUBLIC_URL (API service may have empty DATABASE_URL).
"""

import argparse
import csv
import os
import sys

# Railway sometimes exposes DATABASE_URL="" on a service; with python-dotenv (override=False) that blocks
# loading a real URL from url-shortener/.env. Treat empty as unset before importing the app.
if "DATABASE_URL" in os.environ and not os.environ.get("DATABASE_URL", "").strip():
    del os.environ["DATABASE_URL"]

from peewee import PostgresqlDatabase, chunked

from app import create_app
from app.database import db, sync_postgres_serial_sequences
from app.models.event import Event
from app.models.load_test_result import LoadTestResult
from app.models.url import Url
from app.models.user import User

DEFAULT_CSV_DIR = os.path.join(os.path.dirname(__file__), "csv_data")


def _reset_postgres_serial_sequences():
    """Same as app startup sync; kept for explicit seed completion and ``--fix-sequences-only``."""
    sync_postgres_serial_sequences()


def _insert_many(model, batch, merge: bool):
    q = model.insert_many(batch)
    if merge:
        q = q.on_conflict_ignore()
    return q.execute()


def load_users(csv_dir, merge: bool = False):
    filepath = os.path.join(csv_dir, "users.csv")
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  Loading {len(rows)} users...")
    with db.atomic():
        for batch in chunked(rows, 100):
            _insert_many(User, batch, merge)
    print(f"  OK - {len(rows)} users loaded")


def load_urls(csv_dir, merge: bool = False):
    filepath = os.path.join(csv_dir, "urls.csv")
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            row["is_active"] = row["is_active"] == "True"
            rows.append(row)

    print(f"  Loading {len(rows)} urls...")
    with db.atomic():
        for batch in chunked(rows, 100):
            _insert_many(Url, batch, merge)
    print(f"  OK - {len(rows)} urls loaded")


def load_events(csv_dir, merge: bool = False):
    filepath = os.path.join(csv_dir, "events.csv")
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  Loading {len(rows)} events...")
    with db.atomic():
        for batch in chunked(rows, 100):
            _insert_many(Event, batch, merge)
    print(f"  OK - {len(rows)} events loaded")


def seed(csv_dir, drop=False, merge: bool = False, if_empty: bool = False):
    tables = [User, Url, Event, LoadTestResult]

    if drop:
        print("Dropping existing tables...")
        db.drop_tables(tables, safe=True)
        print("  OK - Tables dropped")

    print("Creating tables...")
    db.create_tables(tables, safe=True)
    print("  OK - Tables created")

    if if_empty and not drop:
        try:
            n = User.select().count()
        except Exception as e:
            print(f"Error checking users count: {e}")
            raise
        if n > 0:
            print(f"Skipping seed: users table already has {n} row(s). Use --drop to replace, or omit --if-empty.")
            return

    print("Seeding data...")
    load_users(csv_dir, merge=merge)
    load_urls(csv_dir, merge=merge)
    load_events(csv_dir, merge=merge)
    _reset_postgres_serial_sequences()
    print("\nDone! Database seeded successfully.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the database with CSV data")
    parser.add_argument(
        "--csv-dir",
        default=DEFAULT_CSV_DIR,
        help="Path to directory containing CSV files",
    )
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop and recreate tables before seeding",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="PostgreSQL: skip rows that already exist (ON CONFLICT DO NOTHING). Safe to re-run.",
    )
    parser.add_argument(
        "--if-empty",
        action="store_true",
        dest="if_empty",
        help="Do nothing if users table already has at least one row (ignored with --drop)",
    )
    parser.add_argument(
        "--fix-sequences-only",
        action="store_true",
        help="PostgreSQL only: realign SERIAL sequences to MAX(id). Use after CSV seed with explicit ids.",
    )
    args = parser.parse_args()

    if not args.fix_sequences_only and not os.path.isdir(args.csv_dir):
        print(f"Error: CSV directory not found: {args.csv_dir}")
        sys.exit(1)

    app = create_app()
    with app.app_context():
        db.connect(reuse_if_open=True)
        try:
            if args.fix_sequences_only:
                underlying = getattr(db, "obj", db)
                if not isinstance(underlying, PostgresqlDatabase):
                    print("Not using PostgreSQL; nothing to do.")
                else:
                    _reset_postgres_serial_sequences()
                    print("PostgreSQL serial sequences updated (users, urls, events).")
            else:
                seed(
                    args.csv_dir,
                    drop=args.drop,
                    merge=args.merge,
                    if_empty=args.if_empty,
                )
        finally:
            if not db.is_closed():
                db.close()
