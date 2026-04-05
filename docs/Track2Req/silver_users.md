# Silver Tier Report: The Scale-Out

**Summary:** To handle 200 concurrent users and keep response times under 3 seconds, we scaled horizontally by running multiple app containers behind an Nginx load balancer. This doubled our database connection capacity and prevented individual instances from being overwhelmed.

## Architecture
- **Load Balancer:** Nginx handles incoming traffic routing via `least_conn`.
- **App Instances:** 2 separate containerized instances (`url-shortener-a`, `url-shortener-b`) running Gunicorn.
- **Database:** Shared PostgreSQL instance ensuring consistent state.

## Deployment Guide
- Updates can be performed with zero downtime by pulling the latest code and running `docker compose up --build -d` (Nginx remains active while containers cycle).
- Troubleshooting usually involves checking app health via `docker ps` or observing the logs `docker compose logs url-shortener-a`.

## Testing Results (200 Concurrent Users)
Running `k6 run load-tests/silver.js` yielded successfully scaled metrics:
- **p95 Response Time:** `187.48ms` (Well under the 3000ms goal)
- **Average Response Time:** `47.67ms`
- **Throughput:** `617.96 req/s`