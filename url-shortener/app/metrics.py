"""Prometheus metrics (Phase A: per-worker registry under Gunicorn; see README)."""

import socket

from flask import Response
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, Counter, Histogram, Info, generate_latest

from app.instance_info import get_instance_id

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "status_code", "instance_id"],
)

HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "instance_id"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, float("inf")),
)

APP_INSTANCE = Info(
    "app_instance",
    "Static labels for this replica (set INSTANCE_ID in compose or env)",
)


def _register_instance_info() -> None:
    APP_INSTANCE.info(
        {
            "id": get_instance_id(),
            "hostname": socket.gethostname(),
        }
    )


_register_instance_info()


def metrics_response():
    """Prometheus text exposition for GET /metrics."""
    return Response(generate_latest(REGISTRY), mimetype=CONTENT_TYPE_LATEST)
