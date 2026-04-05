# Live Demos: Break the App!

You can safely run chaos tests locally to trigger the Discord alerts in real-time.
**Prerequisite:** Make sure your Discord webhook is configured in `.env` and `docker compose up -d` is running.

### Demo 1: Full System Outage (~75 seconds to detect)
1. Completely kill the API: `docker compose stop url-shortener-a url-shortener-b`
2. Wait ~75 seconds... Discord will proudly ping: **FIRING: ServiceDown**
3. Turn it back on: `docker compose start url-shortener-a url-shortener-b`
4. Wait ~30 seconds... Discord will ping: **RESOLVED: ServiceDown**

### Demo 2: High Error Rate Spikes (~2 minutes to detect)
1. Stop the database to force internal 500 errors across all routes: `docker compose stop db`
2. Send traffic using curl to trigger the errors: `for i in $(seq 1 50); do curl -s http://localhost:8080/api/urls > /dev/null; done`
3. Wait ~2 minutes... Discord will ping: **FIRING: HighErrorRate**
4. Restart the DB: `docker compose start db` to see the **RESOLVED** message follow gracefully shortly after.
