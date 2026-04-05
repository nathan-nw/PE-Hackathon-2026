"""Test fixtures: swap Postgres for SQLite on disk (shared across connections)."""

from __future__ import annotations

import os
from datetime import UTC, datetime

import pytest
from peewee import SqliteDatabase

from app.database import db
from app.models.event import Event
from app.models.url import Url
from app.models.user import User


@pytest.fixture()
def app(tmp_path):
    """Flask app bound to an isolated SQLite database (never touches dev Postgres)."""
    # Set TESTING so create_app skips Postgres table creation.
    os.environ["TESTING"] = "1"

    from app import create_app

    application = create_app()
    application.config.update(TESTING=True)

    # create_app wires a Postgres pool via init_db; close and swap to SQLite.
    if not db.is_closed():
        db.close()

    db_path = tmp_path / "test.db"
    db.initialize(SqliteDatabase(str(db_path), pragmas={"foreign_keys": 1}))
    db.connect(reuse_if_open=True)

    from app.models.load_test_result import LoadTestResult

    db.create_tables([User, Url, Event, LoadTestResult], safe=True)

    try:
        yield application
    finally:
        if not db.is_closed():
            db.close()


@pytest.fixture(autouse=True)
def _reset_tables(app):
    """Clear data and ensure at least one user exists for routes that need it."""
    db.connect(reuse_if_open=True)
    Event.delete().execute()
    Url.delete().execute()
    User.delete().execute()
    User.create(
        id=1,
        username="testuser",
        email="test@example.com",
        created_at=datetime.now(UTC),
    )
    yield


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def sample_user():
    """The default seeded user (id=1)."""
    return User.get_by_id(1)


@pytest.fixture()
def sample_url(client):
    """One shortened URL created via the real API."""
    res = client.post(
        "/shorten",
        json={
            "original_url": "https://example.com/seed",
            "user_id": 1,
            "title": "seed",
        },
    )
    assert res.status_code == 201
    return res.get_json()
