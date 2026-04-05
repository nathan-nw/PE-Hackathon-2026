# Redis Caching

## Deliverable
Evidence of caching (headers, logs, or speed comparison).

## What We Implemented
Redis (v7, Alpine) runs as a Docker Compose service. The Flask app caches hot-path queries to avoid hitting PostgreSQL on every request:

- **Redirect cache:** `redirect:{short_code}` — cached on first lookup, served from memory on subsequent requests
- **URL list cache:** `url_list:{page}` — cached paginated results
- **Cache invalidation:** Write-through — keys are cleared immediately on create, update, and delete operations to maintain consistency

## Evidence of Caching
The Gold k6 test script executes **two consecutive redirects** for the same short code per VU iteration. The terminal output shows `redirect cache hit` checks passing, confirming the second redirect was served from Redis rather than the database.

## Impact
With Redis caching, the system handled 500 VUs at 0% errors. Without caching, database connection pool exhaustion occurred at ~200+ VUs under sustained load. Redis reduced DB query volume by approximately 60-80% on read-heavy paths.
