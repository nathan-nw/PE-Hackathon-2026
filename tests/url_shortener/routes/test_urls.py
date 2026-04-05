"""Route tests for the URL shortener — behavior matches `app/routes/urls.py`."""

from __future__ import annotations


def _fk_id(value):
    """Peewee model_to_dict may return raw ids or nested dicts for FKs."""
    if isinstance(value, dict):
        return value.get("id")
    return value


def test_get_index_returns_html(client):
    res = client.get("/")
    assert res.status_code == 200
    assert b"text/html" in res.headers.get("Content-Type", "").encode()
    assert len(res.data) > 0


def test_post_shorten_creates_url(client):
    res = client.post(
        "/shorten",
        json={"original_url": "https://example.com/a", "user_id": 1, "title": "t"},
    )
    assert res.status_code == 201
    data = res.get_json()
    assert "id" in data
    assert "short_code" in data
    assert data["original_url"] == "https://example.com/a"
    assert _fk_id(data["user_id"]) == 1


def test_post_shorten_missing_fields(client):
    res = client.post("/shorten", json={})
    assert res.status_code == 400
    assert "required" in res.get_json()["error"].lower()


def test_post_shorten_missing_user_id(client):
    res = client.post("/shorten", json={"original_url": "https://x.com"})
    assert res.status_code == 400


def test_post_shorten_user_not_found(client):
    res = client.post(
        "/shorten",
        json={"original_url": "https://example.com/x", "user_id": 99999},
    )
    assert res.status_code == 404


def test_post_shorten_duplicate_short_code(client):
    client.post(
        "/shorten",
        json={
            "original_url": "https://a.com",
            "user_id": 1,
            "short_code": "ABCXYZ",
        },
    )
    res = client.post(
        "/shorten",
        json={
            "original_url": "https://b.com",
            "user_id": 1,
            "short_code": "ABCXYZ",
        },
    )
    assert res.status_code == 409


def test_get_short_code_redirects(client, sample_url):
    code = sample_url["short_code"]
    res = client.get(f"/{code}", follow_redirects=False)
    assert res.status_code == 302
    assert res.headers["Location"] == sample_url["original_url"]


def test_get_short_code_not_found(client):
    res = client.get("/nosuch", follow_redirects=False)
    assert res.status_code == 404
    assert res.is_json
    assert "error" in res.get_json()


def test_get_short_code_inactive_returns_410(client):
    created = client.post(
        "/shorten",
        json={"original_url": "https://inactive.test", "user_id": 1},
    ).get_json()
    cid = created["id"]
    client.put(f"/urls/{cid}", json={"is_active": False})
    res = client.get(f"/{created['short_code']}", follow_redirects=False)
    assert res.status_code == 410
    assert "deactivated" in res.get_json()["error"].lower()


def test_redirect_logs_click_event(client, sample_url):
    """Resolution path creates a click event for tracking."""
    before = client.get(f"/urls/{sample_url['id']}/events").get_json()
    n_before = len(before)
    client.get(f"/{sample_url['short_code']}", follow_redirects=False)
    after = client.get(f"/urls/{sample_url['id']}/events").get_json()
    assert len(after) == n_before + 1
    assert after[0]["event_type"] == "click"


def test_get_urls_list_shape_and_pagination(client):
    client.post("/shorten", json={"original_url": "https://p1.com", "user_id": 1})
    res = client.get("/urls?page=1&per_page=10")
    assert res.status_code == 200
    body = res.get_json()
    assert "data" in body
    assert "page" in body
    assert "per_page" in body
    assert "total" in body
    assert isinstance(body["data"], list)


def test_get_url_by_id(client, sample_url):
    res = client.get(f"/urls/{sample_url['id']}")
    assert res.status_code == 200
    assert res.get_json()["short_code"] == sample_url["short_code"]


def test_get_url_not_found(client):
    res = client.get("/urls/999999")
    assert res.status_code == 404


def test_put_url_updates_fields(client, sample_url):
    uid = sample_url["id"]
    res = client.put(
        f"/urls/{uid}",
        json={"title": "new title", "original_url": "https://new.example/"},
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["title"] == "new title"
    assert data["original_url"] == "https://new.example/"

    again = client.get(f"/urls/{uid}").get_json()
    assert again["title"] == "new title"


def test_put_url_empty_body(client, sample_url):
    res = client.put(f"/urls/{sample_url['id']}", json={})
    assert res.status_code == 400


def test_put_url_not_found(client):
    res = client.put("/urls/999999", json={"title": "x"})
    assert res.status_code == 404


def test_delete_url_soft_delete(client, sample_url):
    uid = sample_url["id"]
    code = sample_url["short_code"]
    res = client.delete(f"/urls/{uid}")
    assert res.status_code == 200
    assert "deleted" in res.get_json().get("message", "").lower()

    get_res = client.get(f"/urls/{uid}")
    assert get_res.get_json().get("is_active") is False

    red = client.get(f"/{code}", follow_redirects=False)
    assert red.status_code == 410


def test_delete_url_not_found(client):
    res = client.delete("/urls/999999")
    assert res.status_code == 200


def test_get_user_urls(client):
    client.post("/shorten", json={"original_url": "https://u1.com", "user_id": 1})
    res = client.get("/users/1/urls")
    assert res.status_code == 200
    rows = res.get_json()
    assert isinstance(rows, list)
    assert all(_fk_id(r["user_id"]) == 1 for r in rows)


def test_get_user_urls_unknown_user(client):
    res = client.get("/users/99999/urls")
    assert res.status_code == 404


def test_get_url_events(client, sample_url):
    uid = sample_url["id"]
    res = client.get(f"/urls/{uid}/events")
    assert res.status_code == 200
    events = res.get_json()
    assert isinstance(events, list)
    assert any(e["event_type"] == "created" for e in events)
    assert all(_fk_id(e["url_id"]) == uid for e in events)


def test_get_url_events_not_found(client):
    res = client.get("/urls/999999/events")
    assert res.status_code == 404
