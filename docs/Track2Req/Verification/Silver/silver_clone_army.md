# Clone Army — 2+ App Instances

## Deliverable
Evidence of running 2+ instances of the app behind a load balancer.

## What We Implemented
Two identical Flask app containers run in parallel via Docker Compose:
- `url-shortener-a`
- `url-shortener-b`

Both are built from the same Dockerfile and codebase. Nginx distributes traffic between them using `least_conn`. Each instance has its own Kafka producer for log streaming and its own connection pool to the shared PostgreSQL database.

## How to Verify
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

This shows both app containers and the Nginx load balancer running simultaneously. Health can be confirmed per-instance via the dashboard's infrastructure panel or directly:
```bash
curl http://localhost:8080/health
```

The `X-Instance-ID` response header identifies which replica served the request.
