# Load Testing Methodology

This document details the exact setup used to simulate high concurrency user flooding, preserving our k6 load test procedures that validated the system's performance up to 500 concurrent users.

## The Testing Tool
We used **k6** to execute our load tests because of its code-driven (JavaScript) structure, fast performance handling high concurrent VU (virtual user) limits, and ease of automated execution. 

---

## 🥉 Bronze Test: 50 Users (The Baseline)
- **Command:** `k6 run load-tests/bronze.js`
- **Objective:** Simulate 50 concurrent users interacting with the standalone application for 30 seconds.
- **Workflow Executed per User:**
  1. `GET /health` (Verify server alive)
  2. `POST /shorten` (Create a url)
  3. `GET /urls` (Pagination lists)
  4. `GET /<short_code>` (Hit redirect)

## 🥈 Silver Test: 200 Users (The Scale-Out)
- **Command:** `k6 run load-tests/silver.js`
- **Objective:** Flood the system with 200 concurrent users to validate Nginx load balancer distribution across 2 instances.
- **Testing Profile:** Ramps up incrementally:
  - 15s → 50 VUs
  - 15s → 100 VUs
  - 30s → 200 VUs (Sustain)
  - 15s → 0 VUs (Ramp down)

## 🥇 Gold Test: 500 Users (The Tsunami)
- **Command:** `k6 run load-tests/gold.js`
- **Objective:** Break the application or sustain <5% error rates against 500 concurrent users by introducing the Redis cache layer.
- **Testing Profile:** Ramps to 500 users over 110 seconds.
- **Validation Additions:** Gold tests included executing *two consecutive redirects* for the same short code by identical VUs to precisely validate and capture 100% cache-hit validation measurements.
