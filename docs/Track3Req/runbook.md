# 🚨 In Case of Emergency: Incident Response Runbook

This guide contains **explicit, highly actionable alert-response procedures**. When a Discord alert fires at 3 AM and your brain is non-functional, do not think. Just read and execute exactly these steps.

## 🔴 Critical Alerts (Drop Everything & Fix)
*Service is completely broken. Users are organically impacted.*

### 1. `ServiceDown` (Total Outage)
**Definition:** The entire backend is completely offline. 
**Immediate Actionable Procedure:**
1. **Verify Outage Scope:** Open the Live Dashboard UI. Check the "Traffic" and "Latency" graphs. Are they completely flatlining?
2. **Check Container Status:** Open your terminal and execute:
   ```bash
   docker compose ps url-shortener-a url-shortener-b
   ```
3. **Emergency Resurrection:** If their states are `Exited` or `Dead`, explicitly force them to spin back up to stop the bleeding:
   ```bash
   docker compose start url-shortener-a url-shortener-b
   ```
4. **Identify the Root Cause:** If the containers immediately crash again, pull the exact stack trace:
   ```bash
   docker compose logs --tail=50 url-shortener-a
   ```
   *(Look for explicitly red `SystemExit`, `MemoryError`, or `DBConnectionTimeout` strings at the bottom).*

### 2. `APITargetDown` (Partial Node Failure)
**Definition:** One instance nodes failed. The Nginx load balancer is struggling but surviving.
**Immediate Actionable Procedure:**
1. **Identify Target:** Look at the exact Discord alert text. It will specify the exact node (e.g., `url-shortener-a`).
2. **Resurrect Node:** Restart the distinct crashed target without disrupting the healthy ones:
   ```bash
   # Replace <node-name> with the crashed node
   docker compose start <node-name>
   ```
3. **Verify Restoration:** Confirm it returns to a healthy status:
   ```bash
   docker compose ps
   ```

### 3. `HighErrorRate` (Bleeding 5xx Errors)
**Definition:** >10% of users are getting 500 errors. The app process is up, but functionality is broken.
**Immediate Actionable Procedure:**
1. **Isolate Component:** Open the Dashboard UI and check the structured JSON output. Filter explicitly for `ERROR`.
2. **Database CPR:** If the logs explicitly mention `psycopg2.OperationalError` or Postgres:
   ```bash
   docker compose restart db
   ```
3. **Cache CPR:** If the logs explicitly mention `redis.exceptions.ConnectionError`:
   ```bash
   docker compose restart redis
   ```
4. **Rollback:** If this alert fired within 15 minutes of a new feature merge and infrastructure is stable, immediately revert the last repository commit.

---

## 🟠 Warning Alerts (Investigate Tomorrow)
*System is stressed, but natively surviving. Do not wake up for these. Fix them during regular explicitly scheduled hours.*

### 1. `HighLatencyP99` (It's Slow)
**Actionable Procedure:**
1. Open the UI Dashboard. Is the "Saturation" (CPU/RAM) graph explicitly maxed out?
2. If Traffic is normal but Latency is consistently high, the codebase relies on an unoptimized database query. Pinpoint the query using backend logs and add explicit Redis caching.

### 2. `High429Rate` (Rate Limiting Wall)
**Actionable Procedure:**
1. Open the Dashboard Logs UI. The JSON payload will explicitly list the offending `ip_address` spamming requests.
2. If it is a malicious vulnerability scraper, they are actively banned. No action needed.
3. If it is a legitimate high-volume enterprise user, alert the customer success team to upgrade their tier limits explicitly.
