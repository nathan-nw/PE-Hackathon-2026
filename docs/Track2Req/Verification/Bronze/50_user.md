# 50 Concurrent Users

## Deliverable
Screenshot of terminal output showing 50 concurrent users.

## Test Configuration
- **Script:** `load-tests/bronze.js`
- **Command:** `k6 run load-tests/bronze.js`
- **VUs:** 50
- **Duration:** 30 seconds

## Results
- **Concurrent users:** 50
- **Total HTTP requests:** 4,892
- **Checks passed:** 100%
- **Error rate:** 0.00%

## Summary
The service handled 50 concurrent users for 30 seconds with zero failures. All endpoint checks (health, shorten, list, redirect) passed. This establishes the baseline for higher-tier testing.
