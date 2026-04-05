# App Core Logic

The `app/` directory contains the heart of the URL Shortener backend. It is heavily optimized for performance, scalability, and security.

## Subdirectories
- **[`routes/`](./routes/api_endpoints.md)**: Contains the modular HTTP API endpoints.
- **[`models/`](./models/database_schema.md)**: Contains the PostgreSQL schema declarations using Peewee.
- **`templates/`**: Contains Jinja2 HTML templates used to render built-in admin controls and local server interfaces.

## Core Modules
- **`__init__.py`**: The application factory that initializes the Flask app, registers blueprints, and mounts middleware.
- **`database.py`**: Manages connection pooling and lifecycle events for the PostgreSQL database.
- **`cache.py`**: Manages the Redis caching layer. Essential for caching URL redirects (`GET /<short_code>`) and URL lists to avoid database bottlenecks under heavy load.
- **`middleware.py`**: A centralized location for all request lifecycle hooks: IP banning, rate limiting enforcement, request logging, and generic exception/error handling (e.g. 404s and 500s).
- **`circuit_breaker.py`**: Protects the system from cascading failures if external services (like the database or Kafka) become unhealthy.
- **`ip_ban.py` / `dynamic_rate_limit.py`**: Advanced security logic that detects abusive traffic patterns, issues dynamic rate limits based on active user counts, and bans malicious requests.
