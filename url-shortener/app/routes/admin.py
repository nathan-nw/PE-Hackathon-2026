"""Admin API endpoints for IP ban management and dynamic rate limit configuration."""

from flask import Blueprint, jsonify, render_template, request

from app.dynamic_rate_limit import get_status as get_rl_status
from app.dynamic_rate_limit import set_config as set_rl_config
from app.ip_ban import get_all_banned_ips, get_ip_status, is_enabled, set_enabled, unban_ip

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.route("/")
def admin_ui():
    """Serve the admin control panel."""
    return render_template("admin.html")


# ── IP Ban Management ───────────────────────────────────────────────────────


@admin_bp.route("/bans", methods=["GET"])
def list_bans():
    """List all currently banned IPs."""
    banned = get_all_banned_ips()
    return jsonify(banned)


@admin_bp.route("/bans/<ip>", methods=["GET"])
def get_ban_status(ip):
    """Get ban status for a specific IP."""
    status = get_ip_status(ip)
    status["ip"] = ip
    return jsonify(status)


@admin_bp.route("/bans/<ip>/unban", methods=["POST"])
def admin_unban(ip):
    """Manually unban an IP. Clears all strikes and bans."""
    success = unban_ip(ip)
    if success:
        return jsonify({"message": f"IP {ip} has been unbanned", "ip": ip})
    return jsonify({"error": "Failed to unban IP — Redis may be unavailable"}), 500


@admin_bp.route("/bans/toggle", methods=["POST"])
def toggle_ban_system():
    """Enable or disable the IP ban system. Body: {"enabled": bool}"""
    data = request.get_json()
    if not data or "enabled" not in data:
        return jsonify({"error": "Field 'enabled' is required"}), 400
    set_enabled(bool(data["enabled"]))
    return jsonify({"enabled": is_enabled()})


@admin_bp.route("/bans/toggle", methods=["GET"])
def ban_system_status():
    """Check if the IP ban system is enabled."""
    return jsonify({"enabled": is_enabled()})


# ── Dynamic Rate Limit ──────────────────────────────────────────────────────


@admin_bp.route("/rate-limit", methods=["GET"])
def rate_limit_status():
    """Get current dynamic rate limit status including active connections and tiers."""
    return jsonify(get_rl_status())


@admin_bp.route("/rate-limit/config", methods=["PUT"])
def update_rate_limit_config():
    """Update the dynamic rate limit configuration.

    Body: {"enabled": bool, "tiers": [{"max_users": int, "rate_limit": int}, ...]}
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    config = {}
    if "enabled" in data:
        config["enabled"] = bool(data["enabled"])

    if "tiers" in data:
        tiers = data["tiers"]
        if not isinstance(tiers, list) or len(tiers) == 0:
            return jsonify({"error": "tiers must be a non-empty list"}), 400
        for t in tiers:
            if "max_users" not in t or "rate_limit" not in t:
                return jsonify({"error": "Each tier must have max_users and rate_limit"}), 400
        config["tiers"] = tiers

    # Merge with existing config
    from app.dynamic_rate_limit import get_config

    current = get_config()
    current.update(config)

    success = set_rl_config(current)
    if success:
        return jsonify({"message": "Rate limit config updated", "config": current})
    return jsonify({"error": "Failed to update config — Redis may be unavailable"}), 500
