import random
import string
from datetime import UTC, datetime
from urllib.parse import urlparse

from flask import Blueprint, abort, jsonify, redirect, request
from playhouse.shortcuts import model_to_dict

from app.database import db
from app.models.event import Event
from app.models.url import Url
from app.models.user import User


def _validate_url(url_string):
    """Return an error message if the URL is invalid, else None."""
    if not isinstance(url_string, str) or not url_string.strip():
        return "original_url must be a non-empty string"
    parsed = urlparse(url_string)
    if parsed.scheme not in ("http", "https"):
        return "original_url must start with http:// or https://"
    if not parsed.netloc:
        return "original_url must include a valid domain"
    return None

urls_bp = Blueprint("urls", __name__)


def generate_short_code(length=6):
    chars = string.ascii_letters + string.digits
    while True:
        code = "".join(random.choices(chars, k=length))
        if not Url.select().where(Url.short_code == code).exists():
            return code


@urls_bp.route("/shorten", methods=["POST"])
def create_short_url():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({
            "error": "Invalid or missing JSON body",
            "hint": "Send a JSON object with Content-Type: application/json",
        }), 400
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400
    if "original_url" not in data or "user_id" not in data:
        return jsonify({"error": "original_url and user_id are required"}), 400

    original_url = data["original_url"]
    url_err = _validate_url(original_url)
    if url_err:
        return jsonify({"error": url_err}), 400

    user_id = data["user_id"]
    if not isinstance(user_id, int):
        return jsonify({"error": "user_id must be an integer"}), 400

    title = data.get("title", "")
    if not isinstance(title, str):
        return jsonify({"error": "title must be a string"}), 400

    try:
        User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    short_code = data.get("short_code") or generate_short_code()

    if Url.select().where(Url.short_code == short_code).exists():
        return jsonify({"error": "Short code already exists"}), 409

    now = datetime.now(UTC)

    with db.atomic():
        url = Url.create(
            user_id=user_id,
            short_code=short_code,
            original_url=original_url,
            title=title,
            is_active=True,
            created_at=now,
            updated_at=now,
        )

        Event.create(
            url_id=url.id,
            user_id=user_id,
            event_type="created",
            timestamp=now,
            details=f'{{"short_code":"{short_code}","original_url":"{original_url}"}}',
        )

    return jsonify(model_to_dict(url, backrefs=False)), 201


@urls_bp.route("/urls", methods=["GET"])
def list_urls():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    per_page = min(per_page, 100)  # cap at 100

    query = Url.select().order_by(Url.created_at.desc())
    total = query.count()
    urls = query.paginate(page, per_page)

    return jsonify(
        {
            "data": [model_to_dict(u, backrefs=False) for u in urls],
            "page": page,
            "per_page": per_page,
            "total": total,
        }
    )


@urls_bp.route("/urls/<int:url_id>", methods=["GET"])
def get_url(url_id):
    try:
        url = Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    return jsonify(model_to_dict(url, backrefs=False))


@urls_bp.route("/urls/<int:url_id>", methods=["PUT"])
def update_url(url_id):
    try:
        url = Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    data = request.get_json(silent=True)
    if data is None:
        return jsonify({
            "error": "Invalid or missing JSON body",
            "hint": "Send a JSON object with Content-Type: application/json",
        }), 400
    if not isinstance(data, dict) or len(data) == 0:
        return jsonify({"error": "No data provided"}), 400

    if "original_url" in data:
        url_err = _validate_url(data["original_url"])
        if url_err:
            return jsonify({"error": url_err}), 400

    now = datetime.now(UTC)

    with db.atomic():
        if "original_url" in data:
            url.original_url = data["original_url"]
        if "title" in data:
            url.title = data["title"]
        if "is_active" in data:
            url.is_active = data["is_active"]

        url.updated_at = now
        url.save()

        Event.create(
            url_id=url.id,
            user_id=url.user_id,
            event_type="updated",
            timestamp=now,
            details=f'{{"fields_updated":{list(data.keys())}}}',
        )

    return jsonify(model_to_dict(url, backrefs=False))


@urls_bp.route("/urls/<int:url_id>", methods=["DELETE"])
def delete_url(url_id):
    try:
        url = Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    now = datetime.now(UTC)

    with db.atomic():
        Event.create(
            url_id=url.id,
            user_id=url.user_id,
            event_type="deleted",
            timestamp=now,
            details=f'{{"short_code":"{url.short_code}","reason":"user_deleted"}}',
        )

        url.is_active = False
        url.updated_at = now
        url.save()

    return jsonify({"message": "URL deleted (soft delete)"}), 200


@urls_bp.route("/users/<int:user_id>/urls", methods=["GET"])
def list_user_urls(user_id):
    try:
        User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    urls = Url.select().where(Url.user_id == user_id).order_by(Url.created_at.desc())
    return jsonify([model_to_dict(u, backrefs=False) for u in urls])


@urls_bp.route("/urls/<int:url_id>/events", methods=["GET"])
def list_url_events(url_id):
    try:
        Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    events = Event.select().where(Event.url_id == url_id).order_by(Event.timestamp.desc())
    return jsonify([model_to_dict(e, backrefs=False) for e in events])


@urls_bp.route("/<short_code>")
def redirect_to_url(short_code):
    """Registered last so paths like /urls and /shorten are not captured as codes."""
    try:
        url = Url.get(Url.short_code == short_code)
    except Url.DoesNotExist:
        abort(404)

    if not url.is_active:
        return jsonify({"error": "This URL has been deactivated"}), 410

    return redirect(url.original_url, code=302)
