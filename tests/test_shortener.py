"""URL shortener API tests."""

from __future__ import annotations


def test_list_urls_starts_empty(client):
    r = client.get("/urls")
    assert r.status_code == 200
    assert r.get_json() == []


def test_create_url_requires_original_url(client):
    r = client.post("/urls", json={})
    assert r.status_code == 400
    assert "original_url" in r.get_json().get("error", "").lower()


def test_create_url_rejects_non_http_url(client):
    r = client.post("/urls", json={"original_url": "ftp://x.com/a"})
    assert r.status_code == 400


def test_create_url_success(client):
    r = client.post(
        "/urls",
        json={"original_url": "https://example.com/path", "title": "Hi", "user_id": 1},
    )
    assert r.status_code == 201
    data = r.get_json()
    assert data["original_url"] == "https://example.com/path"
    assert data["title"] == "Hi"
    assert data["user_id"] == 1
    assert data["is_active"] is True
    assert len(data["short_code"]) == 6


def test_create_url_defaults_to_first_user(client):
    r = client.post("/urls", json={"original_url": "https://example.org/"})
    assert r.status_code == 201
    assert r.get_json()["user_id"] == 1


def test_get_url_by_id(client):
    created = client.post("/urls", json={"original_url": "https://a.com/", "user_id": 1}).get_json()
    rid = created["id"]
    r = client.get(f"/urls/{rid}")
    assert r.status_code == 200
    assert r.get_json()["short_code"] == created["short_code"]


def test_get_url_not_found(client):
    r = client.get("/urls/99999")
    assert r.status_code == 404


def test_list_urls_filter_active_and_user(client):
    client.post("/urls", json={"original_url": "https://one.com/", "user_id": 1})
    c2 = client.post("/urls", json={"original_url": "https://two.com/", "user_id": 1}).get_json()
    client.patch(f"/urls/{c2['id']}/deactivate")

    all_rows = client.get("/urls").get_json()
    assert len(all_rows) == 2

    active = client.get("/urls?active=true").get_json()
    assert len(active) == 1

    by_user = client.get("/urls?user_id=1").get_json()
    assert len(by_user) == 2


def test_redirect_active_short_code(client):
    c = client.post("/urls", json={"original_url": "https://dest.example/foo"}).get_json()
    code = c["short_code"]
    r = client.get(f"/r/{code}", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["Location"] == "https://dest.example/foo"


def test_redirect_logs_click_event(client):
    c = client.post("/urls", json={"original_url": "https://click.test/"}).get_json()
    client.get(f"/r/{c['short_code']}", follow_redirects=False)
    ev = client.get("/events?event_type=clicked").get_json()
    assert any(e["url_id"] == c["id"] and e["event_type"] == "clicked" for e in ev)


def test_redirect_unknown_code_404(client):
    r = client.get("/r/nopeAA", follow_redirects=False)
    assert r.status_code == 404
    assert r.is_json


def test_redirect_inactive_404(client):
    c = client.post("/urls", json={"original_url": "https://inactive.test/"}).get_json()
    client.patch(f"/urls/{c['id']}/deactivate")
    r = client.get(f"/r/{c['short_code']}", follow_redirects=False)
    assert r.status_code == 404


def test_deactivate_url(client):
    c = client.post("/urls", json={"original_url": "https://d.test/"}).get_json()
    r = client.patch(f"/urls/{c['id']}/deactivate")
    assert r.status_code == 200
    data = r.get_json()
    assert data["is_active"] is False

    ev = client.get("/events?event_type=deactivated").get_json()
    assert any(e["url_id"] == c["id"] for e in ev)


def test_events_filter_url_id(client):
    a = client.post("/urls", json={"original_url": "https://a.events/"}).get_json()
    client.post("/urls", json={"original_url": "https://b.events/"})
    ev = client.get(f"/events?url_id={a['id']}").get_json()
    assert all(e["url_id"] == a["id"] for e in ev)


def test_post_urls_creates_event(client):
    c = client.post("/urls", json={"original_url": "https://created.ev/"}).get_json()
    ev = client.get("/events?event_type=created").get_json()
    assert any(e["url_id"] == c["id"] and e["event_type"] == "created" for e in ev)
