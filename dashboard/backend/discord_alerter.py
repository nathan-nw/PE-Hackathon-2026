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
        self._min_interval: float = (
            1.0  # seconds between sends (Discord rate-limit guard)
        )
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
            color = 3066993  # green

        method = entry.get("method", "?")
        path = entry.get("path", "?")
        instance = entry.get("instance_id", "?")
        duration = entry.get("duration_ms", "?")
        message = entry.get("message", "")
        timestamp = entry.get("timestamp", "")

        payload = json.dumps(
            {
                "embeds": [
                    {
                        "title": f"🔔 Alert: {method} {path}",
                        "color": color,
                        "fields": [
                            {
                                "name": "Instance",
                                "value": str(instance),
                                "inline": True,
                            },
                            {"name": "Status", "value": str(status), "inline": True},
                            {
                                "name": "Duration",
                                "value": f"{duration}ms",
                                "inline": True,
                            },
                            {"name": "Message", "value": message[:200] or "—"},
                        ],
                        "timestamp": timestamp,
                    }
                ],
            }
        ).encode("utf-8")

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

    # ------------------------------------------------------------------
    # Alertmanager webhook integration
    # ------------------------------------------------------------------

    def send_alertmanager_alerts(self, payload: dict) -> int:
        """Format Alertmanager webhook alerts and send to Discord.

        Returns the number of alerts forwarded.
        """
        if not self._enabled:
            return 0

        alerts = payload.get("alerts", [])
        if not alerts:
            return 0

        embeds: list[dict] = []
        for alert in alerts:
            status = alert.get("status", "unknown")
            labels = alert.get("labels", {})
            annotations = alert.get("annotations", {})
            severity = labels.get("severity", "unknown")
            alertname = labels.get("alertname", "Unknown Alert")
            instance = labels.get("instance", "")

            if status == "resolved":
                title = f"\u2705 RESOLVED: {alertname}"
                color = 3066993  # green
            elif severity == "critical":
                title = f"\U0001f6a8 FIRING: {alertname}"
                color = 15158332  # red
            else:
                title = f"\u26a0\ufe0f FIRING: {alertname}"
                color = 16750848  # orange

            fields = [
                {"name": "Severity", "value": severity, "inline": True},
                {"name": "Status", "value": status, "inline": True},
            ]
            if instance:
                fields.append({"name": "Instance", "value": instance, "inline": True})
            if annotations.get("summary"):
                fields.append(
                    {"name": "Summary", "value": annotations["summary"][:200]}
                )
            if annotations.get("description"):
                fields.append(
                    {"name": "Description", "value": annotations["description"][:400]}
                )

            if status == "resolved":
                ts = alert.get("endsAt", "") or alert.get("startsAt", "")
            else:
                ts = alert.get("startsAt", "")

            embeds.append(
                {
                    "title": title,
                    "color": color,
                    "fields": fields,
                    "timestamp": ts,
                }
            )

        # Discord allows max 10 embeds per message — split into batches
        sent = 0
        for i in range(0, len(embeds), 10):
            batch = embeds[i : i + 10]
            now = time.monotonic()
            if now - self._last_sent < self._min_interval:
                time.sleep(self._min_interval - (now - self._last_sent))

            try:
                body = json.dumps({"embeds": batch}).encode("utf-8")
                logger.info("Sending %d Alertmanager alert(s) to Discord", len(batch))
                req = urllib.request.Request(
                    self._webhook_url,
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "PE-Hackathon-DiscordAlerter/1.0",
                    },
                    method="POST",
                )
                resp = urllib.request.urlopen(req, timeout=5)
                logger.info("Discord response: %s", resp.status)
                self._last_sent = time.monotonic()
                sent += len(batch)
            except urllib.error.HTTPError as exc:
                logger.warning(
                    "Discord alertmanager alert HTTP error: %s body=%s",
                    exc,
                    exc.read().decode(),
                )
            except Exception as exc:
                logger.warning("Discord alertmanager alert failed: %s", exc)

        return sent
