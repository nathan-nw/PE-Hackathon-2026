"""End-to-end style tests: POST /api/ingest → cache → flush → DB (mocked).

Mirrors Railway HTTP log path (no Kafka): url-shortener ships the same JSON shape.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Sample shaped like app.middleware + log_record_to_payload / Kafka payload
_SAMPLE_INGEST = {
    "timestamp": "2026-04-05T12:00:00Z",
    "level": "INFO",
    "logger": "app.middleware",
    "message": "[abc123] GET /health -> 200 (5.0ms)",
    "instance_id": "1",
    "request_id": "abc123",
    "trace_id": "abc123",
    "method": "GET",
    "path": "/health",
    "status_code": 200,
    "duration_ms": 5.0,
}


@pytest.fixture
def ingest_client(monkeypatch: pytest.MonkeyPatch):
    """FastAPI app with Kafka off, DB init no-op, small cache."""
    monkeypatch.setenv("KAFKA_BOOTSTRAP_SERVERS", "")
    monkeypatch.setenv("LOG_INGEST_TOKEN", "test-ingest-token")
    monkeypatch.setenv("CACHE_MAX_ENTRIES", "100")
    monkeypatch.setenv("DB_FLUSH_INTERVAL", "99999")
    monkeypatch.setattr("db.init_db", lambda: True)

    import importlib

    import main

    importlib.reload(main)
    monkeypatch.setattr(main, "KAFKA_ENABLED", False)
    main.cache.clear()

    with TestClient(main.app) as client:
        yield client, main
    main.cache.stop_flush_loop()


class TestIngestPipeline:
    def test_ingest_requires_valid_token(self, ingest_client):
        client, main_mod = ingest_client
        r = client.post(
            "/api/ingest",
            json=[_SAMPLE_INGEST],
            headers={"X-Log-Ingest-Token": "wrong"},
        )
        assert r.status_code == 401

    def test_ingest_accepts_payload_and_shows_in_memory_logs(self, ingest_client):
        client, main_mod = ingest_client
        r = client.post(
            "/api/ingest",
            json=[_SAMPLE_INGEST],
            headers={"X-Log-Ingest-Token": "test-ingest-token"},
        )
        assert r.status_code == 200
        assert r.json()["ingested"] == 1

        logs = client.get("/api/logs?source=memory&limit=10").json()["logs"]
        assert len(logs) >= 1
        assert any(
            e.get("path") == "/health" and e.get("instance_id") == "1" for e in logs
        )

    def test_ingest_batch_array(self, ingest_client):
        client, main_mod = ingest_client
        second = {**_SAMPLE_INGEST, "instance_id": "2", "path": "/metrics"}
        r = client.post(
            "/api/ingest",
            json=[_SAMPLE_INGEST, second],
            headers={"X-Log-Ingest-Token": "test-ingest-token"},
        )
        assert r.status_code == 200
        assert r.json()["ingested"] == 2

    def test_health_shows_http_ingest_enabled(self, ingest_client):
        client, main_mod = ingest_client
        h = client.get("/api/health").json()
        assert h.get("http_ingest_enabled") is True
        assert h.get("kafka_enabled") is False

    @patch("main.fetch_logs_from_db")
    def test_merged_logs_combine_memory_and_db(self, mock_fetch, ingest_client):
        mock_fetch.return_value = [
            {
                "timestamp": "2026-04-05T11:00:00Z",
                "level": "INFO",
                "logger": "app.middleware",
                "message": "older",
                "instance_id": "1",
                "path": "/old",
            }
        ]
        client, main_mod = ingest_client
        client.post(
            "/api/ingest",
            json=[_SAMPLE_INGEST],
            headers={"X-Log-Ingest-Token": "test-ingest-token"},
        )
        merged = client.get("/api/logs?source=merged&limit=10").json()
        assert merged["source"] == "merged"
        assert len(merged["logs"]) >= 1

    @patch("db.flush_stats", return_value=1)
    @patch("db.flush_logs", return_value=1)
    def test_force_flush_calls_db_flush(self, mock_flush_logs, mock_flush_stats, ingest_client):
        client, main_mod = ingest_client
        client.post(
            "/api/ingest",
            json=[_SAMPLE_INGEST],
            headers={"X-Log-Ingest-Token": "test-ingest-token"},
        )
        r = client.post("/api/flush")
        assert r.status_code == 200
        mock_flush_logs.assert_called()
        args = mock_flush_logs.call_args[0][0]
        assert len(args) >= 1
        assert any(x.get("path") == "/health" for x in args)
