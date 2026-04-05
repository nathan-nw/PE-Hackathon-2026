"""Tests for the circuit breaker pattern."""

import pytest

from app.circuit_breaker import CircuitBreaker, CircuitBreakerOpen


def test_initial_state_is_closed():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10, name="test")
    assert cb.state == "CLOSED"


def test_stays_closed_under_threshold():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == "CLOSED"


def test_opens_at_threshold():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10)
    for _ in range(3):
        cb.record_failure()
    assert cb.state == "OPEN"


def test_success_resets_to_closed():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    assert cb.state == "CLOSED"
    assert cb._failure_count == 0


def test_half_open_after_timeout():
    cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0)
    cb.record_failure()
    cb.record_failure()
    # With 0 timeout, immediately transitions to HALF_OPEN on next state check
    assert cb.state == "HALF_OPEN"


def test_call_succeeds():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10)
    result = cb.call(lambda: 42)
    assert result == 42
    assert cb.state == "CLOSED"


def test_call_raises_when_open():
    cb = CircuitBreaker(failure_threshold=1, recovery_timeout=60)
    cb.record_failure()
    assert cb.state == "OPEN"
    with pytest.raises(CircuitBreakerOpen):
        cb.call(lambda: 1)


def test_call_records_failure_on_exception():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10)
    with pytest.raises(ValueError):
        cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
    assert cb._failure_count == 1


def test_get_status():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30, name="db")
    status = cb.get_status()
    assert status["name"] == "db"
    assert status["state"] == "CLOSED"
    assert status["failure_count"] == 0
    assert status["failure_threshold"] == 5
    assert status["recovery_timeout"] == 30
