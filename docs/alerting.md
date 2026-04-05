# Alerting & Notification Configuration

## Architecture

The system has two independent alerting pipelines that both route to Discord:

```
Pipeline 1: Metrics-based (Prometheus)
  Flask replicas (/metrics)
      |
  Prometheus (:9090)  -- scrapes every 15s, evaluates rules
      |
  Alertmanager (:9093)  -- groups, deduplicates, rate-limits
      |
  POST /api/alertmanager-webhook
      |
  dashboard-backend (:8000)  -- formats Discord embeds
      |
  Discord webhook

Pipeline 2: Log-based (Kafka)
  Flask replicas (request logs)
      |
  Kafka (topic: app-logs)
      |
  dashboard-backend Kafka consumer
      |
  DiscordAlerter.maybe_alert()  -- fires on 5xx / ERROR / CRITICAL
      |
  Discord webhook
```

**Pipeline 1** catches infrastructure-level issues (service down, sustained error rates, latency degradation) using time-windowed PromQL expressions.

**Pipeline 2** catches individual bad requests in real time (every 5xx or ERROR log entry triggers an alert within seconds).

---

## Alert Rules (Prometheus)

All rules are defined in `prometheus/rules/slo.yml`.

| Alert | Severity | Expression (simplified) | `for` | Total Detection Time | When It Fires |
|-------|----------|------------------------|-------|---------------------|---------------|
| **ServiceDown** | critical | `sum(up) == 0` | 1m | ~75s | All url-shortener instances unreachable |
| **APITargetDown** | critical | Any `up` target == 0 | 2m | ~2m 15s | Single instance unreachable |
| **HighErrorRate** | critical | 5xx / total > 10% (2m rate) | 2m | ~2m 15s | >10% of requests returning 5xx |
| **High5xxRate** | warning | 5xx rate > 0.5/s (2m rate) | 2m | ~2m 15s | Sustained 5xx volume |
| **High429Rate** | warning | 429 rate > 1/s (5m rate) | 5m | ~5m 15s | Clients hitting rate limits |
| **HighLatencyP99** | warning | p99 latency > 2s | 5m | ~5m 15s | Slow response times |

**"Total Detection Time"** = `for` duration + Prometheus evaluation cycle (15s) + Alertmanager `group_wait` (10s).

### Critical vs Warning

- **Critical** = human must wake up and fix (ServiceDown, APITargetDown, HighErrorRate)
- **Warning** = investigate next business day (High5xxRate, High429Rate, HighLatencyP99)

---

## Discord Integration

### How it works

1. Alertmanager sends a POST to `http://dashboard-backend:8000/api/alertmanager-webhook`
2. The endpoint calls `DiscordAlerter.send_alertmanager_alerts()` which formats Discord embeds
3. Embeds are color-coded: red (critical/firing), orange (warning/firing), green (resolved)
4. Up to 10 alerts are batched per Discord message (Discord embed limit)
5. Rate-limited to 1 message/second to avoid Discord API throttling

### Setup

1. Create a Discord webhook in your channel: Server Settings > Integrations > Webhooks > New Webhook
2. Copy the webhook URL
3. Set it in your environment:
   ```bash
   # In .env at repo root
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
   ```
4. Docker Compose passes this through to `dashboard-backend` automatically

### Discord message format

**Firing alert:**
```
Title:  FIRING: ServiceDown
Color:  Red
Fields: Severity: critical | Status: firing
        Summary: All url-shortener instances are down
        Description: No url-shortener targets are responding...
```

**Resolved alert:**
```
Title:  RESOLVED: ServiceDown
Color:  Green
Fields: Severity: critical | Status: resolved
        Summary: All url-shortener instances are down
```

---

## Alert Fatigue Prevention

Design decisions to minimize noise:

1. **Alertmanager grouping** (`group_by: ['alertname', 'severity']`) — related alerts arrive as one notification, not a flood
2. **Group wait** (`group_wait: 10s`) — waits 10s to collect related alerts before sending the first notification
3. **Repeat interval** (`repeat_interval: 4h`) — same alert re-fires at most every 4 hours
4. **Percentage-based thresholds** — `HighErrorRate` uses >10% ratio, not absolute counts, so it doesn't false-positive at low traffic
5. **ServiceDown requires ALL instances down** — single instance failures get `APITargetDown` (still critical, but different)
6. **Resolved notifications** (`send_resolved: true`) — team knows when the incident ends

---

## Configuration Files

| File | Purpose |
|------|---------|
| `prometheus/rules/slo.yml` | Alert rule definitions (PromQL expressions, thresholds, durations) |
| `alertmanager/alertmanager.yml` | Alert routing, grouping, receiver config |
| `dashboard/backend/discord_alerter.py` | Discord webhook formatting (both log-based and Alertmanager-based) |
| `dashboard/backend/main.py` | `/api/alertmanager-webhook` endpoint |
| `k8s/configmap-prometheus.yaml` | K8s mirror of Prometheus config + rules |
| `k8s/configmap-alertmanager.yaml` | K8s mirror of Alertmanager config |

### Alertmanager config (`alertmanager/alertmanager.yml`)

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: discord
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 1m
  repeat_interval: 4h

receivers:
  - name: discord
    webhook_configs:
      - url: http://dashboard-backend:8000/api/alertmanager-webhook
        send_resolved: true
```

### Example alert rule (`prometheus/rules/slo.yml`)

```yaml
- alert: HighErrorRate
  expr: |
    (
      sum(rate(http_requests_total{status_code=~"5.."}[2m]))
      /
      sum(rate(http_requests_total[2m]))
    ) > 0.1
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "Error rate exceeds 10%"
    description: "More than 10% of requests are returning 5xx errors over the last 2 minutes."
```

---

## Demo / Verification

### Prerequisites

```bash
# Set Discord webhook in .env
echo 'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...' >> .env

# Start all services
docker compose up -d --build
```

### Demo 1: Service Down (fastest — ~75 seconds)

```bash
# Break the app
docker compose stop url-shortener-a url-shortener-b

# Wait ~75 seconds... Discord: "FIRING: ServiceDown"

# Fix the app
docker compose start url-shortener-a url-shortener-b

# Wait ~30 seconds... Discord: "RESOLVED: ServiceDown"
```

### Demo 2: Single Instance Down (~2 minutes)

```bash
docker compose stop url-shortener-a
# Wait ~2m 15s... Discord: "FIRING: APITargetDown"

docker compose start url-shortener-a
# Discord: "RESOLVED: APITargetDown"
```

### Demo 3: High Error Rate (~2 minutes)

```bash
# Stop the database to cause 5xx errors on all requests
docker compose stop db

# Send some traffic to trigger errors
for i in $(seq 1 50); do curl -s http://localhost:8080/api/urls > /dev/null; done

# Wait ~2m 15s... Discord: "FIRING: HighErrorRate"

docker compose start db
# Discord: "RESOLVED: HighErrorRate"
```

### Verify in UIs

- **Prometheus**: http://localhost:9090/alerts — see rule states (inactive/pending/firing)
- **Alertmanager**: http://localhost:9093 — see active alerts and silences
- **Dashboard**: http://localhost:3001 — Errors tab shows real-time error monitor
