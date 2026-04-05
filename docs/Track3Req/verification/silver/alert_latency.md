# 🥈 Silver Tier Verification: Alert Latency

**Objective:** Document system alert latency explicitly to prove that triggers successfully fire and ping engineers comfortably within the strict 5-minute requirement of a system failure.

### Validating Response Speed
Our backend infrastructure is mathematically engineered to process anomaly data rapidly, ensuring we safely hit the mandatory 5-minute response ceiling without false positives.

1. **Prometheus Scraping:** Prometheus actively scrapes the `/metrics` endpoints across all system containers exactly every 15 seconds. This high-resolution ingestion prevents initial baseline latency.
2. **Threshold Evaluation (The 2-Minute Rule):** When a critical threshold physically breaks (such as `ServiceDown`), Prometheus evaluates it for precisely 2 continuous minutes (`for: 2m` internally defined in `slo.yml`). If the metric recovers within 60 seconds, no alert is sent (Alert Fatigue prevention). If the failure spans the entire 2 minutes, the alert is officially marked as active.
3. **Alertmanager Group Waiting:** The active payload is instantly handed to Alertmanager, which holds it strictly for ~10 seconds (`group_wait`) to bundle any correlated secondary network alerts preventing spam.
4. **Webhook Delivery:** Alertmanager fires the formatted webhook POST request.

**Total Expected Latency Lifecycle:**
15s (Scrape Maximum) + 120s (Prometheus evaluation) + 10s (Alertmanager group validation) + 1s (Discord transmission overhead) = **~146 seconds (~2 minutes and 26 seconds)**.

This architectural decision actively protects engineers from fatigue while guaranteeing that every single on-call operator is physically notified comfortably underneath the critical 5-minute Hackathon deadline!
