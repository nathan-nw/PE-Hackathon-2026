# 🥈 Silver Tier Verification: Alert Configuration

**Objective:** Wake up the on-call engineer by explicitly configuring strict alerts for "Service Down" and "High Error Rate" that successfully fire within 5 minutes of a critical failure.

### Alerting Rules & Fatigue Prevention
To protect against alert fatigue, our system is strictly configured to minimize noise. We don't alert on isolated blips; we only alert when a human absolutely *must* wake up and fix a bleeding system. 

We established strict analytical rules in our Prometheus configuration (`slo.yml`) specifically targeting fatal infrastructure barriers:
- **Service Down (Critical):** Triggers if all routing instances completely crash or lose network connectivity.
- **High Error Rate (Critical):** Triggers if the backend 5xx error rate spikes above a 10% threshold.

Rather than panicking on a single 500 error, these triggers evaluate queries mathematically over a strict 2-minute time window. If the anomaly sustains itself beyond acceptable buffers, it automatically routes an emergency webhook directly into our dedicated integration pipeline.

### Configuration Verification
Below is a screenshot verifying our specific `YAML` code configurations for the Service Down and High Error Rate logic.

<img width="1130" height="793" alt="Screenshot 2026-04-05 at 10 36 43 AM" src="https://github.com/user-attachments/assets/e6714025-8264-4c61-8254-dd83c7ab1730" />
