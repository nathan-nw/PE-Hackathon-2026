"""Tests for event routes."""

import pytest


@pytest.fixture()
def url_id(client):
    """Create a URL and return its id."""
    res = client.post("/shorten", json={
        "original_url": "https://example.com/event-test",
        "user_id": 1,
        "title": "event test",
    })
    return res.get_json()["id"]


def test_list_events_empty(client):
    res = client.get("/events")
    assert res.status_code == 200
    assert isinstance(res.get_json(), list)


def test_create_event(client, url_id):
    res = client.post("/events", json={
        "url_id": url_id,
        "user_id": 1,
        "event_type": "click",
    })
    assert res.status_code == 201
    data = res.get_json()
    assert data["event_type"] == "click"


def test_create_event_missing_fields(client):
    res = client.post("/events", json={"url_id": 1})
    assert res.status_code == 400


def test_create_event_invalid_url_id_type(client):
    res = client.post("/events", json={
        "url_id": "not_int",
        "user_id": 1,
        "event_type": "click",
    })
    assert res.status_code == 400


def test_create_event_invalid_user_id_type(client):
    res = client.post("/events", json={
        "url_id": 1,
        "user_id": "not_int",
        "event_type": "click",
    })
    assert res.status_code == 400


def test_create_event_empty_event_type(client):
    res = client.post("/events", json={
        "url_id": 1,
        "user_id": 1,
        "event_type": "",
    })
    assert res.status_code == 400


def test_create_event_url_not_found(client):
    res = client.post("/events", json={
        "url_id": 99999,
        "user_id": 1,
        "event_type": "click",
    })
    assert res.status_code == 404


def test_create_event_user_not_found(client, url_id):
    res = client.post("/events", json={
        "url_id": url_id,
        "user_id": 99999,
        "event_type": "click",
    })
    assert res.status_code == 404


def test_create_event_with_details(client, url_id):
    res = client.post("/events", json={
        "url_id": url_id,
        "user_id": 1,
        "event_type": "click",
        "details": {"referrer": "https://google.com"},
    })
    assert res.status_code == 201


def test_list_events_filters(client, url_id):
    # Create an event first
    client.post("/events", json={
        "url_id": url_id,
        "user_id": 1,
        "event_type": "click",
    })
    # Filter by url_id
    res = client.get(f"/events?url_id={url_id}")
    assert res.status_code == 200
    assert len(res.get_json()) >= 1

    # Filter by user_id
    res = client.get("/events?user_id=1")
    assert res.status_code == 200

    # Filter by event_type
    res = client.get("/events?event_type=click")
    assert res.status_code == 200


def test_create_event_boolean_url_id(client):
    """Boolean values should be rejected even though bool is subclass of int."""
    res = client.post("/events", json={
        "url_id": True,
        "user_id": 1,
        "event_type": "click",
    })
    assert res.status_code == 400
