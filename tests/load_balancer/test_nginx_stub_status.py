"""Optional: NGINX ``stub_status`` (compose maps host :8081).

Set the full URL including path, e.g.:

    export TEST_NGINX_STUB_STATUS_URL=http://127.0.0.1:8081/nginx_status

Skipped in CI and when unset.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.request

import pytest

STUB_URL = os.environ.get("TEST_NGINX_STUB_STATUS_URL", "").strip()

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not STUB_URL,
        reason="Set TEST_NGINX_STUB_STATUS_URL (e.g. http://127.0.0.1:8081/nginx_status)",
    ),
]


def test_nginx_stub_status_body():
    req = urllib.request.Request(STUB_URL, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode()
    except urllib.error.HTTPError as e:
        raise AssertionError(f"stub_status returned HTTP {e.code}") from e
    assert "Active connections" in body
