"""
Circuit Breaker pattern implementation.

Prevents cascading failures by stopping requests to a failing service
after a threshold of errors. After a timeout, allows a single test request
through to check if the service has recovered.

States:
    CLOSED  - Normal operation, requests pass through
    OPEN    - Service is failing, requests are blocked
    HALF_OPEN - Testing if service recovered, one request allowed
"""

import logging
import time
import threading

logger = logging.getLogger(__name__)


class CircuitBreakerOpen(Exception):
    """Raised when the circuit breaker is open and requests are blocked."""
    pass


class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=30, name="default"):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.name = name

        self._failure_count = 0
        self._last_failure_time = None
        self._state = "CLOSED"
        self._lock = threading.Lock()

    @property
    def state(self):
        with self._lock:
            if self._state == "OPEN":
                if (time.time() - self._last_failure_time) > self.recovery_timeout:
                    self._state = "HALF_OPEN"
                    logger.info(f"Circuit breaker [{self.name}] -> HALF_OPEN")
            return self._state

    def record_success(self):
        with self._lock:
            self._failure_count = 0
            if self._state != "CLOSED":
                logger.info(f"Circuit breaker [{self.name}] -> CLOSED")
            self._state = "CLOSED"

    def record_failure(self):
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.time()
            if self._failure_count >= self.failure_threshold:
                self._state = "OPEN"
                logger.warning(
                    f"Circuit breaker [{self.name}] -> OPEN "
                    f"(failures: {self._failure_count})"
                )

    def call(self, func, *args, **kwargs):
        """Execute a function through the circuit breaker."""
        state = self.state
        if state == "OPEN":
            raise CircuitBreakerOpen(
                f"Circuit breaker [{self.name}] is OPEN. "
                f"Service unavailable, try again later."
            )

        try:
            result = func(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise

    def get_status(self):
        return {
            "name": self.name,
            "state": self.state,
            "failure_count": self._failure_count,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
        }


# Global circuit breaker for database operations
db_circuit_breaker = CircuitBreaker(
    failure_threshold=5,
    recovery_timeout=30,
    name="database",
)
