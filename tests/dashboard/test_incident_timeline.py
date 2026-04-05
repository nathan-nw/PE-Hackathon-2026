"""Tests for the incident timeline API endpoints."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def app_client():
    """FastAPI test client with mocked DB functions."""
    with patch("main.init_db", return_value=True):
        from main import app

        return TestClient(app)


class TestGetIncidents:
    def test_returns_empty_list(self, app_client):
        with patch("main.fetch_incident_events", return_value=[]):
            res = app_client.get("/api/incidents")
            assert res.status_code == 200
            data = res.json()
            assert data["events"] == []
            assert data["count"] == 0

    def test_returns_events(self, app_client):
        mock_events = [
            {
                "id": 1,
                "event_type": "alert_fired",
                "severity": "critical",
                "title": "[FIRING] High5xxRate",
                "description": "Error rate above 50%",
                "source": "prometheus",
                "alert_name": "High5xxRate",
                "status": "firing",
                "metadata": {},
                "created_at": "2026-04-05T12:00:00+00:00",
            }
        ]
        with patch("main.fetch_incident_events", return_value=mock_events):
            res = app_client.get("/api/incidents")
            assert res.status_code == 200
            data = res.json()
            assert data["count"] == 1
            assert data["events"][0]["alert_name"] == "High5xxRate"

    def test_filters_by_severity(self, app_client):
        with patch("main.fetch_incident_events", return_value=[]) as mock:
            app_client.get("/api/incidents?severity=critical")
            mock.assert_called_once_with(
                limit=100,
                event_type=None,
                severity="critical",
                window_hours=24,
            )

    def test_filters_by_window(self, app_client):
        with patch("main.fetch_incident_events", return_value=[]) as mock:
            app_client.get("/api/incidents?window_hours=6")
            mock.assert_called_once_with(
                limit=100,
                event_type=None,
                severity=None,
                window_hours=6,
            )


class TestClearIncidents:
    def test_clears_all(self, app_client):
        with patch("main.clear_incident_events", return_value=5):
            res = app_client.post("/api/incidents/clear")
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "cleared"
            assert data["deleted_rows"] == 5


class TestAlertmanagerWebhookRecordsIncidents:
    def test_records_firing_alert(self, app_client):
        payload = {
            "alerts": [
                {
                    "status": "firing",
                    "labels": {"alertname": "High5xxRate", "severity": "warning"},
                    "annotations": {"summary": "High error rate", "description": "5xx > 50%"},
                }
            ]
        }
        with patch("main.insert_incident_event", return_value=1) as mock_insert:
            res = app_client.post("/api/alertmanager-webhook", json=payload)
            assert res.status_code == 200
            data = res.json()
            assert data["recorded"] == 1
            mock_insert.assert_called_once()
            call_kwargs = mock_insert.call_args
            assert call_kwargs.kwargs["event_type"] == "alert_fired"
            assert call_kwargs.kwargs["severity"] == "warning"
            assert call_kwargs.kwargs["alert_name"] == "High5xxRate"

    def test_records_resolved_alert(self, app_client):
        payload = {
            "alerts": [
                {
                    "status": "resolved",
                    "labels": {"alertname": "High5xxRate", "severity": "critical"},
                    "annotations": {"summary": "Resolved"},
                }
            ]
        }
        with patch("main.insert_incident_event", return_value=2) as mock_insert:
            res = app_client.post("/api/alertmanager-webhook", json=payload)
            assert res.status_code == 200
            assert res.json()["recorded"] == 1
            call_kwargs = mock_insert.call_args
            assert call_kwargs.kwargs["event_type"] == "alert_resolved"
            assert call_kwargs.kwargs["severity"] == "info"
            assert call_kwargs.kwargs["status"] == "resolved"

    def test_empty_alerts_skipped(self, app_client):
        res = app_client.post("/api/alertmanager-webhook", json={"alerts": []})
        assert res.status_code == 200
        assert res.json()["recorded"] == 0

    def test_bad_json_returns_400(self, app_client):
        res = app_client.post(
            "/api/alertmanager-webhook",
            content=b"not json",
            headers={"Content-Type": "application/json"},
        )
        assert res.status_code == 400
