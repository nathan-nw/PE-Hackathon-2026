# Bottleneck Analysis

## Deliverable
2-3 sentence report on what was slow and how it was fixed.

## Report
Before optimization, the application bottlenecked on redundant database queries and connection pool saturation under high concurrency (200+ users). PostgreSQL connections would exhaust under sustained load, causing `peewee.OperationalError: connection pool exhausted` errors. We fixed this by introducing Redis as an in-memory caching layer for redirect lookups and paginated URL lists, and by scaling horizontally with two Nginx-load-balanced app instances to distribute connection pool pressure across replicas.

## Before vs After
| Metric | Before (no cache, 1 instance) | After (Redis + 2 instances) |
|--------|-------------------------------|----------------------------|
| 500 VU error rate | Connection pool failures | 0.00% |
| DB queries per redirect | 1 per request | 1 on miss, 0 on hit |
| Projected capacity | ~200 concurrent users | 500-1,000 concurrent users |
