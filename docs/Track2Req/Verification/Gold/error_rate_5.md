# Error Rate Under 5%

## Deliverable
Load test results confirming error rate stays under 5% at 500 VUs.

## Results
| Metric | Value | Threshold |
|--------|-------|-----------|
| **Error rate** | **0.00%** | < 5% |
| Checks passed | 100% | — |
| Total requests | 31,210 | — |
| Failed requests | 0 | — |

## Summary
At 500 concurrent users, the error rate was 0.00% — every single request succeeded. The combination of Redis caching (reducing DB load), two load-balanced app instances (distributing connection pressure), and `least_conn` routing kept the system stable throughout the full ramp-up and sustained load phase.
