# 500 Concurrent Users — The Tsunami

## Deliverable
Load test results showing 500 users with < 5% errors.

## Test Configuration
- **Script:** `load-tests/gold.js`
- **Command:** `k6 run load-tests/gold.js`
- **Ramp profile:** 100 → 250 → 500 (sustain 40s) → 0 VUs
- **Total duration:** ~110 seconds

## Results
- **Max concurrent users:** 500
- **Total HTTP requests:** 31,210
- **Checks passed:** 100%
- **Error rate:** 0.00% (requirement: < 5%)
- **p95 response time:** 2.65 s
- **Average response time:** 1.19 s
- **Median response time:** 1.11 s

### Route-Level p95
| Route | p95 |
|-------|-----|
| `POST /shorten` | 2,916.80 ms |
| `GET /<short_code>` (redirect) | 2,629.96 ms |
| `GET /urls` (list) | 2,569.80 ms |

## Summary
The system sustained 500 concurrent users with 0.00% errors, exceeding the Gold requirement of < 5%. Every VU completed successfully. The Redis caching layer prevented database saturation under this load.
