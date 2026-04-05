# Dashboard Backend Documentation

This folder documents the `dashboard/backend` directory.

The dashboard's backend engine is a Python-based service responsible for serving metrics to the UI, running load tests, and handling incident response alerts.

## Key Files & Modules
- **`main.py`**: The primary API entry point. Likely a FastAPI server that exposes data endpoints for the Next.js frontend.
- **`db.py` / `cache.py`**: Modules for directly interacting with PostgreSQL and Redis to fetch system metrics, URL stats, and rate-limit states.
- **`discord_alerter.py`**: The crucial incident response module. It receives webhook calls from Prometheus/Alertmanager and formats them into color-coded Discord embeds before dispatching them.
- **`kafka_consumer.py`**: Subscribes to the Kafka `app-logs` topic to power the real-time "Pipeline 2" log-based alerting mechanism.
- **`k6_runner.py` / `load-test.js`**: Tooling to programmatically trigger k6 load tests and relay the test data directly to the dashboard visualization UI.

## Operations
- Packaging is handled via a dedicated `Dockerfile`.
- Remote deployments use `railway.toml`.
- Dependencies are stored in `requirements.txt`.
