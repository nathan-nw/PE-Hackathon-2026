"""
Request middleware for reliability:
- IP ban enforcement
- Dynamic rate limiting (adjusts per-IP limits based on unique active users)
- Request logging with timing
- Error handling with graceful degradation
"""

import logging
import math
import os
import time
import uuid

from flask import g, jsonify, request
from peewee import OperationalError as PeeweeOperationalError

from app.dynamic_rate_limit import get_current_rate_limit, record_request
from app.instance_info import get_instance_id, increment_request_count, record_request_latency_ms
from app.ip_ban import is_banned, record_violation
from app.load_test_bypass import is_load_test_bypass_request
from app.metrics import HTTP_REQUEST_DURATION, HTTP_REQUESTS

logger = logging.getLogger(__name__)

# Paths not counted toward avg latency / requests_observed in /api/instance-stats (still in Prometheus).
_EXCLUDE_FROM_INSTANCE_STATS = frozenset({"/api/instance-stats", "/metrics", "/health", "/live", "/ready"})

# Paths exempt from ban checks and dynamic rate limiting (health probes, admin)
_EXEMPT_PATHS = frozenset({"/health", "/live", "/ready", "/metrics"})
_EXEMPT_PREFIXES = ("/admin/",)


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

    @app.before_request
    def _check_ip_ban():
        """Block banned IPs before any processing."""
        if request.path in _EXEMPT_PATHS or request.path.startswith(_EXEMPT_PREFIXES):
            return
        if is_load_test_bypass_request():
            return
        ip = request.remote_addr
        banned, info = is_banned(ip)
        if banned:
            body = {"error": "Your IP has been banned due to repeated rate limit abuse."}
            if info.get("permanent"):
                body["ban_type"] = "permanent"
                body["message"] = "This is a permanent ban. Contact an administrator to request removal."
            else:
                remaining = info.get("ban_remaining_s", 0)
                minutes = math.ceil(remaining / 60) if remaining else 0
                body["ban_type"] = "temporary"
                body["ban_remaining_s"] = remaining
                body["message"] = f"You are temporarily banned. Try again in {minutes} minute(s)."
            return jsonify(body), 403

    @app.before_request
    def _track_active_user():
        """Record this IP as an active user for dynamic rate limiting."""
        record_request(request.remote_addr)

    @app.after_request
    def _log_request(response):
        duration = time.time() - getattr(g, "start_time", time.time())
        duration_ms = round(duration * 1000, 2)

        iid = get_instance_id()
        extra = {
            "request_id": g.get("request_id", ""),
            "trace_id": g.get("request_id", ""),
            "method": request.method,
            "path": request.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        }
        if os.environ.get("LOG_FORMAT", "").lower() == "json":
            logger.info("http_request", extra=extra)
        else:
            logger.info(
                f"[{g.get('request_id', '-')}] {request.method} {request.path} -> "
                f"{response.status_code} ({duration_ms}ms)",
                extra=extra,
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

        # Chrome Private Network Access: e.g. page on http://localhost:5500 calling http://127.0.0.1:8080
        if request.headers.get("Access-Control-Request-Private-Network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"

        # Dynamic rate limit info headers
        rl = get_current_rate_limit()
        response.headers["X-RateLimit-Limit"] = str(rl["rate_limit"])
        response.headers["X-Active-Users"] = str(rl["active_users"])

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

    @app.errorhandler(400)
    def _bad_request(e):
        detail = str(e.description) if hasattr(e, "description") else str(e)
        return jsonify({"error": "Bad request", "detail": detail}), 400

    @app.errorhandler(404)
    def _not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def _method_not_allowed(e):
        detail = str(e.description) if hasattr(e, "description") else str(e)
        return jsonify({"error": "Method not allowed", "detail": detail}), 405

    @app.errorhandler(429)
    def _rate_limited(e):
        ip = request.remote_addr
        if is_load_test_bypass_request():
            return jsonify({"error": "Rate limit exceeded."}), 429

        result = record_violation(ip)
        action = result.get("action", "none")

        body = {"error": "Rate limit exceeded."}

        if action == "warning":
            body["warning"] = "This is your first rate limit violation. Continued abuse will result in a ban."
            body["strikes"] = result["strikes"]
            resp = jsonify(body)
            resp.status_code = 429
            resp.headers["X-Rate-Limit-Warning"] = f"{result['strikes']}/1"
            return resp

        elif action == "hour_ban":
            body["message"] = (
                f"You have been banned for 1 hour (ban #{result['hour_bans']} of {3}). "
                "Further abuse after this ban expires will result in escalating penalties."
            )
            body["ban_type"] = "temporary"
            body["ban_remaining_s"] = result["ban_remaining_s"]
            resp = jsonify(body)
            resp.status_code = 429
            resp.headers["X-Rate-Limit-Warning"] = "banned"
            return resp

        elif action == "permanent_ban":
            body["message"] = (
                "You have been permanently banned due to repeated rate limit abuse. "
                "Contact an administrator to request removal."
            )
            body["ban_type"] = "permanent"
            resp = jsonify(body)
            resp.status_code = 429
            resp.headers["X-Rate-Limit-Warning"] = "permanent"
            return resp

        return jsonify(body), 429

    @app.errorhandler(500)
    def _internal_error(e):
        logger.error(f"Internal server error: {e}")
        return jsonify({"error": "Internal server error"}), 500

    @app.errorhandler(503)
    def _service_unavailable(e):
        return jsonify({"error": "Service temporarily unavailable"}), 503

    @app.errorhandler(Exception)
    def _unhandled_error(e):
        logger.exception("Unhandled exception: %s", e)
        return (
            jsonify(
                {
                    "error": "Internal server error",
                    "detail": "An unexpected error occurred. Please try again.",
                }
            ),
            500,
        )
