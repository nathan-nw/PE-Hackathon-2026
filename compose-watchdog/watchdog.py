#!/usr/bin/env python3
"""Reconcile Compose project containers: start exited tasks, restart stuck-unhealthy ones."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import docker

from discord_notify import (
    notify_exited,
    notify_started_after_exit,
    notify_unhealthy_restart,
)


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v != "" else default


def _parse_policy(name: str | None) -> str:
    return (name or "").strip().lower()


def _should_recover_exited(policy_name: str) -> bool:
    only_always = _env("WATCHDOG_ONLY_ALWAYS", "0").lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if only_always:
        return policy_name == "always"
    return policy_name in ("always", "unless-stopped", "on-failure")


def _should_restart_unhealthy(policy_name: str) -> bool:
    if policy_name in ("no", ""):
        return False
    return policy_name in ("always", "unless-stopped", "on-failure")


LOG_TAIL_MAX = 40

STATE: dict[str, Any] = {
    "lock": threading.Lock(),
    "interval_sec": 15.0,
    "last_tick_at": None,
    "instances_monitored": 0,
    "events": [],
    "log_tail": deque(maxlen=LOG_TAIL_MAX),
}


def _log(msg: str) -> None:
    print(msg, flush=True)
    with STATE["lock"]:
        dq: deque[str] = STATE["log_tail"]
        dq.append(msg)


def _iso(ts: float) -> str:
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    )


def _append_event(service: str, action: str, reason: str) -> None:
    with STATE["lock"]:
        ev = {
            "id": f"{time.time_ns()}-{service}-{action}",
            "at": _iso(time.time()),
            "service": service,
            "action": action,
            "reason": reason,
        }
        lst: list[dict[str, Any]] = list(STATE["events"])
        lst.insert(0, ev)
        STATE["events"] = lst[:30]


def _run_http() -> None:
    port = int(_env("WATCHDOG_HTTP_PORT", "8099"))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0].rstrip("/") or "/"
            if path != "/status":
                self.send_error(404)
                return
            with STATE["lock"]:
                ts = STATE["last_tick_at"]
                tail = STATE["log_tail"]
                body = {
                    "intervalSec": STATE["interval_sec"],
                    "lastTickAt": _iso(ts) if ts is not None else None,
                    "instancesMonitored": STATE["instances_monitored"],
                    "events": list(STATE["events"]),
                    "logTail": list(tail),
                }
            raw = json.dumps(body).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = HTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


def main() -> None:
    project = _env("COMPOSE_PROJECT", "pe-hackathon-2026")
    interval = float(_env("WATCHDOG_INTERVAL_SEC", "15"))
    self_service = _env("WATCHDOG_SELF_SERVICE", "compose-watchdog").strip().lower()
    exclude_raw = _env("WATCHDOG_EXCLUDE_SERVICES", "")
    exclude = {s.strip().lower() for s in exclude_raw.split(",") if s.strip()}
    unhealthy_polls = max(1, int(_env("WATCHDOG_UNHEALTHY_POLLS", "2")))

    with STATE["lock"]:
        STATE["interval_sec"] = interval

    try:
        client = docker.from_env()
    except Exception as e:
        print(f"watchdog: cannot connect to Docker: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

    threading.Thread(target=_run_http, name="watchdog-http", daemon=True).start()
    _log(
        f"watchdog: project={project!r} interval={interval}s self={self_service!r} "
        f"unhealthy_polls={unhealthy_polls} http=0.0.0.0:{_env('WATCHDOG_HTTP_PORT', '8099')}"
    )

    unhealthy_streak: dict[str, int] = {}
    exit_notified: set[str] = set()
    unhealthy_discord_at: dict[str, float] = {}

    while True:
        try:
            _tick(
                client,
                project=project,
                self_service=self_service,
                exclude=exclude,
                unhealthy_streak=unhealthy_streak,
                unhealthy_polls=unhealthy_polls,
                interval=interval,
                exit_notified=exit_notified,
                unhealthy_discord_at=unhealthy_discord_at,
            )
        except Exception as e:
            _log(f"watchdog: tick error: {e}")
        time.sleep(interval)


def _tick(
    client: docker.DockerClient,
    *,
    project: str,
    self_service: str,
    exclude: set[str],
    unhealthy_streak: dict[str, int],
    unhealthy_polls: int,
    interval: float,
    exit_notified: set[str],
    unhealthy_discord_at: dict[str, float],
) -> None:
    containers = client.containers.list(
        all=True,
        filters={"label": f"com.docker.compose.project={project}"},
    )
    seen: set[str] = set()
    monitored = 0

    for c in containers:
        seen.add(c.id)
        c.reload()
        labels = c.labels or {}
        svc = (labels.get("com.docker.compose.service") or "").strip().lower()
        if not svc:
            continue
        if svc == self_service:
            continue
        if svc in exclude:
            continue

        monitored += 1

        attrs: dict[str, Any] = c.attrs or {}
        state = attrs.get("State") or {}
        status = (state.get("Status") or "").lower()
        policy_name = _parse_policy(
            (attrs.get("HostConfig") or {}).get("RestartPolicy", {}).get("Name")
        )

        if status == "exited":
            if c.id not in exit_notified:
                notify_exited(svc, c.short_id)
                exit_notified.add(c.id)
            if _should_recover_exited(policy_name):
                _log(f"watchdog: starting exited service={svc} id={c.short_id}")
                try:
                    c.start()
                    _append_event(svc, "start", "exited")
                    notify_started_after_exit(svc, c.short_id)
                    exit_notified.discard(c.id)
                except Exception as e:
                    _log(f"watchdog: start failed service={svc}: {e}")
            continue

        if status == "running" and _should_restart_unhealthy(policy_name):
            health = state.get("Health") or {}
            hs = (health.get("Status") or "").lower()
            if hs == "unhealthy":
                unhealthy_streak[c.id] = unhealthy_streak.get(c.id, 0) + 1
                if unhealthy_streak[c.id] >= unhealthy_polls:
                    _log(
                        f"watchdog: restarting unhealthy service={svc} id={c.short_id}"
                    )
                    now_ts = time.time()
                    if now_ts - unhealthy_discord_at.get(c.id, 0) > 45.0:
                        notify_unhealthy_restart(svc, c.short_id)
                        unhealthy_discord_at[c.id] = now_ts
                    try:
                        c.restart(timeout=10)
                        _append_event(svc, "restart", "unhealthy")
                    except Exception as e:
                        _log(f"watchdog: restart failed service={svc}: {e}")
                    unhealthy_streak[c.id] = 0
            elif hs in ("healthy", "none", ""):
                unhealthy_streak[c.id] = 0

    for cid in list(unhealthy_streak):
        if cid not in seen:
            del unhealthy_streak[cid]

    for cid in list(exit_notified):
        if cid not in seen:
            exit_notified.discard(cid)
    for cid in list(unhealthy_discord_at):
        if cid not in seen:
            del unhealthy_discord_at[cid]

    with STATE["lock"]:
        STATE["last_tick_at"] = time.time()
        STATE["instances_monitored"] = monitored
        STATE["interval_sec"] = interval


if __name__ == "__main__":
    main()
