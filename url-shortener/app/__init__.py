import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv

# Load `.env` before importing `app.metrics` so INSTANCE_ID is visible to Prometheus registration.
# Do not override variables already set by the host / `railway run` (e.g. DATABASE_URL).
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

from flask import Flask, jsonify, render_template, request  # noqa: E402
from flask_cors import CORS  # noqa: E402

from app.cache import init_cache  # noqa: E402
from app.circuit_breaker import db_circuit_breaker  # noqa: E402
from app.database import db, init_db  # noqa: E402
from app.instance_info import get_instance_id, get_instance_stats  # noqa: E402
from app.logging_config import configure_logging  # noqa: E402
from app.metrics import metrics_response  # noqa: E402
from app.middleware import register_middleware  # noqa: E402
from app.routes import register_routes  # noqa: E402

logger = logging.getLogger(__name__)


def create_app():
    app = Flask(__name__)

    # Browser clients (e.g. user-frontend on another port / Railway subdomain) call POST /shorten.
    _cors = os.environ.get("CORS_ORIGINS", "*").strip()
    if _cors == "*":
        CORS(app)
    else:
        CORS(app, origins=[o.strip() for o in _cors.split(",") if o.strip()])

    configure_logging()

    # Rate limiting — backed by Redis so limits are shared across containers.
    # The dynamic_rate_limit module adjusts the effective limit based on active connections,
    # but Flask-Limiter needs a static default. We set it high here and let the dynamic
    # system + Nginx handle the real throttling.
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address

    def _default_limits_exempt_when():
        # CORS preflight must not get 429 without Access-Control-* (browsers show generic CORS failure).
        if request.method == "OPTIONS":
            return True
        from app.load_test_bypass import is_load_test_bypass_request

        return is_load_test_bypass_request()

    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=[os.environ.get("RATE_LIMIT_DEFAULT", "5000 per minute")],
        storage_uri=os.environ.get("RATE_LIMIT_STORAGE", "memory://"),
        default_limits_exempt_when=_default_limits_exempt_when,
    )
    app.limiter = limiter

    init_db(app)
    init_cache()
    register_middleware(app)

    @app.after_request
    def _add_cors(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    from app.models import Event, Url, User  # noqa: F401 - registers models with Peewee
    from app.models.load_test_result import LoadTestResult  # noqa: E402

    # Ensure tables exist (safe to call repeatedly — uses IF NOT EXISTS).
    # Skip when TESTING — test fixtures swap in SQLite and create tables themselves.
    if not os.environ.get("TESTING"):
        with app.app_context():
            db.create_tables([User, Url, Event, LoadTestResult], safe=True)
            # Seed a default user so the UI works out of the box (hosted DB may be slow on first connect).
            for attempt in range(3):
                try:
                    User.get_or_create(
                        id=1,
                        defaults={
                            "username": "default",
                            "email": "default@example.com",
                            "created_at": __import__("datetime").datetime.now(__import__("datetime").UTC),
                        },
                    )
                    break
                except Exception as e:
                    logger.warning(
                        "Default user (id=1) seed attempt %s/3 failed: %s",
                        attempt + 1,
                        e,
                    )
                    if attempt < 2:
                        time.sleep(0.5)

    # Register before API blueprints so `/`, `/health`, and `/metrics` are not shadowed by `/<short_code>`.
    @app.route("/favicon.ico")
    @limiter.exempt
    def favicon():
        """Avoid /<short_code> treating 'favicon.ico' as a code (and hitting the DB)."""
        return ("", 204)

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/health")
    @limiter.exempt
    def health():
        """Human-friendly status + DB + circuit breaker (monitors and legacy clients)."""
        health_status = {
            "status": "ok",
            "database": "ok",
            "circuit_breaker": db_circuit_breaker.get_status(),
            "instance_id": get_instance_id(),
        }

        try:
            db.execute_sql("SELECT 1")
        except Exception as e:
            health_status["status"] = "degraded"
            health_status["database"] = f"error: {str(e)}"
            return jsonify(health_status), 503

        return jsonify(health_status)

    @app.route("/live")
    @limiter.exempt
    def live():
        """Liveness probe: process accepts HTTP — use for container restart policy only."""
        return jsonify({"status": "ok"}), 200

    @app.route("/ready")
    @limiter.exempt
    def ready():
        """Readiness probe: DB reachable — load balancers / orchestrators should stop traffic if 503."""
        try:
            db.execute_sql("SELECT 1")
        except Exception as e:
            return jsonify({"status": "not_ready", "database": str(e)}), 503
        return jsonify({"status": "ok", "database": "ok"}), 200

    @app.route("/metrics")
    @limiter.exempt
    def metrics():
        return metrics_response()

    @app.route("/api/instance-stats")
    @limiter.exempt
    def instance_stats():
        """JSON for the UI: replica id, CPU/RAM, rolling latency (no DB)."""
        return jsonify(get_instance_stats())

    register_routes(app)

    return app
