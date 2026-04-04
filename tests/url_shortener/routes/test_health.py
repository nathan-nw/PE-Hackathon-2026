def test_health_endpoint(client):
    """Verify the /health endpoint returns status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"
    assert data["database"] == "ok"
    assert "circuit_breaker" in data
    assert data.get("instance_id") == "1"


def test_live_endpoint(client):
    """GET /live — liveness without DB."""
    res = client.get("/live")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


def test_ready_endpoint_ok(client):
    """GET /ready — readiness with SQLite test DB."""
    res = client.get("/ready")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "ok"
    assert data["database"] == "ok"


def test_request_id_propagates_from_header(client):
    """X-Request-ID from client is echoed on the response."""
    res = client.get("/live", headers={"X-Request-ID": "trace-from-edge-99"})
    assert res.status_code == 200
    assert res.headers.get("X-Request-ID") == "trace-from-edge-99"


def test_instance_stats_json(client):
    """GET /api/instance-stats returns replica metrics (no DB)."""
    res = client.get("/api/instance-stats")
    assert res.status_code == 200
    data = res.get_json()
    assert data["instance_id"] == "1"
    assert "cpu_percent_process" in data
    assert "memory_rss_mb" in data
    assert "avg_request_latency_ms" in data
    assert "uptime_seconds" in data
