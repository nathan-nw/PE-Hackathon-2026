"""Align with load-balancer + dashboard k6: X-Load-Test-Bypass + LOAD_TEST_BYPASS_TOKEN.

When the header matches, the app skips IP-ban enforcement, does not record ban strikes on 429,
and exempts requests from Flask-Limiter default limits so load tests are not throttled or banned
as a single client IP (e.g. behind NGINX).
"""

from __future__ import annotations

import os

from flask import request

_HEADER = "X-Load-Test-Bypass"


def is_load_test_bypass_request() -> bool:
    token = (os.environ.get("LOAD_TEST_BYPASS_TOKEN") or "").strip()
    if not token:
        return False
    return (request.headers.get(_HEADER) or "").strip() == token
