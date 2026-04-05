"""Optional Discord webhooks for compose-watchdog (local Docker) events."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

# Match dashboard watchdog-discord.ts: red = exited, yellow = restart/recovery, green = healthy again.
_EMBED_RED = 15548997
_EMBED_YELLOW = 16705372
_EMBED_GREEN = 5763719

_UA = "PE-Hackathon-ComposeWatchdog/1.0"
_last_post_m = 0.0
_MIN_INTERVAL = 0.9


def _webhook_url() -> str:
    return (
        os.environ.get("WATCHDOG_DISCORD_WEBHOOK_URL", "").strip()
        or os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    )


def _post_embeds(embeds: list[dict]) -> None:
    global _last_post_m
    url = _webhook_url()
    if not url or not embeds:
        return
    now = time.monotonic()
    wait = _MIN_INTERVAL - (now - _last_post_m)
    if wait > 0:
        time.sleep(wait)
    body = json.dumps({"embeds": embeds[:10]}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": _UA,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            _last_post_m = time.monotonic()
            if resp.status >= 400:
                logger.warning("Discord webhook HTTP %s", resp.status)
    except urllib.error.HTTPError as e:
        logger.warning("Discord webhook failed: %s %s", e.code, e.read().decode()[:200])
    except Exception as e:
        logger.warning("Discord webhook failed: %s", e)


def notify_exited(service: str, container_short: str) -> None:
    """Container is stopped/exited — matches 'broken and exited'."""
    if not _webhook_url():
        return
    _post_embeds(
        [
            {
                "title": "Compose watchdog: container exited",
                "description": (
                    f"**{service}** (`{container_short}`) is in **exited** state. "
                    "Starting it if restart policy allows."
                ),
                "color": _EMBED_RED,
                "footer": {"text": "compose-watchdog"},
            }
        ]
    )


def notify_started_after_exit(service: str, container_short: str) -> None:
    """Recovery after exit — 'redeploying' equivalent locally."""
    if not _webhook_url():
        return
    _post_embeds(
        [
            {
                "title": "Compose watchdog: container started",
                "description": (
                    f"**{service}** (`{container_short}`) was **started** after being exited."
                ),
                "color": _EMBED_GREEN,
                "footer": {"text": "compose-watchdog"},
            }
        ]
    )


def notify_unhealthy_restart(service: str, container_short: str) -> None:
    """Unhealthy container restart."""
    if not _webhook_url():
        return
    _post_embeds(
        [
            {
                "title": "Compose watchdog: restarting unhealthy container",
                "description": (
                    f"**{service}** (`{container_short}`) failed health checks; "
                    "**restarting** now."
                ),
                "color": _EMBED_YELLOW,
                "footer": {"text": "compose-watchdog"},
            }
        ]
    )
