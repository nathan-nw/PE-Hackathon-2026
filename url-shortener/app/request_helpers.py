import json

from flask import jsonify, request
from werkzeug.exceptions import BadRequest


def parse_json_body():
    """Parse and validate a JSON request body.

    Returns (data, None) on success, or (None, response_tuple) on failure.
    Checks: Content-Type is application/json, body is valid JSON, body is a dict.
    """
    if not request.is_json:
        return None, (jsonify({"error": "Content-Type must be application/json"}), 415)

    try:
        data = request.get_json(silent=False)
    except BadRequest:
        return None, (jsonify({"error": "Malformed JSON body"}), 400)

    if not isinstance(data, dict):
        return None, (jsonify({"error": "Request body must be a JSON object"}), 400)

    return data, None


def normalize_details(details):
    """Normalize a details field to a JSON string.

    Accepts dict, list, or a string that parses to a dict/list.
    Rejects plain strings, numbers, booleans, and other types.
    Returns a JSON string or raises ValueError.
    """
    if details is None:
        return "{}"

    if isinstance(details, (dict, list)):
        return json.dumps(details)

    if isinstance(details, str):
        try:
            parsed = json.loads(details)
        except (TypeError, ValueError) as exc:
            raise ValueError("details must be a JSON object or array") from exc
        if isinstance(parsed, (dict, list)):
            return json.dumps(parsed)
        raise ValueError("details must be a JSON object or array")

    raise ValueError("details must be a JSON object or array")
