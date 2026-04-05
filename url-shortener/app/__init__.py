import os
from pathlib import Path

from dotenv import load_dotenv

# Load `.env` before importing `app.metrics` so INSTANCE_ID is visible to Prometheus registration.
# Do not override variables already set by the host / `railway run` (e.g. DATABASE_URL).
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

from flask import Flask, jsonify, render_template, request  # noqa: E402
from flask_cors import CORS  # noqa: E402

from app.circuit_breaker import db_circuit_breaker  # noqa: E402
from app.database import db, init_db  # noqa: E402
from app.instance_info import get_instance_id, get_instance_stats  # noqa: E402
from app.logging_config import configure_logging  # noqa: E402
from app.metrics import metrics_response  # noqa: E402
from app.middleware import register_middleware  # noqa: E402
from app.routes import register_routes  # noqa: E402


def create_app():

    app = Flask(__name__)

    # Browser clients (e.g. user-frontend on another port / Railway subdomain) call POST /shorten.
    _cors = os.environ.get("CORS_ORIGINS", "*").strip()
    if _cors == "*":
        CORS(app)
    else:
        CORS(app, origins=[o.strip() for o in _cors.split(",") if o.strip()])

    configure_logging()

    # Rate limiting
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address

    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=[os.environ.get("RATE_LIMIT_DEFAULT", "200 per minute")],
        storage_uri=os.environ.get("RATE_LIMIT_STORAGE", "memory://"),
        # CORS preflight must not get 429 without Access-Control-* (browsers show generic CORS failure).
        default_limits_exempt_when=lambda: request.method == "OPTIONS",
    )
    app.limiter = limiter

    init_db(app)
    register_middleware(app)

    from app import models  # noqa: F401 - registers models with Peewee

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
