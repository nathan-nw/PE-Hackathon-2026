"""Tests for the Discord webhook alerter."""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

import pytest

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
    def test_get_request_triggers(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(method="GET")) is True

    def test_post_request_does_not_trigger(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(method="POST")) is False

    def test_delete_request_does_not_trigger(self):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        assert alerter.should_alert(_make_entry(method="DELETE")) is False

    def test_missing_method_does_not_trigger(self):
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

    @patch("discord_alerter.urllib.request.urlopen", side_effect=Exception("Discord down"))
    def test_handles_http_error(self, mock_urlopen):
        alerter = DiscordAlerter(webhook_url="https://example.com/webhook")
        # Should not raise
        alerter.maybe_alert(_make_entry())

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
