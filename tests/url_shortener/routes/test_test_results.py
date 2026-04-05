"""Tests for load test result storage routes."""


def test_store_test_result(client):
    payload = {
        "tier": "bronze",
        "state": {"testRunDurationMs": 30000},
        "metrics": {
            "http_req_duration": {"values": {"avg": 45.2, "p(95)": 120.0}},
            "http_reqs": {"values": {"count": 1000, "rate": 33.3}},
            "iterations": {"values": {"count": 500}},
            "vus_max": {"values": {"max": 50}},
            "errors": {"values": {"rate": 0.01}},
        },
    }
    res = client.post("/test-results", json=payload)
    assert res.status_code == 201
    data = res.get_json()
    assert "id" in data
    assert data["message"] == "Test result stored"


def test_store_test_result_no_data(client):
    res = client.post("/test-results", data="", content_type="application/json")
    assert res.status_code in (400, 500)  # no JSON body triggers error handling


def test_store_test_result_empty_metrics(client):
    res = client.post("/test-results", json={"tier": "silver", "metrics": {}, "state": {}})
    assert res.status_code == 201


def test_store_test_result_with_thresholds(client):
    payload = {
        "tier": "gold",
        "state": {"testRunDurationMs": 60000},
        "metrics": {
            "http_req_duration": {
                "values": {"avg": 50.0, "p(95)": 200.0},
                "thresholds": {"p95<500": {"ok": True}},
            },
            "http_reqs": {"values": {"count": 2000, "rate": 33.3}},
            "iterations": {"values": {"count": 1000}},
            "vus_max": {"values": {"max": 100}},
            "errors": {
                "values": {"rate": 0.05},
                "thresholds": {"rate<0.1": {"ok": True}, "rate<0.01": {"ok": False}},
            },
        },
    }
    res = client.post("/test-results", json=payload)
    assert res.status_code == 201


def test_list_test_results_empty(client):
    res = client.get("/test-results")
    assert res.status_code == 200
    assert isinstance(res.get_json(), list)


def test_list_test_results_after_store(client):
    client.post("/test-results", json={
        "tier": "bronze",
        "state": {"testRunDurationMs": 10000},
        "metrics": {
            "http_req_duration": {"values": {"avg": 30.0, "p(95)": 100.0}},
            "http_reqs": {"values": {"count": 100, "rate": 10.0}},
            "iterations": {"values": {"count": 50}},
            "vus_max": {"values": {"max": 10}},
        },
    })
    res = client.get("/test-results")
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) >= 1
    assert data[0]["tier"] == "bronze"


def test_list_test_results_filter_by_tier(client):
    client.post("/test-results", json={
        "tier": "silver",
        "state": {},
        "metrics": {
            "http_req_duration": {"values": {}},
            "http_reqs": {"values": {}},
            "iterations": {"values": {}},
            "vus_max": {"values": {}},
        },
    })
    res = client.get("/test-results?tier=silver")
    assert res.status_code == 200
    for r in res.get_json():
        assert r["tier"] == "silver"
