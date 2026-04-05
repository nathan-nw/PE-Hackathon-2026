from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from playhouse.shortcuts import model_to_dict

from app.models.event import Event
from app.models.url import Url
from app.models.user import User
from app.request_helpers import normalize_details, parse_json_body

events_bp = Blueprint("events", __name__)


@events_bp.route("/events", methods=["GET"])
def list_events():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    per_page = min(per_page, 100)

    query = Event.select().order_by(Event.timestamp.desc())

    url_id = request.args.get("url_id", type=int)
    if url_id is not None:
        query = query.where(Event.url_id == url_id)

    user_id = request.args.get("user_id", type=int)
    if user_id is not None:
        query = query.where(Event.user_id == user_id)

    event_type = request.args.get("event_type")
    if event_type is not None:
        query = query.where(Event.event_type == event_type)

    events = list(query.paginate(page, per_page))

    return jsonify([model_to_dict(e, backrefs=False, recurse=False) for e in events])


@events_bp.route("/events", methods=["POST"])
def create_event():
    data, err = parse_json_body()
    if err:
        return err

    url_id = data.get("url_id")
    user_id = data.get("user_id")
    event_type = data.get("event_type")
    if not url_id or not user_id or not event_type:
        return jsonify({"error": "url_id, user_id, and event_type are required"}), 400

    if isinstance(url_id, bool) or not isinstance(url_id, int):
        return jsonify({"error": "url_id must be an integer"}), 400
    if isinstance(user_id, bool) or not isinstance(user_id, int):
        return jsonify({"error": "user_id must be an integer"}), 400
    if not isinstance(event_type, str) or not event_type.strip():
        return jsonify({"error": "event_type must be a non-empty string"}), 400

    try:
        Url.get_by_id(url_id)
    except Url.DoesNotExist:
        return jsonify({"error": "URL not found"}), 404

    try:
        User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    raw_details = data.get("details", {})
    try:
        details = normalize_details(raw_details)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    now = datetime.now(UTC)
    event = Event.create(
        url_id=url_id,
        user_id=user_id,
        event_type=event_type.strip(),
        timestamp=now,
        details=details,
    )

    return jsonify(model_to_dict(event, backrefs=False, recurse=False)), 201
