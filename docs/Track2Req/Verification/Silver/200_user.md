# 200 Concurrent Users

## Deliverable
Load test results showing success with 200 users.

## Test Configuration
- **Script:** `load-tests/silver.js`
- **Command:** `k6 run load-tests/silver.js`
- **Ramp profile:** 50 → 100 → 200 (sustain) → 0 VUs
- **Total duration:** ~105 seconds

## Results
- **Max concurrent users:** 200
- **Total HTTP requests:** 38,312
- **Checks passed:** 100%
- **Error rate:** 0.00%
- **p95 response time:** 675.33 ms
- **Average response time:** 230.24 ms
- **Median response time:** 176.45 ms

## Summary
The system handled 200 concurrent users with zero errors and a p95 of 675.33 ms — well under the 3-second Silver requirement. The incremental ramp profile confirmed stability at each stage before reaching full load.
