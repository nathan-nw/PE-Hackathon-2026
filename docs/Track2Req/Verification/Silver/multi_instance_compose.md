# Multiple App Instances via Docker Compose

## Deliverable
`docker ps` showing multiple app containers + 1 Nginx container.

## What We Implemented
Two stateless Flask API replicas run as separate Docker Compose services:
- `url-shortener-a` (port 5000 internal)
- `url-shortener-b` (port 5000 internal)

Both connect to a shared PostgreSQL database and stream logs to Kafka independently. Each runs Gunicorn as the WSGI server.

## How to Verify
```bash
docker compose up --build -d
docker ps
```

Expected output shows:
- `hackathon_url_shortener_a` — running
- `hackathon_url_shortener_b` — running
- `hackathon_load_balancer` (Nginx) — running
- Shared services: `db`, `redis`, `kafka`, etc.

## Why Horizontal Scaling
Horizontal scaling (adding instances) avoids single-point-of-failure and doubles connection pool capacity to PostgreSQL. Both instances are stateless, so any request can be served by either replica.
