"""Tests for admin routes (IP ban management, rate limit config)."""

from unittest.mock import patch


def test_admin_list_bans(client):
    with patch("app.routes.admin.get_all_banned_ips", return_value=[]):
        res = client.get("/admin/bans")
        assert res.status_code == 200
        assert res.get_json() == []


def test_admin_get_ban_status(client):
    mock_status = {
        "banned": False,
        "permanent": False,
        "strikes": 0,
        "hour_bans": 0,
        "ban_expires_at": None,
        "ban_remaining_s": None,
        "warned": False,
    }
    with patch("app.routes.admin.get_ip_status", return_value=mock_status):
        res = client.get("/admin/bans/1.2.3.4")
        assert res.status_code == 200
        data = res.get_json()
        assert data["ip"] == "1.2.3.4"
        assert data["banned"] is False


def test_admin_unban_success(client):
    with patch("app.routes.admin.unban_ip", return_value=True):
        res = client.post("/admin/bans/1.2.3.4/unban")
        assert res.status_code == 200
        assert "unbanned" in res.get_json()["message"]


def test_admin_unban_failure(client):
    with patch("app.routes.admin.unban_ip", return_value=False):
        res = client.post("/admin/bans/1.2.3.4/unban")
        assert res.status_code == 500


def test_admin_toggle_ban_enable(client):
    with patch("app.routes.admin.set_enabled") as mock_set, \
         patch("app.routes.admin.is_enabled", return_value=True):
        res = client.post("/admin/bans/toggle", json={"enabled": True})
        assert res.status_code == 200
        assert res.get_json()["enabled"] is True
        mock_set.assert_called_once_with(True)


def test_admin_toggle_ban_missing_field(client):
    res = client.post("/admin/bans/toggle", json={})
    assert res.status_code == 400


def test_admin_ban_system_status(client):
    with patch("app.routes.admin.is_enabled", return_value=True):
        res = client.get("/admin/bans/toggle")
        assert res.status_code == 200
        assert res.get_json()["enabled"] is True


def test_admin_rate_limit_status(client):
    mock_status = {"enabled": True, "current_limit": 100, "active_connections": 5}
    with patch("app.routes.admin.get_rl_status", return_value=mock_status):
        res = client.get("/admin/rate-limit")
        assert res.status_code == 200
        assert res.get_json()["enabled"] is True


def test_admin_update_rate_limit_config(client):
    with patch("app.routes.admin.get_rl_status", return_value={}), \
         patch("app.dynamic_rate_limit.get_config", return_value={"enabled": True}), \
         patch("app.routes.admin.set_rl_config", return_value=True):
        res = client.put("/admin/rate-limit/config", json={"enabled": False})
        assert res.status_code == 200


def test_admin_update_rate_limit_no_data(client):
    res = client.put("/admin/rate-limit/config", data="", content_type="application/json")
    assert res.status_code in (400, 500)


def test_admin_update_rate_limit_invalid_tiers(client):
    res = client.put("/admin/rate-limit/config", json={"tiers": "not-a-list"})
    assert res.status_code == 400


def test_admin_update_rate_limit_tiers_missing_fields(client):
    res = client.put("/admin/rate-limit/config", json={"tiers": [{"max_users": 10}]})
    assert res.status_code == 400
