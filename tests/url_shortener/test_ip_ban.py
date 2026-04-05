"""Tests for IP ban system using a mock Redis client."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

import app.ip_ban as ip_ban


class FakeRedis:
    """Minimal Redis mock for ip_ban tests."""

    def __init__(self):
        self._store: dict[str, str] = {}
        self._ttls: dict[str, int] = {}

    def get(self, key):
        return self._store.get(key)

    def set(self, key, value):
        self._store[key] = value

    def setex(self, key, ttl, value):
        self._store[key] = value
        self._ttls[key] = ttl

    def delete(self, *keys):
        for k in keys:
            self._store.pop(k, None)
            self._ttls.pop(k, None)

    def exists(self, key):
        return key in self._store

    def ttl(self, key):
        return self._ttls.get(key, -2)

    def scan(self, cursor, match="*", count=100):
        import fnmatch

        matched = [k for k in self._store if fnmatch.fnmatch(k, match)]
        return 0, matched


@pytest.fixture(autouse=True)
def _reset_enabled():
    """Ensure ip_ban is enabled before each test."""
    ip_ban.set_enabled(True)
    yield
    ip_ban.set_enabled(True)


@pytest.fixture()
def fake_redis():
    r = FakeRedis()
    with patch("app.ip_ban._get_redis", return_value=r):
        yield r


class TestIsEnabled:
    def test_default_enabled(self):
        assert ip_ban.is_enabled() is True

    def test_toggle(self):
        ip_ban.set_enabled(False)
        assert ip_ban.is_enabled() is False
        ip_ban.set_enabled(True)
        assert ip_ban.is_enabled() is True


class TestGetIpStatus:
    def test_no_redis_returns_not_banned(self):
        with patch("app.ip_ban._get_redis", return_value=None):
            status = ip_ban.get_ip_status("1.2.3.4")
            assert status["banned"] is False
            assert status["strikes"] == 0

    def test_clean_ip(self, fake_redis):
        status = ip_ban.get_ip_status("1.2.3.4")
        assert status["banned"] is False
        assert status["strikes"] == 0

    def test_permanent_ban(self, fake_redis):
        fake_redis.set(
            "ip_ban:permanent:1.2.3.4",
            json.dumps({"strikes": 5, "hour_bans": 3}),
        )
        status = ip_ban.get_ip_status("1.2.3.4")
        assert status["banned"] is True
        assert status["permanent"] is True

    def test_temp_ban(self, fake_redis):
        fake_redis.setex("ip_ban:banned:1.2.3.4", 3600, "1")
        fake_redis.setex(
            "ip_ban:strikes:1.2.3.4",
            86400,
            json.dumps({"strikes": 2, "hour_bans": 1}),
        )
        status = ip_ban.get_ip_status("1.2.3.4")
        assert status["banned"] is True
        assert status["permanent"] is False
        assert status["ban_remaining_s"] == 3600

    def test_has_strikes_not_banned(self, fake_redis):
        fake_redis.setex(
            "ip_ban:strikes:1.2.3.4",
            86400,
            json.dumps({"strikes": 1, "hour_bans": 0, "warned": True}),
        )
        status = ip_ban.get_ip_status("1.2.3.4")
        assert status["banned"] is False
        assert status["strikes"] == 1
        assert status["warned"] is True

    def test_redis_error_returns_not_banned(self, fake_redis):
        with patch("app.ip_ban._get_redis") as mock:
            mock.return_value = MagicMock()
            mock.return_value.exists.side_effect = Exception("Redis down")
            status = ip_ban.get_ip_status("1.2.3.4")
            assert status["banned"] is False


class TestRecordViolation:
    def test_disabled_noop(self):
        ip_ban.set_enabled(False)
        result = ip_ban.record_violation("1.2.3.4")
        assert result["action"] == "none"

    def test_no_redis_noop(self):
        with patch("app.ip_ban._get_redis", return_value=None):
            result = ip_ban.record_violation("1.2.3.4")
            assert result["action"] == "none"

    def test_first_violation_is_warning(self, fake_redis):
        result = ip_ban.record_violation("1.2.3.4")
        assert result["action"] == "warning"
        assert result["strikes"] == 1

    def test_second_violation_is_hour_ban(self, fake_redis):
        ip_ban.record_violation("1.2.3.4")  # strike 1 = warning
        result = ip_ban.record_violation("1.2.3.4")  # strike 2 = hour ban
        assert result["action"] == "hour_ban"
        assert result["hour_bans"] == 1

    def test_already_banned_returns_already_banned(self, fake_redis):
        fake_redis.setex("ip_ban:banned:1.2.3.4", 3600, "1")
        result = ip_ban.record_violation("1.2.3.4")
        assert result["action"] == "already_banned"

    def test_already_permanently_banned(self, fake_redis):
        fake_redis.set("ip_ban:permanent:1.2.3.4", json.dumps({"strikes": 5}))
        result = ip_ban.record_violation("1.2.3.4")
        assert result["action"] == "already_banned"

    def test_permanent_ban_after_max_hour_bans(self, fake_redis):
        fake_redis.setex(
            "ip_ban:strikes:1.2.3.4",
            86400,
            json.dumps({"strikes": 1, "hour_bans": 3, "warned": True}),
        )
        result = ip_ban.record_violation("1.2.3.4")
        assert result["action"] == "permanent_ban"
        assert result["hour_bans"] == 4

    def test_redis_error_returns_none(self, fake_redis):
        with patch("app.ip_ban._get_redis") as mock:
            mock.return_value = MagicMock()
            mock.return_value.exists.side_effect = Exception("Redis down")
            result = ip_ban.record_violation("1.2.3.4")
            assert result["action"] == "none"


class TestIsBanned:
    def test_not_banned(self, fake_redis):
        banned, info = ip_ban.is_banned("1.2.3.4")
        assert banned is False

    def test_disabled_not_banned(self):
        ip_ban.set_enabled(False)
        banned, info = ip_ban.is_banned("1.2.3.4")
        assert banned is False


class TestUnbanIp:
    def test_unban_clears_all(self, fake_redis):
        fake_redis.set("ip_ban:permanent:1.2.3.4", "{}")
        fake_redis.setex("ip_ban:banned:1.2.3.4", 3600, "1")
        fake_redis.setex("ip_ban:strikes:1.2.3.4", 86400, "{}")
        result = ip_ban.unban_ip("1.2.3.4")
        assert result is True
        assert not fake_redis.exists("ip_ban:permanent:1.2.3.4")
        assert not fake_redis.exists("ip_ban:banned:1.2.3.4")

    def test_unban_no_redis(self):
        with patch("app.ip_ban._get_redis", return_value=None):
            assert ip_ban.unban_ip("1.2.3.4") is False

    def test_unban_redis_error(self):
        with patch("app.ip_ban._get_redis") as mock:
            mock.return_value = MagicMock()
            mock.return_value.delete.side_effect = Exception("Redis down")
            assert ip_ban.unban_ip("1.2.3.4") is False


class TestGetAllBannedIps:
    def test_empty(self, fake_redis):
        result = ip_ban.get_all_banned_ips()
        assert result == []

    def test_no_redis(self):
        with patch("app.ip_ban._get_redis", return_value=None):
            assert ip_ban.get_all_banned_ips() == []

    def test_lists_permanent_bans(self, fake_redis):
        fake_redis.set("ip_ban:permanent:1.2.3.4", json.dumps({"strikes": 5, "hour_bans": 3}))
        result = ip_ban.get_all_banned_ips()
        assert len(result) == 1
        assert result[0]["ip"] == "1.2.3.4"
        assert result[0]["permanent"] is True

    def test_lists_temp_bans(self, fake_redis):
        fake_redis.setex("ip_ban:banned:5.6.7.8", 1800, "1")
        fake_redis.setex("ip_ban:strikes:5.6.7.8", 86400, json.dumps({"hour_bans": 1, "strikes": 2}))
        result = ip_ban.get_all_banned_ips()
        assert len(result) == 1
        assert result[0]["ip"] == "5.6.7.8"
        assert result[0]["permanent"] is False
