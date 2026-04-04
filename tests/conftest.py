"""Pytest fixtures: SQLite in-memory locally; PostgreSQL from env in CI (matches workflow)."""

from __future__ import annotations

import os
from datetime import datetime

import pytest
from peewee import SqliteDatabase

from app import create_app
from app.database import db
from app.models.event import Event
from app.models.url import Url
from app.models.user import User


def _using_ci_postgres() -> bool:
    return os.environ.get("CI") == "true"


@pytest.fixture()
def app(tmp_path):
    """Flask app with fresh schema; CI uses the service Postgres, otherwise SQLite on disk."""
    application = create_app()
    application.config.update(TESTING=True)

    if not _using_ci_postgres():
        # File-backed SQLite so every request connection sees the same tables (":memory:" is per-connection).
        db.initialize(SqliteDatabase(str(tmp_path / "pytest.db")))

    db.connect(reuse_if_open=True)
    db.create_tables([User, Url, Event], safe=True)

    yield application

    if db and not db.is_closed():
        db.close()


@pytest.fixture(autouse=True)
def _seed_user(app):
    """One user (id=1) before each test; clears URL and event rows."""
    db.connect(reuse_if_open=True)
    Event.delete().execute()
    Url.delete().execute()
    User.delete().execute()
    User.create(
        id=1,
        username="tester",
        email="tester@example.com",
        created_at=datetime(2024, 1, 1, 12, 0, 0),
    )
    yield


@pytest.fixture()
def client(app):
    return app.test_client()
