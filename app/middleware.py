"""
Request middleware for reliability:
- Request logging with timing
- Error handling with graceful degradation
"""

import logging
import time
import uuid

from flask import g, jsonify, request

logger = logging.getLogger(__name__)


def register_middleware(app):
    """Register all middleware with the Flask app."""

    @app.before_request
    def _start_timer():
        g.start_time = time.time()
        g.request_id = str(uuid.uuid4())[:8]

    @app.after_request
    def _log_request(response):
        duration = time.time() - getattr(g, "start_time", time.time())
        duration_ms = round(duration * 1000, 2)

        logger.info(
            f"[{g.get('request_id', '-')}] "
            f"{request.method} {request.path} "
            f"-> {response.status_code} "
            f"({duration_ms}ms)"
        )

        # Add useful headers for debugging and reliability
        response.headers["X-Request-ID"] = g.get("request_id", "")
        response.headers["X-Response-Time"] = f"{duration_ms}ms"

        return response

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
