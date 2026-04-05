"""LOAD_TEST_BYPASS_TOKEN + X-Load-Test-Bypass (k6 / load-balancer alignment)."""

from __future__ import annotations

import pytest

from app.load_test_bypass import is_load_test_bypass_request


@pytest.fixture()
def bypass_env(monkeypatch):
    monkeypatch.setenv("LOAD_TEST_BYPASS_TOKEN", "test-bypass-secret")


def test_bypass_false_when_env_unset(app, monkeypatch):
    monkeypatch.delenv("LOAD_TEST_BYPASS_TOKEN", raising=False)
    with app.test_request_context("/shorten"):
        assert is_load_test_bypass_request() is False


def test_bypass_false_when_header_wrong(app, bypass_env):
    with app.test_request_context("/shorten", headers={"X-Load-Test-Bypass": "wrong"}):
        assert is_load_test_bypass_request() is False


def test_bypass_true_when_header_matches(app, bypass_env):
    with app.test_request_context(
        "/shorten",
        headers={"X-Load-Test-Bypass": "test-bypass-secret"},
    ):
        assert is_load_test_bypass_request() is True
