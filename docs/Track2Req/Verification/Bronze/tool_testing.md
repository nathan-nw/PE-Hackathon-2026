# Tool Testing — k6

## Deliverable
Screenshot of terminal output showing k6 running against the service.

## What We Implemented
We used **k6** as our load testing tool. k6 is installed inside the `dashboard-backend` Docker container and can also be run locally. Load test scripts live in `load-tests/` with presets for each tier (bronze, silver, gold, chaos).

Additionally, k6 is integrated into the ops dashboard via `k6_runner.py` — users can trigger and monitor load tests directly from the UI with live metrics streaming (requests, errors, latency, VUs).

## How to Run
```bash
# From terminal (k6 installed locally)
k6 run load-tests/bronze.js

# From Docker container
docker compose exec dashboard-backend k6 run load-test.js

# From the dashboard UI
# Navigate to http://localhost:3001 → Load Test tab → select preset → Start
```

## Tested Endpoints
Each test iteration exercises the full request lifecycle:
1. `GET /health` — liveness check
2. `POST /shorten` — create a short URL
3. `GET /urls` — paginated list
4. `GET /<short_code>` — redirect
