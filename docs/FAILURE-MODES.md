# Failure Modes

What happens when things break — and how the system responds.

---

## 1. URL Shortener Replica Crashes

**How to trigger:**
```bash
docker kill pe-hackathon-2026-url-shortener-a-1
```

**What happens:**
- Docker restarts the container automatically (`restart: always`).
- The NGINX load balancer detects the downed replica via health checks and routes all traffic to the surviving replica (`url-shortener-b`).
- Users experience zero downtime — requests are served by the healthy replica.
- Once the killed replica restarts and passes its `/live` health check, NGINX resumes routing to it.

**What the user sees:** Nothing. Requests succeed transparently.

**Recovery time:** ~25 seconds (health check `start_period`).

---

## 2. Both URL Shortener Replicas Down

**How to trigger:**
```bash
docker kill pe-hackathon-2026-url-shortener-a-1 pe-hackathon-2026-url-shortener-b-1
```

**What happens:**
- NGINX has no healthy upstream backends.
- Returns **502 Bad Gateway** to clients.
- Both containers restart automatically.
- Service resumes once at least one replica passes health checks.

**What the user sees:** "Looks like we can't reach the server right now. Please check your connection and try again." (user-frontend) or a 502 JSON error.

**Recovery time:** ~25–35 seconds.

---

## 3. Database (PostgreSQL) Goes Down

**How to trigger:**
```bash
docker kill hackathon_db
```

**What happens:**
- The circuit breaker (`app/circuit_breaker.py`) detects DB failures after 5 consecutive errors and trips to **OPEN** state.
- All DB-dependent requests return **503** with a clean JSON error: `{"error": "Database not reachable", "hint": "Start Postgres first..."}`.
- The `/live` endpoint still returns 200 (container stays up).
- The `/ready` endpoint returns 503 (load balancer stops sending traffic if using readiness probes).
- The DB container restarts automatically (`restart: always`).
- The circuit breaker transitions to **HALF_OPEN** after 30 seconds and tests a single request. If it succeeds, it resets to **CLOSED**.

**What the user sees:** "Oh no! Something went wrong on our end — nothing on your side. Please refresh and try again. :)"

**Recovery time:** ~10–15 seconds for DB restart + up to 30 seconds for circuit breaker recovery.

---

## 4. Kafka Goes Down

**How to trigger:**
```bash
docker kill hackathon_kafka
```

**What happens:**
- The Kafka log producer in url-shortener fails silently (fire-and-forget). **API requests continue to work normally** — Kafka logging is non-blocking.
- The dashboard-backend Kafka consumer loses its connection and logs warnings.
- The live log stream in the dashboard stops updating but does not crash.
- No new Discord alerts are sent (the alerter depends on the Kafka consumer).
- Kafka restarts automatically (`restart: unless-stopped`).
- Consumers reconnect with their retry loops (up to 30 attempts, 2s apart).

**What the user sees:** The URL shortener works fine. The ops dashboard shows stale logs until Kafka recovers.

**Recovery time:** ~30–60 seconds (Kafka broker startup + consumer reconnect).

---

## 5. Load Balancer (NGINX) Goes Down

**How to trigger:**
```bash
docker kill pe-hackathon-2026-load-balancer-1
```

**What happens:**
- Port 8080 becomes unreachable. No requests can reach the API.
- Docker restarts the container automatically (`restart: always`).
- NGINX starts in <2 seconds and immediately begins proxying again.

**What the user sees:** "Looks like we can't reach the server right now." for a few seconds, then everything works again.

**Recovery time:** 2–5 seconds.

---

## 6. Dashboard Backend (FastAPI) Goes Down

**How to trigger:**
```bash
docker kill pe-hackathon-2026-dashboard-backend-1
```

**What happens:**
- The Next.js dashboard API routes (`/api/logs`, `/api/logs/stats`) return **503** with a hint: "Start the dashboard-backend service."
- The ops dashboard shows: "Can't reach the log service right now — the dashboard-backend might still be starting up. Hang tight!"
- The container restarts automatically.
- The Kafka consumer thread re-initializes on startup and picks up new messages (historical messages are lost since `auto.offset.reset: latest`).

**What the user sees:** Log panel shows a friendly error. All other panels (Docker, K8s, Alerts) continue working.

**Recovery time:** ~5–10 seconds.

