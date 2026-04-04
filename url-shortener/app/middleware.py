"""
Request middleware for reliability:
- Request logging with timing
- Error handling with graceful degradation
"""

import logging
import os
import time
import uuid

from flask import g, jsonify, request
from peewee import OperationalError as PeeweeOperationalError

from app.instance_info import get_instance_id, increment_request_count, record_request_latency_ms
from app.metrics import HTTP_REQUEST_DURATION, HTTP_REQUESTS

logger = logging.getLogger(__name__)

# Paths not counted toward avg latency / requests_observed in /api/instance-stats (still in Prometheus).
_EXCLUDE_FROM_INSTANCE_STATS = frozenset({"/api/instance-stats", "/metrics", "/health", "/live", "/ready"})


def register_middleware(app):
    """Register all middleware with the Flask app."""

    @app.before_request
    def _start_timer():
        g.start_time = time.time()
        incoming = (request.headers.get("X-Request-ID") or "").strip()
        if incoming and len(incoming) <= 128:
            g.request_id = incoming[:128]
        else:
            g.request_id = str(uuid.uuid4())[:8]

    @app.after_request
    def _log_request(response):
        duration = time.time() - getattr(g, "start_time", time.time())
        duration_ms = round(duration * 1000, 2)

        iid = get_instance_id()
        if os.environ.get("LOG_FORMAT", "").lower() == "json":
            logger.info(
                "http_request",
                extra={
                    "request_id": g.get("request_id", ""),
                    "trace_id": g.get("request_id", ""),
                    "method": request.method,
                    "path": request.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                },
            )
        else:
            logger.info(
                f"[{g.get('request_id', '-')}] {request.method} {request.path} -> "
                f"{response.status_code} ({duration_ms}ms)"
            )

        # Keep rolling latency / request count meaningful (exclude health, Prometheus, HUD polls).
        if request.path not in _EXCLUDE_FROM_INSTANCE_STATS:
            record_request_latency_ms(duration_ms)
            increment_request_count()
            HTTP_REQUEST_DURATION.labels(request.method, iid).observe(duration)
        HTTP_REQUESTS.labels(request.method, str(response.status_code), iid).inc()

        # Add useful headers for debugging and reliability
        response.headers["X-Request-ID"] = g.get("request_id", "")
        response.headers["X-Response-Time"] = f"{duration_ms}ms"

        return response

    @app.errorhandler(PeeweeOperationalError)
    def _database_unavailable(e):
        logger.error("Database unavailable: %s", e)
        return (
            jsonify(
                {
                    "error": "Database not reachable",
                    "detail": str(e),
                    "hint": "Start Postgres first. From the repo root: docker compose up db",
                }
            ),
            503,
        )

    @app.errorhandler(404)
    def _not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(429)
    def _rate_limited(e):
        return jsonify({"error": "Rate limit exceeded. Try again later."}), 429

    @app.errorhandler(500)
    def _internal_error(e):
        logger.error(f"Internal server error: {e}")
        return jsonify({"error": "Internal server error"}), 500

    @app.errorhandler(503)
    def _service_unavailable(e):
        return jsonify({"error": "Service temporarily unavailable"}), 503
