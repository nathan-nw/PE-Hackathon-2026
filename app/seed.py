"""Create tables and load CSV seeds (users → urls → events)."""

from __future__ import annotations

import csv
import os
from datetime import datetime
from pathlib import Path

from peewee import chunked, fn

from app.database import db
from app.models.event import Event
from app.models.url import Url
from app.models.user import User

_DT_FORMAT = "%Y-%m-%d %H:%M:%S"


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_csv_dir() -> Path:
    return Path(os.environ.get("SEED_CSV_DIR", _project_root() / "csv"))


def _parse_dt(value: str) -> datetime:
    return datetime.strptime(value.strip(), _DT_FORMAT)


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in ("true", "1", "yes")


def create_tables():
    db.create_tables([User, Url, Event], safe=True)


def _truncate_seed_tables():
    Event.delete().execute()
    Url.delete().execute()
    User.delete().execute()


def _sync_pk_sequence(model):
    table = model._meta.table_name
    m = model.select(fn.MAX(model.id)).scalar()
    if m is None:
        return
    db.execute_sql(
        "SELECT setval(pg_get_serial_sequence(%s, 'id'), %s)",
        [table, m],
    )


def _load_users(path: Path) -> int:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(
                {
                    "id": int(row["id"]),
                    "username": row["username"],
                    "email": row["email"],
                    "created_at": _parse_dt(row["created_at"]),
                }
            )
    with db.atomic():
        for batch in chunked(rows, 400):
            User.insert_many(batch).execute()
    _sync_pk_sequence(User)
    return len(rows)


def _load_urls(path: Path) -> int:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(
                {
                    "id": int(row["id"]),
                    "user": int(row["user_id"]),
                    "short_code": row["short_code"],
                    "original_url": row["original_url"],
                    "title": row["title"] or None,
                    "is_active": _parse_bool(row["is_active"]),
                    "created_at": _parse_dt(row["created_at"]),
                    "updated_at": _parse_dt(row["updated_at"]),
                }
            )
    with db.atomic():
        for batch in chunked(rows, 400):
            Url.insert_many(batch).execute()
    _sync_pk_sequence(Url)
    return len(rows)


def _load_events(path: Path) -> int:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            uid = row["user_id"].strip()
            rows.append(
                {
                    "id": int(row["id"]),
                    "url": int(row["url_id"]),
                    "user": int(uid) if uid else None,
                    "event_type": row["event_type"],
                    "timestamp": _parse_dt(row["timestamp"]),
                    "details": row["details"] or None,
                }
            )
    with db.atomic():
        for batch in chunked(rows, 400):
            Event.insert_many(batch).execute()
    _sync_pk_sequence(Event)
    return len(rows)


def seed_from_csv(csv_dir: Path | None = None, *, force: bool = False) -> tuple[int, int, int]:
    """
    Load users.csv, urls.csv, events.csv from csv_dir.
    If tables already contain users and force is False, skip loading.
    If force is True, delete existing rows first (URLs and events depend on users).
    """
    base = csv_dir or default_csv_dir()
    users_p = base / "users.csv"
    urls_p = base / "urls.csv"
    events_p = base / "events.csv"
    for p in (users_p, urls_p, events_p):
        if not p.is_file():
            raise FileNotFoundError(f"missing seed file: {p}")

    if User.select().count() > 0:
        if not force:
            return (0, 0, 0)
        _truncate_seed_tables()

    n_u = _load_users(users_p)
    n_l = _load_urls(urls_p)
    n_e = _load_events(events_p)
    return (n_u, n_l, n_e)
