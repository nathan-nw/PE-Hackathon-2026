"""Load-balancer instance-stats aggregation for the Ops Telemetry tab.

Golden-signals charts use **application HTTP logs** (``telemetry_agg``) — not Prometheus.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# Enough attempts to hit both NGINX least_conn replicas when aggregating instance stats.
_INSTANCE_STATS_ATTEMPTS = 16


def telemetry_load_balancer_base() -> str:
    return (
        os.environ.get("TELEMETRY_LOAD_BALANCER_URL")
        or os.environ.get("LOAD_BALANCER_URL")
        or "http://load-balancer:80"
    ).rstrip("/")


def aggregate_instance_stats() -> list[dict[str, Any]]:
    """Call the load balancer ``/api/instance-stats`` until unique ``instance_id`` values are seen."""
    base = telemetry_load_balancer_base()
    url = f"{base}/api/instance-stats"
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    for attempt in range(_INSTANCE_STATS_ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            if attempt == 0:
                logger.warning("instance-stats failed (%s): %s", url, e)
            break

        if isinstance(data, dict) and data.get("instance_id") is not None:
            iid = str(data.get("instance_id", ""))
            if iid and iid not in seen:
                seen.add(iid)
                out.append(data)
            if len(seen) >= 2:
                break
        else:
            logger.warning("unexpected instance-stats shape from %s", url)
            break

    return out
