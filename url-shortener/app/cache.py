"""
Redis caching layer for the URL shortener.

Caches:
- Redirect lookups (short_code -> original_url): avoids a DB hit on every redirect.
- Paginated URL list queries: briefly cached to reduce DB load under high concurrency.

Falls back gracefully to direct DB queries if Redis is unavailable.
"""

import json
import logging
import os

import redis

logger = logging.getLogger(__name__)

# Global Redis client — initialized lazily via init_cache().
_redis_client: redis.Redis | None = None

# Cache TTLs (seconds)
REDIRECT_TTL = 300  # 5 minutes for short_code -> URL mappings
URL_LIST_TTL = 10   # 10 seconds for paginated list (short-lived, high churn)


def init_cache():
    """Connect to Redis. Called once at app startup."""
    global _redis_client
    redis_url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    try:
        _redis_client = redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
        _redis_client.ping()
        logger.info("Redis cache connected: %s", redis_url)
    except Exception as e:
        logger.warning("Redis unavailable (%s) — caching disabled, falling back to DB", e)
        _redis_client = None


def get_client() -> redis.Redis | None:
    return _redis_client


# ── Redirect cache ──────────────────────────────────────────────────────────

def cache_redirect(short_code: str, original_url: str, is_active: bool):
    """Store a short_code -> URL mapping in Redis."""
    if _redis_client is None:
        return
    try:
        value = json.dumps({"url": original_url, "active": is_active})
        _redis_client.setex(f"redirect:{short_code}", REDIRECT_TTL, value)
    except Exception as e:
        logger.warning("Redis SET failed for redirect:%s — %s", short_code, e)


def get_cached_redirect(short_code: str) -> dict | None:
    """Fetch a cached redirect. Returns {"url": ..., "active": ...} or None."""
    if _redis_client is None:
        return None
    try:
        raw = _redis_client.get(f"redirect:{short_code}")
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.warning("Redis GET failed for redirect:%s — %s", short_code, e)
    return None


def invalidate_redirect(short_code: str):
    """Remove a cached redirect (called on URL update/delete)."""
    if _redis_client is None:
        return
    try:
        _redis_client.delete(f"redirect:{short_code}")
    except Exception as e:
        logger.warning("Redis DEL failed for redirect:%s — %s", short_code, e)


# ── URL list cache ──────────────────────────────────────────────────────────

def cache_url_list(page: int, per_page: int, data: dict):
    """Cache a paginated URL list response."""
    if _redis_client is None:
        return
    try:
        key = f"url_list:{page}:{per_page}"
        _redis_client.setex(key, URL_LIST_TTL, json.dumps(data, default=str))
    except Exception as e:
        logger.warning("Redis SET failed for url_list — %s", e)


def get_cached_url_list(page: int, per_page: int) -> dict | None:
    """Fetch a cached paginated URL list response."""
    if _redis_client is None:
        return None
    try:
        raw = _redis_client.get(f"url_list:{page}:{per_page}")
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.warning("Redis GET failed for url_list — %s", e)
    return None


def invalidate_url_lists():
    """Flush all cached URL list pages (called on create/update/delete)."""
    if _redis_client is None:
        return
    try:
        cursor = 0
        while True:
            cursor, keys = _redis_client.scan(cursor, match="url_list:*", count=100)
            if keys:
                _redis_client.delete(*keys)
            if cursor == 0:
                break
    except Exception as e:
        logger.warning("Redis SCAN/DEL failed for url_list invalidation — %s", e)
