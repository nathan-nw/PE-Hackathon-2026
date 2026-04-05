"""Tests for dashboard-backend log filter helpers."""

from __future__ import annotations

from log_filters import (
    _status_int,
    entry_matches_filters,
    sql_status_condition,
    status_predicate,
)


class TestStatusInt:
    def test_none_status_code(self):
        assert _status_int({}) is None

    def test_valid_int(self):
        assert _status_int({"status_code": 404}) == 404

    def test_invalid_status_raises_handled(self):
        assert _status_int({"status_code": "nope"}) is None


class TestEntryMatchesFilters:
    def test_no_filters(self):
        assert entry_matches_filters({"level": "INFO", "message": "x"}) is True

    def test_level_match(self):
        assert entry_matches_filters({"level": "ERROR"}, level="error") is True

    def test_level_mismatch(self):
        assert entry_matches_filters({"level": "INFO"}, level="error") is False

    def test_instance_id(self):
        assert entry_matches_filters({"instance_id": "2"}, instance_id="2") is True
        assert entry_matches_filters({"instance_id": "1"}, instance_id="2") is False

    def test_search_in_message(self):
        e = {"message": "hello world", "logger": "x", "path": "/"}
        assert entry_matches_filters(e, search="WORLD") is True

    def test_search_in_logger(self):
        e = {"message": "", "logger": "MyLogger", "path": "/"}
        assert entry_matches_filters(e, search="logger") is True

    def test_search_in_path(self):
        e = {"message": "", "logger": "", "path": "/api/v1"}
        assert entry_matches_filters(e, search="api") is True

    def test_search_whitespace_only_skipped(self):
        assert entry_matches_filters({"message": "x"}, search="   ") is True

    def test_status_predicate_5xx(self):
        assert entry_matches_filters({"status_code": 503}, status_code="5xx") is True
        assert entry_matches_filters({"status_code": 200}, status_code="5xx") is False


class TestStatusPredicate:
    def test_empty_returns_none(self):
        assert status_predicate(None) is None
        assert status_predicate("") is None
        assert status_predicate("   ") is None

    def test_range_tokens(self):
        p2 = status_predicate("2xx")
        assert p2 is not None
        assert p2({"status_code": 200}) is True
        assert p2({"status_code": 299}) is True
        assert p2({"status_code": 300}) is False

        p5 = status_predicate("5xx")
        assert p5({"status_code": 500}) is True
        assert p5({"status_code": 599}) is True
        assert p5({"status_code": 600}) is False

    def test_comma_list(self):
        p = status_predicate("404, 500")
        assert p is not None
        assert p({"status_code": 404}) is True
        assert p({"status_code": 500}) is True
        assert p({"status_code": 200}) is False

    def test_comma_only_invalid_digits_returns_none(self):
        assert status_predicate("foo,bar") is None

    def test_single_code(self):
        p = status_predicate("418")
        assert p is not None
        assert p({"status_code": 418}) is True
        assert p({"status_code": 200}) is False

    def test_invalid_pattern_returns_none(self):
        assert status_predicate("abc") is None

    def test_missing_status_in_entry(self):
        p = status_predicate("2xx")
        assert p({"status_code": None}) is False


class TestSqlStatusCondition:
    def test_empty(self):
        assert sql_status_condition(None) == ("", [])
        assert sql_status_condition("") == ("", [])
        assert sql_status_condition("   ") == ("", [])

    def test_range(self):
        sql, params = sql_status_condition("4xx")
        assert "status_code >=" in sql
        assert params == [400, 500]

    def test_list(self):
        sql, params = sql_status_condition("201, 301")
        assert "ANY" in sql
        assert params == [[201, 301]]

    def test_list_empty_digits(self):
        assert sql_status_condition("x,y,z") == ("", [])

    def test_single_digit(self):
        sql, params = sql_status_condition("302")
        assert "status_code =" in sql
        assert params == [302]

    def test_invalid_returns_empty(self):
        assert sql_status_condition("bad") == ("", [])
