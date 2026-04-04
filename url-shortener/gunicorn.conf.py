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
# Rule of thumb: 2-4 workers per CPU core
workers = int(os.environ.get("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))
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
