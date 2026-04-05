# Alert Rules & Fatigue Prevention

Prometheus is configured with custom thresholds that define exactly when your phone should go "Bing!".

## The Alert Matrix
Alerts are split into **Critical** (humans must wake up and fix immediately) and **Warning** (investigate next morning during business hours).

- **ServiceDown** (Critical): All url-shortener instances unreachable.
- **APITargetDown** (Critical): Single instance unreachable.
- **HighErrorRate** (Critical): >10% of requests returning 5xx.
- **HighLatencyP99** (Warning): The p99 latency spikes above 2 seconds.

## Minimizing Alert Fatigue
We don't want engineers getting spammed out of nowhere, so we built strong defenses:
- **Grouping:** Related alerts are bundled together so you get 1 notification, not a flood.
- **Group Wait:** The system waits 10s to collect related issues before sending the very first ping.
- **Smart Thresholds:** `HighErrorRate` looks at a 10% ratio instead of raw query counts so low-traffic hours don't accidentally trigger false positives.
- **Resolved Notifications:** Alertmanager sends green "RESOLVED" messages when an incident naturally or manually ends, so the team knows the bleeding has officially stopped.
