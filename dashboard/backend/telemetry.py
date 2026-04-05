"""Prometheus proxy and instance-stats aggregation for the Ops Telemetry tab.

Hosted (Railway): the Next.js dashboard calls these endpoints via ``DASHBOARD_BACKEND_URL`` so
PromQL and per-replica ``/api/instance-stats`` run from a service on the private network
(reachable Prometheus + public or private load-balancer URL), not from the user's browser.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

# Enough attempts to hit both NGINX least_conn replicas when aggregating instance stats.
_INSTANCE_STATS_ATTEMPTS = 16


def prometheus_base() -> str:
    return (
        os.environ.get("PROMETHEUS_URL")
        or os.environ.get("VISIBILITY_PROMETHEUS_URL")
        or "http://127.0.0.1:9090"
    ).rstrip("/")


def telemetry_load_balancer_base() -> str:
    return (
        os.environ.get("TELEMETRY_LOAD_BALANCER_URL")
        or os.environ.get("LOAD_BALANCER_URL")
        or "http://load-balancer:80"
    ).rstrip("/")


def prometheus_proxy(request: Request) -> Response:
    """Forward PromQL ``query`` / ``query_range`` to Prometheus (same contract as Next ``/api/prometheus``)."""
    q = request.url.query
    query = (request.query_params.get("query") or "").strip()
    if not query:
        return JSONResponse({"error": "query parameter required"}, status_code=400)

    type_ = request.query_params.get("type") or "query_range"
    endpoint = "query_range" if type_ == "query_range" else "query"
    prom_url = f"{prometheus_base()}/api/v1/{endpoint}?{q}"

    try:
        req = urllib.request.Request(prom_url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            return Response(
                content=body, media_type="application/json", status_code=resp.status
            )
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read()
        except Exception:
            err_body = b""
        logger.warning("Prometheus HTTP %s: %s", e.code, err_body[:200])
        return JSONResponse(
            {
                "status": "error",
                "error": f"Prometheus HTTP {e.code}",
                "data": {"resultType": "matrix", "result": []},
            },
            status_code=503,
        )
    except Exception as e:
        logger.warning("Prometheus unreachable at %s: %s", prometheus_base(), e)
        return JSONResponse(
            {
                "status": "error",
                "error": str(e),
                "data": {"resultType": "matrix", "result": []},
            },
            status_code=503,
        )


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
