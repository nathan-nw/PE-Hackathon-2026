"""Discord webhook alerter triggered by Kafka log entries."""

from __future__ import annotations

import json
import logging
import time
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)


class DiscordAlerter:
    """Sends Discord webhook messages for matching Kafka log entries.

    Phase 1: alerts on every GET request (easy to test).
    Phase 2: switch should_alert() to errors only.
    """

    def __init__(self, webhook_url: str | None) -> None:
        self._webhook_url = webhook_url or ""
        self._enabled = bool(self._webhook_url)
        self._last_sent: float = 0.0
        self._min_interval: float = 1.0  # seconds between sends (Discord rate-limit guard)
        if self._enabled:
            logger.info("Discord alerter enabled")
        else:
            logger.info("Discord alerter disabled (no webhook URL)")

    def should_alert(self, entry: dict) -> bool:
        """Decide whether this log entry should trigger a Discord alert."""
        status = int(entry.get("status_code", 0))
        level = entry.get("level", "").upper()
        return status >= 500 or level in ("ERROR", "CRITICAL")

    def send_alert(self, entry: dict) -> None:
        """POST a formatted embed to the Discord webhook."""
        now = time.monotonic()
        if now - self._last_sent < self._min_interval:
            return

        status = int(entry.get("status_code", 0))
        if status >= 500:
            color = 15158332  # red
        elif status >= 400:
            color = 16776960  # yellow
        else:
            color = 3066993   # green

        method = entry.get("method", "?")
        path = entry.get("path", "?")
        instance = entry.get("instance_id", "?")
        duration = entry.get("duration_ms", "?")
        message = entry.get("message", "")
        timestamp = entry.get("timestamp", "")

        payload = json.dumps({
            "embeds": [{
                "title": f"🔔 Alert: {method} {path}",
                "color": color,
                "fields": [
                    {"name": "Instance", "value": str(instance), "inline": True},
                    {"name": "Status", "value": str(status), "inline": True},
                    {"name": "Duration", "value": f"{duration}ms", "inline": True},
                    {"name": "Message", "value": message[:200] or "—"},
                ],
                "timestamp": timestamp,
            }],
        }).encode("utf-8")

        req = urllib.request.Request(
            self._webhook_url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "PE-Hackathon-DiscordAlerter/1.0",
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
        self._last_sent = now

    def maybe_alert(self, entry: dict) -> None:
        """Check and send alert. Never raises — safe to call from the consumer loop."""
        if not self._enabled:
            return
        try:
            if self.should_alert(entry):
                self.send_alert(entry)
        except Exception as exc:
            logger.warning("Discord alert failed: %s", exc)
