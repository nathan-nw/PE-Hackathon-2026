from flask import Blueprint, jsonify, request
from playhouse.shortcuts import model_to_dict

from app.models.event import Event

events_bp = Blueprint("events", __name__)


def _event_json(e: Event) -> dict:
    d = model_to_dict(e, recurse=False)
    d["url_id"] = e.url_id
    d["user_id"] = e.user_id
    if d.get("timestamp") is not None:
        d["timestamp"] = d["timestamp"].isoformat()
    return d


@events_bp.get("/events")
def list_events():
    q = Event.select().order_by(Event.timestamp.desc())
    url_id = request.args.get("url_id", type=int)
    if url_id is not None:
        q = q.where(Event.url == url_id)
    et = request.args.get("event_type")
    if et:
        q = q.where(Event.event_type == et.strip())
    limit = request.args.get("limit", default=500, type=int)
    limit = max(1, min(limit, 2000))
    rows = list(q.limit(limit))
    return jsonify([_event_json(e) for e in rows])
