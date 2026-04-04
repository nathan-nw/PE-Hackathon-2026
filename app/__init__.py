from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from app.database import init_db
from app.routes import register_routes

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def create_app():
    load_dotenv(_PROJECT_ROOT / ".env")

    app = Flask(__name__)

    @app.before_request
    def _cors_preflight():
        if request.method == "OPTIONS":
            return ("", 204)

    init_db(app)

    from app import models  # noqa: F401 - registers models with Peewee

    register_routes(app)

    @app.after_request
    def _cors_for_test_ui(resp):
        # Lets test/index.html call http://127.0.0.1:5000 when opened from file:// or another origin.
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
        return resp

    @app.route("/health")
    def health():
        return jsonify(status="ok")

    @app.route("/test/")
    @app.route("/test/index.html")
    def test_ui():
        return send_from_directory(_PROJECT_ROOT / "test", "index.html")

    return app
