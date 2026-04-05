"""Tests for graceful error handling — garbage input always returns clean JSON, never crashes."""

from __future__ import annotations


# ── Malformed / missing JSON body ──


def test_shorten_malformed_json_returns_400(client):
    """Sending garbage text instead of JSON returns a clean 400 with a hint."""
    res = client.post(
        "/shorten",
        data="this is not json",
        content_type="application/json",
    )
    assert res.status_code == 400
    body = res.get_json()
    assert "error" in body
    assert "json" in body["error"].lower() or "json" in body.get("hint", "").lower()


def test_shorten_no_body_returns_400(client):
    """POST with no body at all returns 400, not 500."""
    res = client.post("/shorten", content_type="application/json")
    assert res.status_code == 400
    body = res.get_json()
    assert "error" in body


def test_shorten_array_body_returns_400(client):
    """Sending a JSON array instead of an object returns 400."""
    res = client.post("/shorten", json=[1, 2, 3])
    assert res.status_code == 400
    body = res.get_json()
    assert "error" in body


# ── URL validation ──


def test_shorten_invalid_url_no_scheme_returns_400(client):
    """A URL without http/https is rejected."""
    res = client.post(
        "/shorten",
        json={"original_url": "not-a-url", "user_id": 1},
    )
    assert res.status_code == 400
    assert "http" in res.get_json()["error"].lower()


def test_shorten_invalid_url_ftp_scheme_returns_400(client):
    """Only http and https are accepted."""
    res = client.post(
        "/shorten",
        json={"original_url": "ftp://files.example.com/doc", "user_id": 1},
    )
    assert res.status_code == 400
    assert "http" in res.get_json()["error"].lower()


def test_shorten_invalid_url_empty_string_returns_400(client):
    res = client.post(
        "/shorten",
        json={"original_url": "", "user_id": 1},
    )
    assert res.status_code == 400
    assert "error" in res.get_json()


def test_shorten_invalid_url_no_domain_returns_400(client):
    res = client.post(
        "/shorten",
        json={"original_url": "http://", "user_id": 1},
    )
    assert res.status_code == 400
    assert "domain" in res.get_json()["error"].lower()


# ── Type validation ──


def test_shorten_user_id_string_returns_400(client):
    """user_id must be an integer, not a string."""
    res = client.post(
        "/shorten",
        json={"original_url": "https://example.com", "user_id": "abc"},
    )
    assert res.status_code == 400
    assert "integer" in res.get_json()["error"].lower()


def test_shorten_user_id_float_returns_400(client):
    res = client.post(
        "/shorten",
        json={"original_url": "https://example.com", "user_id": 1.5},
    )
    assert res.status_code == 400
    assert "integer" in res.get_json()["error"].lower()


def test_shorten_title_non_string_returns_400(client):
    res = client.post(
        "/shorten",
        json={"original_url": "https://example.com", "user_id": 1, "title": 12345},
    )
    assert res.status_code == 400
    assert "title" in res.get_json()["error"].lower()


# ── Update route validation ──


def test_update_malformed_json_returns_400(client, sample_url):
    res = client.put(
        f"/urls/{sample_url['id']}",
        data="not json",
        content_type="application/json",
    )
    assert res.status_code == 400
    body = res.get_json()
    assert "error" in body


def test_update_invalid_url_returns_400(client, sample_url):
    res = client.put(
        f"/urls/{sample_url['id']}",
        json={"original_url": "not-a-url"},
    )
    assert res.status_code == 400
    assert "http" in res.get_json()["error"].lower()


def test_update_valid_url_accepted(client, sample_url):
    res = client.put(
        f"/urls/{sample_url['id']}",
        json={"original_url": "https://updated.example.com"},
    )
    assert res.status_code == 200
    assert res.get_json()["original_url"] == "https://updated.example.com"


# ── HTTP method errors ──


def test_wrong_method_returns_405_json(client):
    """DELETE on /shorten should return 405 JSON, not an HTML error page."""
    res = client.delete("/shorten")
    assert res.status_code == 405
    body = res.get_json()
    assert body is not None
    assert "error" in body


# ── 404 returns JSON ──


def test_unknown_route_returns_404_json(client):
    """A completely unknown route returns JSON, not an HTML 404."""
    res = client.get("/this/route/does/not/exist")
    assert res.status_code == 404
    body = res.get_json()
    assert body is not None
    assert "error" in body


# ── All errors have consistent shape ──


def test_all_error_responses_are_json(client):
    """Batch check: every kind of bad request returns valid JSON with an 'error' key."""
    bad_requests = [
        ("POST", "/shorten", "garbage"),
        ("POST", "/shorten", "{}"),
        ("GET", "/urls/999999", None),
        ("GET", "/nosuchcode", None),
        ("DELETE", "/urls/999999", None),
    ]
    for method, path, data in bad_requests:
        if data:
            res = client.open(
                path,
                method=method,
                data=data,
                content_type="application/json",
            )
        else:
            res = client.open(path, method=method)

        body = res.get_json()
        assert body is not None, f"{method} {path} did not return JSON"
        assert "error" in body, f"{method} {path} missing 'error' key"
