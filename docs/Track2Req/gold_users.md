# Gold Tier Report: The Speed of Light

**Summary:** To sustain a "tsunami" of 500+ concurrent users with an error rate under 5%, we integrated Redis for in-memory caching. Hot-path requests (redirects, lists) now bypass the database, significantly avoiding query saturation.

## The Caching Strategy
- **Stored in Memory:** URL redirects (`redirect:{short_code}`) and paginated lists (`url_list:{page}`) are cached in Redis.
- **Cache Invalidation:** Hybrid write-through approaches instantly clear targeted keys on creates, updates, and deletes to preserve consistency.
- **Evidence of Caching:** The k6 tests clearly show 100% cache-hit validation for sequential redirects.

## Testing Results (500 Concurrent Users)
Running `k6 run load-tests/gold.js` fully tested the Redis layer under 500 concurrent users:
- **p95 Response Time:** `2650ms`
- **Error Rate:** `0.00%` (Maintained < 5% requirement perfectly)
- **Throughput:** `268.66 req/s` (Every single concurrent VU succeeded)

## Runbooks & Capacity Planning
- **[Runbooks](../Track3Req/runbook.md):** Detailed steps were drafted for responding to >5% error scenarios (restarting DB and checking Redis connections).
- **Capacity:** With Redis and 2 Nginx-load-balanced workers, the system limit is projected between 500-1000 concurrent users before PostgreSQL write-throughput becomes the absolute ceiling again.
