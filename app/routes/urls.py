import json
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from playhouse.shortcuts import model_to_dict

from app.database import db
from app.helpers import dumps_details, generate_unique_short_code, is_valid_http_url
from app.models.event import Event
from app.models.url import Url
from app.models.user import User

urls_bp = Blueprint("urls", __name__)


def _url_json(u: Url) -> dict:
    d = model_to_dict(u, recurse=False)
    d["user_id"] = u.user_id
    for k in ("created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat()
    return d


@urls_bp.get("/urls")
def list_urls():
    q = Url.select()
    active = request.args.get("active")
    if active is not None:
        a = active.strip().lower()
        if a in ("true", "1", "yes"):
            q = q.where(Url.is_active == True)  # noqa: E712
        elif a in ("false", "0", "no"):
            q = q.where(Url.is_active == False)  # noqa: E712
    uid = request.args.get("user_id", type=int)
    if uid is not None:
        q = q.where(Url.user == uid)
    rows = list(q.order_by(Url.id))
    return jsonify([_url_json(u) for u in rows])


@urls_bp.get("/urls/<int:url_id>")
def get_url(url_id: int):
    try:
        u = Url.get(Url.id == url_id)
    except Url.DoesNotExist:
        return jsonify(error="not found"), 404
    return jsonify(_url_json(u))


@urls_bp.post("/urls")
def create_url():
    data = request.get_json(silent=True) or {}
    original_url = data.get("original_url")
    if not original_url or not isinstance(original_url, str):
        return jsonify(error="original_url is required"), 400
    if not is_valid_http_url(original_url):
        return jsonify(error="original_url must be a valid http(s) URL"), 400

    title = data.get("title")
    if title is not None and not isinstance(title, str):
        return jsonify(error="title must be a string"), 400

    user_id = data.get("user_id")
    if user_id is not None:
        if not isinstance(user_id, int):
            return jsonify(error="user_id must be an integer"), 400
        if User.get_or_none(User.id == user_id) is None:
            return jsonify(error="user_id not found"), 400
    else:
        first = User.select().order_by(User.id).first()
        if first is None:
            return jsonify(error="no users in database; pass user_id or run seed"), 400
        user_id = first.id

    now = datetime.now(UTC).replace(tzinfo=None)
    short_code = generate_unique_short_code()

    with db.atomic():
        u = Url.create(
            user=user_id,
            short_code=short_code,
            original_url=original_url.strip(),
            title=(title.strip() if isinstance(title, str) and title.strip() else None),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        Event.create(
            url=u,
            user=user_id,
            event_type="created",
            timestamp=now,
            details=dumps_details(
                {"short_code": short_code, "original_url": original_url.strip()}
            ),
        )

    return jsonify(_url_json(u)), 201


@urls_bp.patch("/urls/<int:url_id>/deactivate")
def deactivate_url(url_id: int):
    try:
        u = Url.get(Url.id == url_id)
    except Url.DoesNotExist:
        return jsonify(error="not found"), 404

    now = datetime.now(UTC).replace(tzinfo=None)
    with db.atomic():
        u.is_active = False
        u.updated_at = now
        u.save()
        Event.create(
            url=u,
            user=u.user_id,
            event_type="deactivated",
            timestamp=now,
            details=json.dumps({"short_code": u.short_code}, separators=(",", ":")),
        )

    return jsonify(_url_json(u))