---

## 7. Dashboard Database Goes Down

**How to trigger:**
```bash
docker kill hackathon_dashboard_db
```

**What happens:**
- The dashboard-backend's periodic DB flush fails and logs warnings, but the in-memory ring buffer continues accepting logs.
- Live log streaming continues to work (served from cache).
- Historical log persistence pauses until the DB is back.
- The DB container restarts automatically (`restart: always`).
- The backend retries DB initialization (30 attempts, 2s apart).

**What the user sees:** No visible impact on the live dashboard. Historical queries may return stale data briefly.

**Recovery time:** ~10–15 seconds.

---

## 8. Sending Garbage Data to the API

**Malformed JSON:**
```bash
curl -X POST http://localhost:8080/shorten -H "Content-Type: application/json" -d "not json"
```
**Response:** `400 {"error": "Invalid or missing JSON body", "hint": "Send a JSON object with Content-Type: application/json"}`

**Missing required fields:**
```bash
curl -X POST http://localhost:8080/shorten -H "Content-Type: application/json" -d '{}'
```
**Response:** `400 {"error": "original_url and user_id are required"}`

**Invalid URL format:**
```bash
curl -X POST http://localhost:8080/shorten -H "Content-Type: application/json" -d '{"original_url":"not-a-url","user_id":1}'
```
**Response:** `400 {"error": "original_url must start with http:// or https://"}`

**Wrong types:**
```bash
curl -X POST http://localhost:8080/shorten -H "Content-Type: application/json" -d '{"original_url":"https://example.com","user_id":"abc"}'
```
**Response:** `400 {"error": "user_id must be an integer"}`

**Non-existent resource:**
```bash
curl http://localhost:8080/urls/99999
```
**Response:** `404 {"error": "URL not found"}`

**Wrong HTTP method:**
```bash
curl -X DELETE http://localhost:8080/shorten
```
**Response:** `405 {"error": "Method not allowed"}`

All error responses are **valid JSON** with an `error` field. The app never returns a Python stack trace to the client.

---

## 9. Discord Alerter Fails

**What happens if the webhook URL is wrong or Discord is down:**
- The alerter catches all exceptions and logs them as warnings.
- It never crashes the Kafka consumer or the dashboard-backend.
- Alerts are silently dropped until the webhook becomes reachable again.
- Rate-limited to 1 alert per second to avoid Discord throttling.

---

## 10. Full System Chaos Test (Demo Script)

Run this to prove resilience for the hackathon demo:

```bash
# 1. Kill one API replica — traffic still flows
docker kill pe-hackathon-2026-url-shortener-a-1
curl -s http://localhost:8080/health | jq .
# Should return healthy from replica B

# 2. Kill the database — clean error, no crash
docker kill hackathon_db
curl -s http://localhost:8080/shorten \
  -H "Content-Type: application/json" \
  -d '{"original_url":"https://example.com","user_id":1}' | jq .
# Should return 503 with "Database not reachable"

# 3. Send garbage — polite errors
curl -s -X POST http://localhost:8080/shorten \
  -H "Content-Type: application/json" \
  -d 'lol this is garbage' | jq .
# Should return 400 with "Invalid or missing JSON body"

# 4. Wait ~30s, verify everything auto-recovered
sleep 35
curl -s http://localhost:8080/health | jq .
# Should return {"status": "ok", "database": "ok", ...}

# 5. Verify containers restarted
docker ps --format "table {{.Names}}\t{{.Status}}" | grep hackathon
# All containers should show "Up X seconds" (recently restarted)
```

---

## Summary Table

| Component | Failure Impact | Auto-Recovery | User Experience |
|-----------|---------------|---------------|-----------------|
| 1 API replica | None (LB failover) | ~25s restart | Transparent |
| Both API replicas | 502 errors | ~30s restart | Friendly error, then recovery |
| PostgreSQL | 503 on writes/reads | ~15s + circuit breaker | Friendly error |
| Kafka | Logging pauses | ~60s reconnect | API works, dashboard stale |
| NGINX | Full outage | ~3s restart | Brief unreachable |
| Dashboard backend | Log panel errors | ~10s restart | Friendly message, other panels ok |
| Dashboard DB | Flush pauses | ~15s restart | No visible impact |
| Discord webhook | Alerts stop | N/A (graceful skip) | No user impact |
