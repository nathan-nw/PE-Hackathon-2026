"""Optional Discord webhooks for compose-watchdog (local Docker) events."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
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

# Keep in sync with dashboard/src/lib/happy-branding.ts (HAPPY_AGENT_AVATAR_URL).
_DEFAULT_HAPPY_AVATAR = (
    "https://scontent-yyz1-1.xx.fbcdn.net/v/t39.30808-1/"
    "309431358_839585507201666_5985498661297484474_n.jpg"
    "?stp=dst-jpg_s200x200_tt6&_nc_cat=108&ccb=1-7&_nc_sid=2d3e12"
    "&_nc_ohc=KFjupLz53d4Q7kNvwFbX2BC&_nc_oc=AdoaeOOiDneeCg_USvKqpjpNxM5PNb9H122XsKrB3IJBjqw6DL9FYOQofTuBt7cYl4A"
    "&_nc_zt=24&_nc_ht=scontent-yyz1-1.xx&_nc_gid=SgAVuAma207_wNxbkFIvug&_nc_ss=7a3a8"
    "&oh=00_Af3p3gPSNBSYzggOstJkRUDatjpjl2dKqPiWxl-GsG6YfA&oe=69D83B42"
)


def _happy_identity() -> tuple[str, str]:
    """Same display name + avatar as the Happy ops agent in the dashboard."""
    name = (
        os.environ.get("WATCHDOG_DISCORD_USERNAME", "").strip()
        or os.environ.get("HAPPY_AGENT_DISCORD_USERNAME", "").strip()
        or "Happy"
    )
    avatar = (
        os.environ.get("WATCHDOG_DISCORD_AVATAR_URL", "").strip()
        or os.environ.get("HAPPY_AGENT_AVATAR_URL", "").strip()
        or _DEFAULT_HAPPY_AVATAR
    )
    return name, avatar


def _webhook_url() -> str:
    return (
        os.environ.get("WATCHDOG_DISCORD_WEBHOOK_URL", "").strip()
        or os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    )


def _compose_event(kind: str, service: str, message: str, **extra: object) -> dict:
    eid = f"compose-{kind}-{service}-{uuid.uuid4().hex}"
    ev: dict = {
        "id": eid,
        "kind": kind,
        "service": service,
        "message": message,
        **{k: v for k, v in extra.items() if v is not None},
    }
    return ev


def _persist_watchdog_alerts_to_backend(events: list[dict]) -> None:
    """POST to dashboard-backend ``/api/watchdog-alerts/ingest`` when ``DASHBOARD_BACKEND_URL`` is set."""
    if not events:
        return
    base = os.environ.get("DASHBOARD_BACKEND_URL", "").strip().rstrip("/")
    if not base:
        return
    token = (
        os.environ.get("WATCHDOG_ALERTS_INGEST_TOKEN", "").strip()
        or os.environ.get("LOG_INGEST_TOKEN", "").strip()
    )
    insecure = os.environ.get("ALLOW_INSECURE_LOG_INGEST", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if not token and not insecure:
        return
    body = json.dumps({"source": "compose", "events": events}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": _UA,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-Watchdog-Alerts-Token"] = token
    req = urllib.request.Request(
        f"{base}/api/watchdog-alerts/ingest",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status >= 400:
                logger.warning("watchdog alerts ingest HTTP %s", resp.status)
    except urllib.error.HTTPError as e:
        logger.warning(
            "watchdog alerts ingest failed: %s %s", e.code, e.read().decode()[:200]
        )
    except Exception as e:
        logger.warning("watchdog alerts ingest failed: %s", e)


def _post_embeds(embeds: list[dict]) -> None:
    global _last_post_m
    url = _webhook_url()
    if not url or not embeds:
        return
    now = time.monotonic()
    wait = _MIN_INTERVAL - (now - _last_post_m)
    if wait > 0:
        time.sleep(wait)
    username, avatar_url = _happy_identity()
    body = json.dumps(
        {
            "username": username,
            "avatar_url": avatar_url,
            "embeds": embeds[:10],
        }
    ).encode("utf-8")
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
    _persist_watchdog_alerts_to_backend(
        [
            _compose_event(
                "compose_exited",
                service,
                f"Container `{container_short}` is exited.",
                container_short=container_short,
            )
        ]
    )
    if not _webhook_url():
        return
    _post_embeds(
        [
            {
                "title": "Heads up — a container exited",
                "description": (
                    f"I noticed **{service}** (`{container_short}`) is **exited**. "
                    "I'll start it if the restart policy allows."
                ),
                "color": _EMBED_RED,
                "footer": {"text": "Happy · compose watchdog"},
            }
        ]
    )


def notify_started_after_exit(service: str, container_short: str) -> None:
    """Recovery after exit — 'redeploying' equivalent locally."""
    _persist_watchdog_alerts_to_backend(
        [
            _compose_event(
                "compose_recovered",
                service,
                f"Running again after exit (`{container_short}`).",
                container_short=container_short,
            )
        ]
    )
    if not _webhook_url():
        return
    _post_embeds(
        [
            {
                "title": "Back online",
                "description": (
                    f"**{service}** (`{container_short}`) is **running** again after being exited."
                ),
                "color": _EMBED_GREEN,
                "footer": {"text": "Happy · compose watchdog"},
            }
        ]
    )


def notify_unhealthy_restart(service: str, container_short: str) -> None:
    """Unhealthy container restart."""
    _persist_watchdog_alerts_to_backend(
        [
            _compose_event(
                "compose_unhealthy_restart",
                service,
                f"Restarting unhealthy container `{container_short}`.",
                container_short=container_short,
            )
        ]
    )
    if not _webhook_url():
        return
    _post_embeds(
        [
            {
                "title": "Restarting an unhealthy container",
                "description": (
                    f"**{service}** (`{container_short}`) failed health checks — "
                    "I'm **restarting** it now."
                ),
                "color": _EMBED_YELLOW,
                "footer": {"text": "Happy · compose watchdog"},
            }
        ]
    )
