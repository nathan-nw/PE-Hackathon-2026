"""Tests for the Discord webhook alerter."""

from __future__ import annotations

import json
import time
from unittest.mock import patch


from discord_alerter import DiscordAlerter


def _make_entry(**overrides):
    base = {
        "timestamp": "2026-04-04T12:00:00Z",
        "level": "INFO",
        "logger": "app.middleware",
        "message": "GET /health -> 200",
        "instance_id": "1",
        "request_id": "abc123",
        "trace_id": "abc123",
        "method": "GET",
        "path": "/health",
        "status_code": 200,
        "duration_ms": 5.0,
    }
    base.update(overrides)
    return base


class TestShouldAlert:
    def test_5xx_triggers(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(status_code=500)) is True

    def test_503_triggers(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(status_code=503)) is True

    def test_error_level_triggers(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(level="ERROR")) is True

    def test_critical_level_triggers(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(level="CRITICAL")) is True

    def test_200_does_not_trigger(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(status_code=200, level="INFO")) is False

    def test_404_does_not_trigger(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert (
            alerter.should_alert(_make_entry(status_code=404, level="WARNING")) is False
        )

    def test_missing_fields_does_not_trigger(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert({}) is False


class TestDisabledAlerter:
    def test_no_url_disables(self):
        alerter = DiscordAlerter(webhook_url=None)
        assert not alerter._enabled

    def test_empty_url_disables(self):
        alerter = DiscordAlerter(webhook_url="")
        assert not alerter._enabled

    @patch("discord_alerter.urllib.request.urlopen")
    def test_maybe_alert_noop_when_disabled(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url=None)
        alerter.maybe_alert(_make_entry())
        mock_urlopen.assert_not_called()


class TestSendAlert:
    @patch("discord_alerter.urllib.request.urlopen")
    def test_formats_embed(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter.send_alert(_make_entry(status_code=200, path="/health"))

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))

        embed = body["embeds"][0]
        assert "/health" in embed["title"]
        assert embed["color"] == 3066993  # green for 2xx
        fields = {f["name"]: f["value"] for f in embed["fields"]}
        assert fields["Instance"] == "1"
        assert fields["Status"] == "200"

    @patch("discord_alerter.urllib.request.urlopen")
    def test_red_color_for_5xx(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter.send_alert(_make_entry(status_code=500))

        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        assert body["embeds"][0]["color"] == 15158332  # red

    @patch("discord_alerter.urllib.request.urlopen")
    def test_yellow_color_for_4xx(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter.send_alert(_make_entry(status_code=404))

        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        assert body["embeds"][0]["color"] == 16776960  # yellow

    @patch(
        "discord_alerter.urllib.request.urlopen", side_effect=Exception("Discord down")
    )
    def test_handles_http_error(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        # Should not raise
        alerter.maybe_alert(_make_entry(status_code=500))

    @patch("discord_alerter.urllib.request.urlopen")
    def test_rate_limiting(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter._min_interval = 0.5

        alerter.send_alert(_make_entry())
        alerter.send_alert(_make_entry())  # should be skipped (too soon)

        assert mock_urlopen.call_count == 1

    @patch("discord_alerter.urllib.request.urlopen")
    def test_sends_after_interval(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter._min_interval = 0.1

        alerter.send_alert(_make_entry())
        time.sleep(0.15)
        alerter.send_alert(_make_entry())

        assert mock_urlopen.call_count == 2


def _make_alertmanager_payload(*alerts):
    """Build an Alertmanager webhook payload."""
    return {"alerts": list(alerts)}


def _make_am_alert(alertname="TestAlert", severity="warning", status="firing", **extra):
    alert = {
        "status": status,
        "labels": {"alertname": alertname, "severity": severity},
        "annotations": {
            "summary": f"{alertname} is firing",
            "description": f"Details about {alertname}",
        },
        "startsAt": "2026-04-05T12:00:00Z",
        "endsAt": "0001-01-01T00:00:00Z",
        "generatorURL": "http://prometheus:9090/graph",
    }
    alert["labels"].update(extra)
    return alert


class TestAlertmanagerWebhook:
    @patch("discord_alerter.urllib.request.urlopen")
    def test_formats_firing_critical(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        payload = _make_alertmanager_payload(
            _make_am_alert("ServiceDown", severity="critical", status="firing")
        )
        count = alerter.send_alertmanager_alerts(payload)

        assert count == 1
        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        embed = body["embeds"][0]
        assert "FIRING" in embed["title"]
        assert "ServiceDown" in embed["title"]
        assert embed["color"] == 15158332  # red for critical

    @patch("discord_alerter.urllib.request.urlopen")
    def test_formats_firing_warning(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        payload = _make_alertmanager_payload(
            _make_am_alert("High5xxRate", severity="warning", status="firing")
        )
        count = alerter.send_alertmanager_alerts(payload)

        assert count == 1
        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        assert body["embeds"][0]["color"] == 16750848  # orange for warning

    @patch("discord_alerter.urllib.request.urlopen")
    def test_formats_resolved(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        payload = _make_alertmanager_payload(
            _make_am_alert("ServiceDown", severity="critical", status="resolved")
        )
        count = alerter.send_alertmanager_alerts(payload)

        assert count == 1
        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        embed = body["embeds"][0]
        assert "RESOLVED" in embed["title"]
        assert embed["color"] == 3066993  # green

    @patch("discord_alerter.urllib.request.urlopen")
    def test_includes_instance_label(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        payload = _make_alertmanager_payload(
            _make_am_alert("APITargetDown", instance="url-shortener-a:5000")
        )
        count = alerter.send_alertmanager_alerts(payload)

        assert count == 1
        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        fields = {f["name"]: f["value"] for f in body["embeds"][0]["fields"]}
        assert fields["Instance"] == "url-shortener-a:5000"

    @patch("discord_alerter.urllib.request.urlopen")
    def test_multiple_alerts_batched(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter._min_interval = 0
        alerts = [_make_am_alert(f"Alert{i}") for i in range(3)]
        payload = _make_alertmanager_payload(*alerts)
        count = alerter.send_alertmanager_alerts(payload)

        assert count == 3
        # All 3 in one message (under 10 limit)
        assert mock_urlopen.call_count == 1
        body = json.loads(mock_urlopen.call_args[0][0].data.decode("utf-8"))
        assert len(body["embeds"]) == 3

    @patch("discord_alerter.urllib.request.urlopen")
    def test_batch_splitting_over_10(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        alerter._min_interval = 0
        alerts = [_make_am_alert(f"Alert{i}") for i in range(12)]
        payload = _make_alertmanager_payload(*alerts)
        count = alerter.send_alertmanager_alerts(payload)

        assert count == 12
        assert mock_urlopen.call_count == 2  # 10 + 2

    def test_disabled_returns_zero(self):
        alerter = DiscordAlerter(webhook_url=None)
        payload = _make_alertmanager_payload(_make_am_alert())
        assert alerter.send_alertmanager_alerts(payload) == 0

    def test_empty_alerts_returns_zero(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.send_alertmanager_alerts({"alerts": []}) == 0
        assert alerter.send_alertmanager_alerts({}) == 0

    @patch(
        "discord_alerter.urllib.request.urlopen", side_effect=Exception("Discord down")
    )
    def test_handles_send_failure(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        payload = _make_alertmanager_payload(_make_am_alert())
        # Should not raise
        count = alerter.send_alertmanager_alerts(payload)
        assert count == 0
