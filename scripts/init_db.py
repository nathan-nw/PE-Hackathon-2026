#!/usr/bin/env python3
"""Create tables and load CSV seeds. Run from repo root: uv run python scripts/init_db.py"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv

load_dotenv(_ROOT / ".env")

from app.database import configure_database, db  # noqa: E402
from app import models  # noqa: F401, E402
from app.seed import create_tables, seed_from_csv  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Create tables and load CSV seeds.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Clear users/urls/events and reload CSVs even if data exists.",
    )
    parser.add_argument(
        "--csv-dir",
        type=Path,
        default=None,
        help="Directory containing users.csv, urls.csv, events.csv (default: ./csv or SEED_CSV_DIR).",
    )
    args = parser.parse_args()

    configure_database()
    db.connect()
    try:
        create_tables()
        n_u, n_l, n_e = seed_from_csv(csv_dir=args.csv_dir, force=args.force)
        if n_u == 0 and not args.force:
            print("Seed skipped: tables already contain users. Use --force to reload.")
        else:
            print(f"Seeded: {n_u} users, {n_l} urls, {n_e} events.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
