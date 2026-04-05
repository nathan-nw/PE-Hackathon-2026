"""Tests for log-derived Telemetry golden signals (no Prometheus)."""

from __future__ import annotations

import time

from telemetry_agg import aggregate_entries_to_series, merge_telemetry_entries


def test_aggregate_latency_and_traffic():
    now = 1_700_000_000
    t0 = now - 120
    entries = [
        {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
            "status_code": 200,
            "duration_ms": 10.0,
            "request_id": "a",
        },
        {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 + 5)),
            "status_code": 200,
            "duration_ms": 20.0,
            "request_id": "b",
        },
        {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 + 5)),
            "status_code": 500,
            "duration_ms": 100.0,
            "request_id": "c",
        },
    ]
    out = aggregate_entries_to_series(
        entries, step_seconds=60, range_minutes=30, now=now
    )
    assert out["requests_in_window"] == 3
    assert "p50" in out["latency"]
    assert "200" in out["traffic"]["by_status"] or "500" in out["traffic"]["by_status"]


def test_merge_dedupes_by_request_id():
    db_rows = [
        {
            "timestamp": "2026-04-04T10:00:05Z",
            "status_code": 200,
            "duration_ms": 1.0,
            "request_id": "x",
        }
    ]
    memory_rows = [
        {
            "timestamp": "2026-04-04T10:00:05Z",
            "status_code": 200,
            "duration_ms": 1.0,
            "request_id": "x",
        },
        {
            "timestamp": "2026-04-04T10:00:06Z",
            "status_code": 200,
            "duration_ms": 2.0,
            "request_id": "y",
        },
    ]
    merged = merge_telemetry_entries(db_rows, memory_rows)
    assert len(merged) == 2
