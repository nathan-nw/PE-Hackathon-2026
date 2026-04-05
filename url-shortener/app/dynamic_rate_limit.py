"""
Dynamic rate limiter that adjusts per-IP limits based on estimated active users.

Uses a hybrid approach to estimate active users:
  1. Unique IPs seen in a sliding window (accurate in production)
  2. Request volume in the same window / estimated requests-per-user
     (captures load from single-IP sources like load tests)

The higher of the two estimates is used as the effective user count.

Scaling tiers (both directions):
  - 0-50 users:   5000 req/min per IP  (low load, generous)
  - 51-200 users: 2000 req/min per IP  (moderate, start conserving)
  - 201-500 users: 500 req/min per IP  (high load, protect system)
  - 500+ users:    200 req/min per IP  (extreme, survival mode)
"""

import json
import logging
import os
import time

logger = logging.getLogger(__name__)

# Redis keys
_KEY_ACTIVE_USERS = "dynamic_rl:active_users"
_KEY_REQUEST_LOG = "dynamic_rl:request_log"
_KEY_CONFIG = "dynamic_rl:config"

# How long an IP counts as "active" after its last request
ACTIVE_WINDOW_SECONDS = 60

# Assumed average requests per user per 60s window for volume-based estimation.
# A typical active user or load-test VU generates ~100 requests per minute.
REQUESTS_PER_USER = 100

# Default tier thresholds and limits
DEFAULT_TIERS = [
    {"max_users": 50, "rate_limit": 5000},
    {"max_users": 200, "rate_limit": 2000},
    {"max_users": 500, "rate_limit": 500},
    {"max_users": 999999, "rate_limit": 200},
]


def _get_redis():
    from app.cache import get_client

    return get_client()


def get_config() -> dict:
    """Return the current dynamic rate limit configuration."""
    r = _get_redis()
    if r is None:
        return {"enabled": True, "tiers": DEFAULT_TIERS}

    try:
        data = r.get(_KEY_CONFIG)
        if data:
            return json.loads(data)
    except Exception as e:
        logger.warning("dynamic_rl: failed to read config — %s", e)

    return {"enabled": True, "tiers": DEFAULT_TIERS}


def set_config(config: dict) -> bool:
    """Update the dynamic rate limit configuration (admin action)."""
    r = _get_redis()
    if r is None:
        return False
    try:
        r.set(_KEY_CONFIG, json.dumps(config))
        logger.info("dynamic_rl: config updated — %s", config)
        return True
    except Exception as e:
        logger.warning("dynamic_rl: failed to set config — %s", e)
        return False


def record_request(ip: str):
    """Record that an IP made a request.

    Updates both:
      - the unique-IP sorted set (for IP-based counting)
      - a request-log sorted set (for volume-based counting)
    """
    r = _get_redis()
    if r is None:
        return
    try:
        now = time.time()
        # Track unique IPs (latest timestamp per IP)
        r.zadd(_KEY_ACTIVE_USERS, {ip: now})
        # Track total request volume (each request is a unique entry)
        r.zadd(_KEY_REQUEST_LOG, {f"{ip}:{now}": now})
    except Exception as e:
        logger.warning("dynamic_rl: failed to record request for %s — %s", ip, e)


def get_active_user_count() -> dict:
    """Estimate active users using the higher of unique-IP count and volume-based estimate.

    Returns dict with unique_ips, request_volume, estimated_from_volume, and effective_users.
    """
    r = _get_redis()
    if r is None:
        return {"unique_ips": 0, "request_volume": 0, "estimated_from_volume": 0, "effective_users": 0}
    try:
        cutoff = time.time() - ACTIVE_WINDOW_SECONDS

        # Prune expired entries from both sets
        r.zremrangebyscore(_KEY_ACTIVE_USERS, "-inf", cutoff)
        r.zremrangebyscore(_KEY_REQUEST_LOG, "-inf", cutoff)

        unique_ips = r.zcard(_KEY_ACTIVE_USERS)
        request_volume = r.zcard(_KEY_REQUEST_LOG)
        estimated_from_volume = request_volume // REQUESTS_PER_USER

        effective = max(unique_ips, estimated_from_volume)

        return {
            "unique_ips": unique_ips,
            "request_volume": request_volume,
            "estimated_from_volume": estimated_from_volume,
            "effective_users": effective,
        }
    except Exception as e:
        logger.warning("dynamic_rl: failed to count active users — %s", e)
        return {"unique_ips": 0, "request_volume": 0, "estimated_from_volume": 0, "effective_users": 0}


def get_current_rate_limit() -> dict:
    """Calculate the current per-IP rate limit based on active users.

    Returns dict with:
      - rate_limit: int (requests per minute)
      - active_users: int
      - tier_index: int (which tier is active)
      - enabled: bool
    """
    config = get_config()
    user_info = get_active_user_count()
    active_users = user_info["effective_users"]

    if not config.get("enabled", True):
        base = int(os.environ.get("RATE_LIMIT_DEFAULT", "5000 per minute").split()[0])
        return {
            "rate_limit": base,
            "active_users": active_users,
            "unique_ips": user_info["unique_ips"],
            "request_volume": user_info["request_volume"],
            "tier_index": -1,
            "enabled": False,
        }

    tiers = config.get("tiers", DEFAULT_TIERS)

    for i, tier in enumerate(tiers):
        max_users = tier.get("max_users", 999999)
        if active_users <= max_users:
            return {
                "rate_limit": tier["rate_limit"],
                "active_users": active_users,
                "unique_ips": user_info["unique_ips"],
                "request_volume": user_info["request_volume"],
                "tier_index": i,
                "enabled": True,
            }

    # Fallback to most restrictive
    return {
        "rate_limit": tiers[-1]["rate_limit"] if tiers else 200,
        "active_users": active_users,
        "unique_ips": user_info["unique_ips"],
        "request_volume": user_info["request_volume"],
        "tier_index": len(tiers) - 1,
        "enabled": True,
    }


def get_status() -> dict:
    """Full status for the admin dashboard."""
    config = get_config()
    current = get_current_rate_limit()
    return {
        "enabled": config.get("enabled", True),
        "tiers": config.get("tiers", DEFAULT_TIERS),
        "active_users": current["active_users"],
        "unique_ips": current.get("unique_ips", 0),
        "request_volume": current.get("request_volume", 0),
        "current_rate_limit": current["rate_limit"],
        "current_tier_index": current["tier_index"],
    }
