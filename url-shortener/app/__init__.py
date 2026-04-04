import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template

from app.cache import init_cache
from app.circuit_breaker import db_circuit_breaker
from app.database import db, init_db
from app.middleware import register_middleware
from app.routes import register_routes


def create_app():
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    app = Flask(__name__)

    # Configure logging
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rate limiting — backed by Redis so limits are shared across containers
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address

    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=[os.environ.get("RATE_LIMIT_DEFAULT", "200 per minute")],
        storage_uri=os.environ.get("RATE_LIMIT_STORAGE", "memory://"),
    )
    app.limiter = limiter

    init_db(app)
    init_cache()
    register_middleware(app)

    from app import models  # noqa: F401 - registers models with Peewee

    # Ensure load_test_results table exists (safe=True is a no-op if it already exists)
    with app.app_context():
        db.create_tables([models.LoadTestResult], safe=True)

    # Register before API blueprints so `/` and `/health` are not shadowed by `/<short_code>`.
    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/health")
    @limiter.exempt
    def health():
        """Enhanced health check that verifies database connectivity."""
        health_status = {
            "status": "ok",
            "database": "ok",
            "circuit_breaker": db_circuit_breaker.get_status(),
        }

        try:
            db.execute_sql("SELECT 1")
        except Exception as e:
            health_status["status"] = "degraded"
            health_status["database"] = f"error: {str(e)}"
            return jsonify(health_status), 503

        return jsonify(health_status)

    register_routes(app)

    return app
