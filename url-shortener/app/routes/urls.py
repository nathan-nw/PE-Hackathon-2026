import random
import string
from datetime import UTC, datetime

from flask import Blueprint, abort, jsonify, redirect, request
from playhouse.shortcuts import model_to_dict

from app.cache import (
    cache_redirect,
    cache_url_list,
    get_cached_redirect,
    get_cached_url_list,
    invalidate_redirect,
    invalidate_url_lists,
)
from app.database import db
from app.models.event import Event
from app.models.url import Url
from app.models.user import User

urls_bp = Blueprint("urls", __name__)


def generate_short_code(length=6):
    chars = string.ascii_letters + string.digits
    while True:
        code = "".join(random.choices(chars, k=length))
        if not Url.select().where(Url.short_code == code).exists():
            return code


@urls_bp.route("/shorten", methods=["POST"])
def create_short_url():
    data = request.get_json()
    if not data or "original_url" not in data or "user_id" not in data:
        return jsonify({"error": "original_url and user_id are required"}), 400

    original_url = data["original_url"]
    user_id = data["user_id"]
    title = data.get("title", "")

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

    # Prime the redirect cache and invalidate stale list caches
    cache_redirect(short_code, original_url, True)
    invalidate_url_lists()

    return jsonify(model_to_dict(url, backrefs=False)), 201


@urls_bp.route("/urls", methods=["GET"])
def list_urls():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    per_page = min(per_page, 100)  # cap at 100

    # Check Redis cache first
    cached = get_cached_url_list(page, per_page)
    if cached is not None:
        resp = jsonify(cached)
        resp.headers["Cache-Control"] = "public, max-age=30"
        return resp

    query = Url.select().order_by(Url.created_at.desc())
    total = query.count()
    urls = query.paginate(page, per_page)

    result = {
        "data": [model_to_dict(u, backrefs=False) for u in urls],
        "page": page,
        "per_page": per_page,
        "total": total,
    }

    cache_url_list(page, per_page, result)

    resp = jsonify(result)
    resp.headers["Cache-Control"] = "public, max-age=30"
    return resp


@urls_bp.route("/urls/<int:url_id>", methods=["GET"])
def get_url(url_id):
    try:
        url = Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    resp = jsonify(model_to_dict(url, backrefs=False))
    resp.headers["Cache-Control"] = "public, max-age=60"
    return resp


@urls_bp.route("/urls/<int:url_id>", methods=["PUT"])
def update_url(url_id):
    try:
        url = Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

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

    # Invalidate caches — redirect mapping may have changed
    invalidate_redirect(url.short_code)
    invalidate_url_lists()

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

    # Invalidate caches — URL is now deactivated
    invalidate_redirect(url.short_code)
    invalidate_url_lists()

    return jsonify({"message": "URL deleted (soft delete)"}), 200


@urls_bp.route("/users/<int:user_id>/urls", methods=["GET"])
def list_user_urls(user_id):
    try:
        User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    urls = Url.select().where(Url.user_id == user_id).order_by(Url.created_at.desc())
    resp = jsonify([model_to_dict(u, backrefs=False) for u in urls])
    resp.headers["Cache-Control"] = "public, max-age=30"
    return resp


@urls_bp.route("/urls/<int:url_id>/events", methods=["GET"])
def list_url_events(url_id):
    try:
        Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    events = Event.select().where(Event.url_id == url_id).order_by(Event.timestamp.desc())
    resp = jsonify([model_to_dict(e, backrefs=False) for e in events])
    resp.headers["Cache-Control"] = "public, max-age=30"
    return resp


@urls_bp.route("/<short_code>")
def redirect_to_url(short_code):
    """Registered last so paths like /urls and /shorten are not captured as codes."""
    # Try Redis cache first — avoids a DB round-trip on every redirect
    cached = get_cached_redirect(short_code)
    if cached is not None:
        if not cached["active"]:
            return jsonify({"error": "This URL has been deactivated"}), 410
        resp = redirect(cached["url"], code=302)
        resp.headers["Cache-Control"] = "public, max-age=300"
        return resp

    # Cache miss — fall back to DB
    try:
        url = Url.get(Url.short_code == short_code)
    except Url.DoesNotExist:
        abort(404)

    # Populate cache for next time
    cache_redirect(short_code, url.original_url, url.is_active)

    if not url.is_active:
        return jsonify({"error": "This URL has been deactivated"}), 410

    resp = redirect(url.original_url, code=302)
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp
