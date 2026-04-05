"""
IP ban system with escalating penalties.

Strike progression:
  - Strike 1: Warning (request still succeeds)
  - Strike 2: 1-hour ban (#1)
  - Strike 3: 1-hour ban (#2)
  - Strike 4: 1-hour ban (#3)
  - Strike 5+: Permanent ban (admin must manually unban)

State is stored in Redis so bans are shared across all app containers.
"""

import json
import logging
import time

logger = logging.getLogger(__name__)

# Redis key prefixes
_PREFIX_STRIKES = "ip_ban:strikes:"
_PREFIX_BAN = "ip_ban:banned:"
_PREFIX_PERMANENT = "ip_ban:permanent:"

HOUR_BAN_DURATION = 3600  # 1 hour in seconds
MAX_HOUR_BANS = 3  # after 3 hour-bans, permanent ban

# Global toggle — when False, is_banned() always returns False and record_violation() is a no-op.
_enabled = True


def is_enabled() -> bool:
    return _enabled


def set_enabled(enabled: bool):
    global _enabled
    _enabled = enabled


def _get_redis():
    """Get the shared Redis client from the cache module."""
    from app.cache import get_client

    return get_client()


def get_ip_status(ip: str) -> dict:
    """Return the current ban status for an IP.

    Returns dict with keys:
      - banned: bool
      - permanent: bool
      - strikes: int
      - hour_bans: int
      - ban_expires_at: float|None (unix timestamp)
      - ban_remaining_s: int|None (seconds until unban)
      - warned: bool
    """
    r = _get_redis()
    if r is None:
        return {
            "banned": False,
            "permanent": False,
            "strikes": 0,
            "hour_bans": 0,
            "ban_expires_at": None,
            "ban_remaining_s": None,
            "warned": False,
        }

    try:
        # Check permanent ban first
        if r.exists(f"{_PREFIX_PERMANENT}{ip}"):
            data = r.get(f"{_PREFIX_PERMANENT}{ip}")
            info = json.loads(data) if data else {}
            return {
                "banned": True,
                "permanent": True,
                "strikes": info.get("strikes", 5),
                "hour_bans": info.get("hour_bans", MAX_HOUR_BANS),
                "ban_expires_at": None,
                "ban_remaining_s": None,
                "warned": True,
            }

        # Check timed ban
        ban_ttl = r.ttl(f"{_PREFIX_BAN}{ip}")
        if ban_ttl and ban_ttl > 0:
            data = r.get(f"{_PREFIX_STRIKES}{ip}")
            info = json.loads(data) if data else {}
            expires_at = time.time() + ban_ttl
            return {
                "banned": True,
                "permanent": False,
                "strikes": info.get("strikes", 0),
                "hour_bans": info.get("hour_bans", 0),
                "ban_expires_at": expires_at,
                "ban_remaining_s": ban_ttl,
                "warned": True,
            }

        # Not banned — return strike info
        data = r.get(f"{_PREFIX_STRIKES}{ip}")
        info = json.loads(data) if data else {"strikes": 0, "hour_bans": 0, "warned": False}
        return {
            "banned": False,
            "permanent": False,
            "strikes": info.get("strikes", 0),
            "hour_bans": info.get("hour_bans", 0),
            "ban_expires_at": None,
            "ban_remaining_s": None,
            "warned": info.get("warned", False),
        }
    except Exception as e:
        logger.warning("ip_ban: failed to get status for %s — %s", ip, e)
        return {
            "banned": False,
            "permanent": False,
            "strikes": 0,
            "hour_bans": 0,
            "ban_expires_at": None,
            "ban_remaining_s": None,
            "warned": False,
        }


def record_violation(ip: str) -> dict:
    """Record a rate-limit violation for an IP and return the resulting action.

    Returns dict with keys:
      - action: "warning" | "hour_ban" | "permanent_ban" | "already_banned" | "none"
      - strikes: int
      - hour_bans: int
      - ban_remaining_s: int|None
    """
    if not _enabled:
        return {"action": "none", "strikes": 0, "hour_bans": 0, "ban_remaining_s": None}

    r = _get_redis()
    if r is None:
        return {"action": "none", "strikes": 0, "hour_bans": 0, "ban_remaining_s": None}

    try:
        # Already permanently banned?
        if r.exists(f"{_PREFIX_PERMANENT}{ip}"):
            return {"action": "already_banned", "strikes": 0, "hour_bans": 0, "ban_remaining_s": None}

        # Already temp-banned?
        ban_ttl = r.ttl(f"{_PREFIX_BAN}{ip}")
        if ban_ttl and ban_ttl > 0:
            return {"action": "already_banned", "strikes": 0, "hour_bans": 0, "ban_remaining_s": ban_ttl}

        # Load current strike data
        data = r.get(f"{_PREFIX_STRIKES}{ip}")
        info = json.loads(data) if data else {"strikes": 0, "hour_bans": 0, "warned": False}

        info["strikes"] = info.get("strikes", 0) + 1
        strikes = info["strikes"]
        hour_bans = info.get("hour_bans", 0)

        if strikes == 1:
            # First violation — warning only
            info["warned"] = True
            r.setex(f"{_PREFIX_STRIKES}{ip}", 86400, json.dumps(info))  # keep for 24h
            logger.info("ip_ban: WARNING issued to %s (strike 1)", ip)
            return {"action": "warning", "strikes": strikes, "hour_bans": hour_bans, "ban_remaining_s": None}

        elif strikes >= 2:
            # Second+ violation — ban
            hour_bans += 1
            info["hour_bans"] = hour_bans

            if hour_bans > MAX_HOUR_BANS:
                # Permanent ban
                r.set(f"{_PREFIX_PERMANENT}{ip}", json.dumps(info))
                r.delete(f"{_PREFIX_BAN}{ip}")
                r.setex(f"{_PREFIX_STRIKES}{ip}", 86400 * 30, json.dumps(info))  # keep record 30 days
                logger.warning("ip_ban: PERMANENT BAN for %s (after %d hour bans)", ip, MAX_HOUR_BANS)
                return {"action": "permanent_ban", "strikes": strikes, "hour_bans": hour_bans, "ban_remaining_s": None}
            else:
                # Hour ban
                r.setex(f"{_PREFIX_BAN}{ip}", HOUR_BAN_DURATION, "1")
                r.setex(f"{_PREFIX_STRIKES}{ip}", 86400, json.dumps(info))
                # Reset strikes after ban so next violation post-ban is strike 1 again (warning)
                reset_info = {"strikes": 0, "hour_bans": hour_bans, "warned": False}
                r.setex(f"{_PREFIX_STRIKES}{ip}", 86400, json.dumps(reset_info))
                logger.warning("ip_ban: 1-HOUR BAN #%d for %s", hour_bans, ip)
                return {
                    "action": "hour_ban",
                    "strikes": strikes,
                    "hour_bans": hour_bans,
                    "ban_remaining_s": HOUR_BAN_DURATION,
                }

    except Exception as e:
        logger.warning("ip_ban: failed to record violation for %s — %s", ip, e)
        return {"action": "none", "strikes": 0, "hour_bans": 0, "ban_remaining_s": None}


def is_banned(ip: str) -> tuple[bool, dict]:
    """Quick check if an IP is currently banned.

    Returns (is_banned, info_dict).
    """
    if not _enabled:
        return False, {"banned": False, "permanent": False, "strikes": 0, "hour_bans": 0}
    status = get_ip_status(ip)
    return status["banned"], status


def unban_ip(ip: str) -> bool:
    """Manually unban an IP (admin action). Clears all strikes and bans."""
    r = _get_redis()
    if r is None:
        return False
    try:
        r.delete(f"{_PREFIX_PERMANENT}{ip}")
        r.delete(f"{_PREFIX_BAN}{ip}")
        r.delete(f"{_PREFIX_STRIKES}{ip}")
        logger.info("ip_ban: ADMIN UNBAN for %s", ip)
        return True
    except Exception as e:
        logger.warning("ip_ban: failed to unban %s — %s", ip, e)
        return False


def get_all_banned_ips() -> list[dict]:
    """Return a list of all currently banned IPs (both temp and permanent)."""
    r = _get_redis()
    if r is None:
        return []

    banned = []
    try:
        # Scan for permanent bans
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match=f"{_PREFIX_PERMANENT}*", count=100)
            for key in keys:
                ip = key.replace(_PREFIX_PERMANENT, "")
                data = r.get(key)
                info = json.loads(data) if data else {}
                banned.append(
                    {
                        "ip": ip,
                        "permanent": True,
                        "hour_bans": info.get("hour_bans", 0),
                        "strikes": info.get("strikes", 0),
                        "ban_remaining_s": None,
                    }
                )
            if cursor == 0:
                break

        # Scan for timed bans
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match=f"{_PREFIX_BAN}*", count=100)
            for key in keys:
                ip = key.replace(_PREFIX_BAN, "")
                # Skip if already in permanent list
                if any(b["ip"] == ip for b in banned):
                    continue
                ttl = r.ttl(key)
                strike_data = r.get(f"{_PREFIX_STRIKES}{ip}")
                info = json.loads(strike_data) if strike_data else {}
                banned.append(
                    {
                        "ip": ip,
                        "permanent": False,
                        "hour_bans": info.get("hour_bans", 0),
                        "strikes": info.get("strikes", 0),
                        "ban_remaining_s": ttl if ttl and ttl > 0 else 0,
                    }
                )
            if cursor == 0:
                break

    except Exception as e:
        logger.warning("ip_ban: failed to list banned IPs — %s", e)

    return banned
