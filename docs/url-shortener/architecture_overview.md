# URL Shortener Overview

The `url-shortener` directory contains the core backend API for the link shortening service. It is a robust, production-ready Flask application designed to handle high concurrency, caching, and rate limiting.

## Directory Structure
- **[`app/`](./app/app_core_logic.md)**: The main Flask application codebase, including database logic, Redis caching, and middleware.
- **`csv_data/`**: Contains static `.csv` files used by the `seed.py` utility to populate the database with sample data during initial deployments.
- **`migrations/`**: Houses database migration scripts to manage schema versions over time using Peewee.
- **`scripts/`**: Utilities and helper scripts relevant to the backend lifecycle.

## Root Entry Points
- **`run.py` / `pyproject.toml`**: Used to boot the Flask app locally and manage dependencies.
- **`gunicorn.conf.py`**: Configures the Gunicorn WSGI server for concurrent production traffic (used via the `Dockerfile`).
- **`kafka_consumer.py`**: A standalone script that processes app logs off the Kafka message bus for external telemetry.
