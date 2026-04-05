# Response Time Under 3 Seconds

## Deliverable
Load test results confirming p95 response time stays under 3 seconds at 200 VUs.

## Results
| Metric | Value | Threshold |
|--------|-------|-----------|
| **p95 response time** | **675.33 ms** | < 3,000 ms |
| Average response time | 230.24 ms | — |
| Median response time | 176.45 ms | — |
| Error rate | 0.00% | — |

## Summary
At 200 concurrent users, the p95 response time of 675.33 ms is well under the 3-second Silver requirement. The combination of two load-balanced app instances and `least_conn` routing kept latency stable throughout the ramp-up and sustained load phases.
