def test_health_endpoint(client):
    """Verify the /health endpoint returns status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"
    assert data["database"] == "ok"
    assert "circuit_breaker" in data
