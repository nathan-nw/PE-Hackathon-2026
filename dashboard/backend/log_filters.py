"""Shared log filter helpers for dashboard-backend (memory + SQL paths)."""

from __future__ import annotations

from typing import Any


def _status_int(entry: dict[str, Any]) -> int | None:
    sc = entry.get("status_code")
    if sc is None:
        return None
    try:
        return int(sc)
    except (TypeError, ValueError):
        return None


def entry_matches_filters(
    entry: dict[str, Any],
    *,
    level: str | None = None,
    instance_id: str | None = None,
    search: str | None = None,
    status_code: str | None = None,
) -> bool:
    """Whether a log entry matches optional filters (AND)."""
    if level:
        if str(entry.get("level", "")).upper() != level.upper().strip():
            return False
    if instance_id:
        if str(entry.get("instance_id", "")) != instance_id:
            return False
    if search and search.strip():
        q = search.strip().casefold()
        if not (
            q in str(entry.get("message", "")).casefold()
            or q in str(entry.get("logger", "")).casefold()
            or q in str(entry.get("path", "")).casefold()
        ):
            return False
    pred = status_predicate(status_code)
    if pred is not None and not pred(entry):
        return False
    return True


def status_predicate(raw: str | None):
    """Return a predicate on log dicts, or None if no status filter."""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().lower()
    if s in ("2xx", "3xx", "4xx", "5xx"):
        ranges = {"2xx": (200, 300), "3xx": (300, 400), "4xx": (400, 500), "5xx": (500, 600)}
        lo, hi = ranges[s]

        def _p(e: dict[str, Any]) -> bool:
            c = _status_int(e)
            return c is not None and lo <= c < hi

        return _p
    if "," in s:
        codes = {int(x.strip()) for x in s.split(",") if x.strip().isdigit()}
        if not codes:
            return None

        def _p2(e: dict[str, Any]) -> bool:
            c = _status_int(e)
            return c is not None and c in codes

        return _p2
    if s.isdigit():
        want = int(s)

        def _p3(e: dict[str, Any]) -> bool:
            c = _status_int(e)
            return c is not None and c == want

        return _p3
    return None


def sql_status_condition(status_code: str | None) -> tuple[str, list[Any]]:
    """SQL predicate on ``status_code`` (empty if no filter). Params only for non-empty."""
    if not status_code or not str(status_code).strip():
        return "", []
    s = str(status_code).strip().lower()
    if s in ("2xx", "3xx", "4xx", "5xx"):
        ranges = {"2xx": (200, 300), "3xx": (300, 400), "4xx": (400, 500), "5xx": (500, 600)}
        lo, hi = ranges[s]
        return "status_code >= %s AND status_code < %s", [lo, hi]
    if "," in s:
        parts = [int(x.strip()) for x in s.split(",") if x.strip().isdigit()]
        if not parts:
            return "", []
        return "status_code = ANY(%s)", [parts]
    if s.isdigit():
        return "status_code = %s", [int(s)]
    return "", []
