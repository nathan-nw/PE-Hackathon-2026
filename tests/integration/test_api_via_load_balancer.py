"""Integration tests: API through the NGINX load balancer (compose publishes :8080).

Skipped unless ``TEST_LOAD_BALANCER_URL`` is set. From the **repo root**:

    docker compose up --build -d
    # PowerShell:
    $env:TEST_LOAD_BALANCER_URL = "http://127.0.0.1:8080"
    uv sync --group dev
    uv run pytest tests/integration -m integration -v

Use ``127.0.0.1`` on Windows if ``localhost`` resolves to IPv6 while the port is IPv4-only.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest

LB = os.environ.get("TEST_LOAD_BALANCER_URL", "").strip().rstrip("/")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not LB,
        reason="Set TEST_LOAD_BALANCER_URL (e.g. http://127.0.0.1:8080) with docker compose up",
    ),
]


def _url(path: str) -> str:
    p = path if path.startswith("/") else f"/{path}"
    return f"{LB}{p}"


def _get(path: str, *, timeout: float = 10.0) -> tuple[int, bytes, dict[str, str]]:
    req = urllib.request.Request(_url(path), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.getcode(), resp.read(), headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        hdrs = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
        return e.code, raw, hdrs


def test_lb_health():
    code, body, _ = _get("/health")
    assert code == 200
    data = json.loads(body.decode())
    assert data.get("status") == "ok"
    assert data.get("database") == "ok"


def test_lb_live():
    code, body, _ = _get("/live")
    assert code == 200
    assert json.loads(body.decode()).get("status") == "ok"


def test_lb_ready():
    code, body, _ = _get("/ready")
    assert code == 200
    assert json.loads(body.decode()).get("database") == "ok"


def test_lb_forwards_or_sets_request_id():
    """NGINX should pass X-Request-ID through (or app generates); response echoes it."""
    req = urllib.request.Request(
        _url("/live"),
        method="GET",
        headers={"X-Request-ID": "integration-test-rid"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        rid = resp.headers.get("X-Request-ID", "")
    assert rid == "integration-test-rid"


def test_lb_metrics_prometheus_text():
    code, body, _ = _get("/metrics")
    assert code == 200
    assert b"http_requests_total" in body


def test_lb_index_returns_html():
    code, body, headers = _get("/")
    assert code == 200
    assert len(body) > 0
    ctype = headers.get("content-type", "")
    assert "text/html" in ctype
