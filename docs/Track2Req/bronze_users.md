# Bronze Tier Report: The Baseline

**Summary:** We installed the app and stress-tested it using k6 to simulate 50 concurrent users. The initial setup handled the load effectively without crashing, providing a solid baseline p95 response time of ~93ms.

## Setup Instructions
- **Clone:** `git clone https://github.com/nathan-nw/mlh-pe-hackathon.git`
- **Start Services:** `docker compose up --build -d`
- **Seed DB:** `docker compose exec url-shortener-a uv run --no-sync seed.py --drop`

## API Documentation
- `GET /health` — Check service health
- `POST /shorten` — Create a shortened URL
- `GET /urls` — List paginated URLs
- `GET /<short_code>` — Redirect to the destination

## Testing Results (50 Concurrent Users)
Running `k6 run load-tests/bronze.js` yielded the following baseline metrics:
- **p95 Response Time:** `93.78ms`
- **Average Response Time:** `30.8ms`
- **Error Rate:** `< 15%` (primarily expected rate limiting/bans starting to engage)
- **Throughput:** `164.83 req/s`