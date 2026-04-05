import contextlib
import csv
import os
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from playhouse.shortcuts import model_to_dict

from app.database import db
from app.models.user import User

CSV_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "csv_data")

users_bp = Blueprint("users", __name__)


@users_bp.route("/users", methods=["GET"])
def list_users():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    per_page = min(per_page, 100)

    query = User.select().order_by(User.id)
    users = list(query.paginate(page, per_page))

    return jsonify([model_to_dict(u, backrefs=False) for u in users])


@users_bp.route("/users/<int:user_id>", methods=["GET"])
def get_user(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    return jsonify(model_to_dict(user, backrefs=False))


@users_bp.route("/users", methods=["POST"])
def create_user():
    data = request.get_json(silent=True)
    if data is None or not isinstance(data, dict):
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    email = data.get("email")
    username = data.get("username")
    if not email or not username:
        return jsonify({"error": "email and username are required"}), 400
    if not isinstance(email, str) or not isinstance(username, str):
        return jsonify({"error": "email and username must be strings"}), 400
    email = email.strip()
    username = username.strip()
    if not email or not username:
        return jsonify({"error": "email and username must not be blank"}), 400
    if "@" not in email:
        return jsonify({"error": "email must be a valid email address"}), 400

    now = datetime.now(UTC)
    try:
        user = User.create(username=username, email=email, created_at=now)
    except Exception:
        return jsonify({"error": "User with that username or email already exists"}), 409

    return jsonify(model_to_dict(user, backrefs=False)), 201


@users_bp.route("/users/<int:user_id>", methods=["PUT"])
def update_user(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True)
    if data is None or not isinstance(data, dict):
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    if "username" in data:
        if not isinstance(data["username"], str) or not data["username"].strip():
            return jsonify({"error": "username must be a non-empty string"}), 400
        user.username = data["username"].strip()
    if "email" in data:
        if not isinstance(data["email"], str) or not data["email"].strip():
            return jsonify({"error": "email must be a non-empty string"}), 400
        if "@" not in data["email"]:
            return jsonify({"error": "email must be a valid email address"}), 400
        user.email = data["email"].strip()
    try:
        user.save()
    except Exception:
        return jsonify({"error": "Username or email already taken"}), 409

    return jsonify(model_to_dict(user, backrefs=False))


@users_bp.route("/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        return jsonify({"error": "User not found"}), 404

    user.delete_instance()
    return jsonify({"message": "User deleted"}), 200


@users_bp.route("/users/bulk", methods=["POST"])
def bulk_load_users():
    # Accept JSON body with {"file": "users.csv"} or multipart file upload
    data = request.get_json(silent=True)
    if data and "file" in data:
        filename = os.path.basename(data["file"])
        filepath = os.path.join(CSV_DATA_DIR, filename)
        if not os.path.isfile(filepath):
            return jsonify({"error": f"File not found: {filename}"}), 404
        with open(filepath, newline="") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    elif request.files.get("file"):
        content = request.files["file"].read().decode("utf-8")
        import io

        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
    else:
        return jsonify({"error": "No file provided"}), 400

    created = 0
    skipped = 0
    with db.atomic():
        for row in rows:
            username = row.get("username", "").strip()
            email = row.get("email", "").strip()
            if not username or not email:
                continue
            created_at = row.get("created_at", "").strip()
            row_id = row.get("id", "").strip()
            # Upsert by id: if row has an explicit id, replace existing row
            if row_id:
                int_id = int(row_id)
                existing = User.select().where(User.id == int_id).first()
                if existing:
                    existing.username = username
                    existing.email = email
                    if created_at:
                        existing.created_at = created_at
                    existing.save()
                    created += 1
                    continue
            # Skip if username or email already taken
            if User.select().where((User.username == username) | (User.email == email)).exists():
                skipped += 1
                continue
            fields = {"username": username, "email": email, "created_at": created_at or datetime.now(UTC)}
            if row_id:
                fields["id"] = int(row_id)
            User.create(**fields)
            created += 1

    # Fix PostgreSQL sequence after explicit id inserts
    with contextlib.suppress(Exception):
        db.execute_sql("SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));")

    return jsonify(
        {
            "message": f"Imported {created} users",
            "count": created,
            "imported": created,
            "row_count": len(rows),
            "skipped": skipped,
        }
    ), 201
