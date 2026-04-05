"""Unit tests for dashboard database layer (db.py) and cache flush integration."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, call, patch

import pytest

from cache import LogCache
from db import flush_logs, flush_stats, init_db


# ---------------------------------------------------------------------------
# Sample data helpers
# ---------------------------------------------------------------------------

def _make_log_entry(
    instance_id="1",
    level="INFO",
    method="GET",
    path="/health",
    status_code=200,
    duration_ms=5.0,
):
    return {
        "timestamp": "2026-04-04T10:00:00Z",
        "level": level,
        "logger": "app.middleware",
        "message": f"[abc123] {method} {path} -> {status_code} ({duration_ms}ms)",
        "instance_id": instance_id,
        "request_id": "abc123",
        "trace_id": "abc123",
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": duration_ms,
    }


def _make_stats():
    return {
        "1": {
            "request_count": 10,
            "error_count": 1,
            "avg_duration_ms": 8.5,
            "error_rate": 0.1,
            "status_codes": {"200": 9, "500": 1},
            "levels": {"INFO": 10},
        },
        "2": {
            "request_count": 5,
            "error_count": 0,
            "avg_duration_ms": 3.2,
            "error_rate": 0.0,
            "status_codes": {"200": 5},
            "levels": {"INFO": 5},
        },
    }


# ---------------------------------------------------------------------------
# flush_logs tests
# ---------------------------------------------------------------------------


class TestFlushLogs:
    def test_empty_list_returns_zero(self):
        assert flush_logs([]) == 0

    @patch("db.execute_values")
    @patch("db.get_connection")
    def test_inserts_logs_and_returns_count(self, mock_get_conn, mock_exec_vals):
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = lambda s: mock_cur
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        logs = [_make_log_entry(), _make_log_entry(instance_id="2")]
        result = flush_logs(logs)

        assert result == 2
        mock_get_conn.assert_called_once()
        mock_exec_vals.assert_called_once()
        mock_conn.close.assert_called_once()

    @patch("db.execute_values")
    @patch("db.get_connection")
    def test_builds_correct_row_tuples(self, mock_get_conn, mock_exec_vals):
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = lambda s: mock_cur
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        entry = _make_log_entry(instance_id="3", level="ERROR", status_code=500)
        flush_logs([entry])

        # Check the rows passed to execute_values
        rows = mock_exec_vals.call_args[0][2]
        assert len(rows) == 1
        row = rows[0]
        assert row[4] == "3"  # instance_id
        assert row[1] == "ERROR"  # level
        assert row[9] == 500  # status_code

    @patch("db.get_connection", side_effect=Exception("connection refused"))
    def test_returns_zero_on_db_error(self, mock_get_conn):
        result = flush_logs([_make_log_entry()])
        assert result == 0

    @patch("db.execute_values")
    @patch("db.get_connection")
    def test_handles_missing_optional_fields(self, mock_get_conn, mock_exec_vals):
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = lambda s: mock_cur
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        minimal = {"timestamp": "2026-04-04T10:00:00Z", "level": "DEBUG", "message": "startup"}
        result = flush_logs([minimal])
        assert result == 1

        rows = mock_exec_vals.call_args[0][2]
        row = rows[0]
        assert row[6] is None  # request_id
        assert row[8] is None  # path
        assert row[9] is None  # status_code


# ---------------------------------------------------------------------------
# flush_stats tests
# ---------------------------------------------------------------------------


class TestFlushStats:
    def test_empty_dict_returns_zero(self):
        assert flush_stats({}) == 0

    @patch("db.execute_values")
    @patch("db.get_connection")
    def test_inserts_stats_and_returns_count(self, mock_get_conn, mock_exec_vals):
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = lambda s: mock_cur
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        result = flush_stats(_make_stats())
        assert result == 2
        mock_exec_vals.assert_called_once()
        mock_conn.close.assert_called_once()

    @patch("db.get_connection", side_effect=Exception("timeout"))
    def test_returns_zero_on_db_error(self, mock_get_conn):
        result = flush_stats(_make_stats())
        assert result == 0


# ---------------------------------------------------------------------------
# init_db tests
# ---------------------------------------------------------------------------


class TestInitDb:
    @patch("db.time.sleep")  # skip retry delays
    @patch("db.get_connection")
    def test_creates_tables_on_success(self, mock_get_conn, mock_sleep):
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = lambda s: mock_cur
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        result = init_db()
        assert result is True
        mock_cur.execute.assert_called_once()
        mock_conn.close.assert_called_once()

    @patch("db.time.sleep")
    @patch("db.get_connection", side_effect=Exception("not ready"))
    def test_retries_and_fails(self, mock_get_conn, mock_sleep):
        result = init_db()
        assert result is False
        assert mock_get_conn.call_count == 30


# ---------------------------------------------------------------------------
# Cache flush_to_db integration tests
# ---------------------------------------------------------------------------


class TestCacheFlushToDb:
    @patch("db.flush_stats")
    @patch("db.flush_logs")
    def test_flush_sends_pending_logs_and_stats(self, mock_flush_logs, mock_flush_stats):
        cache = LogCache(max_entries=100)
        cache.add(_make_log_entry(instance_id="1"))
        cache.add(_make_log_entry(instance_id="2", status_code=500))

        mock_flush_logs.return_value = 2
        mock_flush_stats.return_value = 2

        cache.flush_to_db()

        # Logs were flushed
        logs_arg = mock_flush_logs.call_args[0][0]
        assert len(logs_arg) == 2

        # Stats snapshot was flushed
        stats_arg = mock_flush_stats.call_args[0][0]
        assert "1" in stats_arg
        assert "2" in stats_arg

    @patch("db.flush_stats")
    @patch("db.flush_logs")
    def test_pending_cleared_after_successful_flush(self, mock_flush_logs, mock_flush_stats):
        cache = LogCache(max_entries=100)
        cache.add(_make_log_entry())
        cache.add(_make_log_entry())

        mock_flush_logs.return_value = 2
        mock_flush_stats.return_value = 1

        cache.flush_to_db()
        assert len(cache._pending_flush) == 0

    @patch("db.flush_stats")
    @patch("db.flush_logs", return_value=0)
    def test_pending_restored_on_flush_failure(self, mock_flush_logs, mock_flush_stats):
        cache = LogCache(max_entries=100)
        cache.add(_make_log_entry())
        cache.add(_make_log_entry())

        cache.flush_to_db()

        # Logs should be put back for retry
        assert len(cache._pending_flush) == 2

    @patch("db.flush_stats")
    @patch("db.flush_logs")
    def test_no_flush_when_nothing_pending(self, mock_flush_logs, mock_flush_stats):
        cache = LogCache(max_entries=100)
        cache.flush_to_db()

        mock_flush_logs.assert_not_called()
        mock_flush_stats.assert_not_called()

    @patch("db.flush_stats")
    @patch("db.flush_logs")
    def test_stats_include_correct_aggregates(self, mock_flush_logs, mock_flush_stats):
        cache = LogCache(max_entries=100)
        cache.add(_make_log_entry(instance_id="1", status_code=200, duration_ms=10.0))
        cache.add(_make_log_entry(instance_id="1", status_code=500, duration_ms=20.0))
        cache.add(_make_log_entry(instance_id="1", status_code=200, duration_ms=15.0))

        mock_flush_logs.return_value = 3
        mock_flush_stats.return_value = 1

        cache.flush_to_db()

        stats = mock_flush_stats.call_args[0][0]
        inst1 = stats["1"]
        assert inst1["request_count"] == 3
        assert inst1["error_count"] == 1
        assert inst1["avg_duration_ms"] == 15.0  # (10+20+15)/3
        assert inst1["status_codes"]["200"] == 2
        assert inst1["status_codes"]["500"] == 1


# ---------------------------------------------------------------------------
# Cache flush loop lifecycle tests
# ---------------------------------------------------------------------------


class TestCacheFlushLoop:
    @patch("db.flush_stats")
    @patch("db.flush_logs")
    def test_stop_flush_loop_does_final_flush(self, mock_flush_logs, mock_flush_stats):
        cache = LogCache(max_entries=100)
        cache.add(_make_log_entry())

        mock_flush_logs.return_value = 1
        mock_flush_stats.return_value = 1

        # Start and immediately stop — should trigger one final flush
        cache.start_flush_loop(interval_seconds=9999)
        cache.stop_flush_loop()

        mock_flush_logs.assert_called_once()
        assert len(cache._pending_flush) == 0
