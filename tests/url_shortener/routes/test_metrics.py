def test_metrics_endpoint(client):
    """GET /metrics returns Prometheus text including http_requests_total."""
    response = client.get("/metrics")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert "http_requests_total" in body
    assert "http_request_duration_seconds" in body
