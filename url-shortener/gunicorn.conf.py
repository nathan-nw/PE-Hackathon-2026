"""
Gunicorn configuration for production deployment.

Tuned for reliability under load:
- Multiple workers for concurrency
- Timeouts to prevent hung requests
- Graceful restart on failure
- Access logging
"""

import multiprocessing
import os

# Server socket
bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"

# Worker processes
# Rule of thumb: 2-4 workers per CPU core. On Railway, default to a small pool so the
# container stays under memory limits and binds to PORT quickly unless overridden.
_default_workers = multiprocessing.cpu_count() * 2 + 1
if "GUNICORN_WORKERS" in os.environ:
    workers = int(os.environ["GUNICORN_WORKERS"])
elif os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY"):
    workers = min(_default_workers, int(os.environ.get("RAILWAY_GUNICORN_WORKERS_MAX", "4")))
else:
    workers = _default_workers
worker_class = "sync"

# Timeouts
timeout = int(os.environ.get("GUNICORN_TIMEOUT", 30))
graceful_timeout = 10
keepalive = 5

# Restart workers after this many requests (prevents memory leaks)
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", 1000))
max_requests_jitter = 50

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()

# Process naming
proc_name = "url-shortener"

# Must be False when using DB pools: preloading forks workers with broken inherited connections.
preload_app = False


def post_worker_init(worker):
    """Re-attach Kafka (and root) logging after Gunicorn finishes worker setup."""
    from app.logging_config import configure_logging

    configure_logging()
