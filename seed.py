"""
Seed the database with CSV data.

Usage:
    uv run seed.py                          # seed from default CSV path
    uv run seed.py --csv-dir /path/to/csvs  # seed from custom path
    uv run seed.py --drop                   # drop and recreate tables first
"""

import argparse
import csv
import os
import sys

from peewee import chunked

from app import create_app
from app.database import db
from app.models.event import Event
from app.models.url import Url
from app.models.user import User

DEFAULT_CSV_DIR = os.path.join(os.path.dirname(__file__), "csv_data")


def load_users(csv_dir):
    filepath = os.path.join(csv_dir, "users.csv")
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  Loading {len(rows)} users...")
    with db.atomic():
        for batch in chunked(rows, 100):
            User.insert_many(batch).execute()
    print(f"  OK - {len(rows)} users loaded")


def load_urls(csv_dir):
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
            Url.insert_many(batch).execute()
    print(f"  OK - {len(rows)} urls loaded")


def load_events(csv_dir):
    filepath = os.path.join(csv_dir, "events.csv")
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  Loading {len(rows)} events...")
    with db.atomic():
        for batch in chunked(rows, 100):
            Event.insert_many(batch).execute()
    print(f"  OK - {len(rows)} events loaded")


def seed(csv_dir, drop=False):
    tables = [User, Url, Event]

    if drop:
        print("Dropping existing tables...")
        db.drop_tables(tables, safe=True)
        print("  OK - Tables dropped")

    print("Creating tables...")
    db.create_tables(tables, safe=True)
    print("  OK - Tables created")

    print("Seeding data...")
    load_users(csv_dir)
    load_urls(csv_dir)
    load_events(csv_dir)
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
    args = parser.parse_args()

    if not os.path.isdir(args.csv_dir):
        print(f"Error: CSV directory not found: {args.csv_dir}")
        sys.exit(1)

    app = create_app()
    with app.app_context():
        db.connect(reuse_if_open=True)
        try:
            seed(args.csv_dir, drop=args.drop)
        finally:
            if not db.is_closed():
                db.close()
