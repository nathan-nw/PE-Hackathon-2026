from datetime import UTC, datetime

from flask import Blueprint, jsonify, redirect

from app.database import db
from app.models.event import Event
from app.models.url import Url

redirect_bp = Blueprint("redirect", __name__)


@redirect_bp.get("/r/<short_code>")
def follow_short_code(short_code: str):
    code = (short_code or "").strip()
    u = Url.get_or_none(Url.short_code == code)
    if u is None or not u.is_active:
        return jsonify(error="not found"), 404

    now = datetime.now(UTC).replace(tzinfo=None)
    with db.atomic():
        Event.create(
            url=u,
            user=None,
            event_type="clicked",
            timestamp=now,
            details=None,
        )

    return redirect(u.original_url, code=302)
