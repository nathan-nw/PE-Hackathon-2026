### Sherlock Mode — Incident Diagnosis Walkthrough

> **Scenario:** During a Gold chaos test (500 VUs), the Error Monitor spiked to 40%+ error rate.

**Step 1: Detect** — Discord alert fires: `High5xxRate` from Alertmanager + per-request 5xx alerts from Kafka consumer. Error Monitor graph shows sharp spike.

**Step 2: Triage (Errors Tab)** — Status breakdown reveals mix of 429 (rate limit) and 500 (server error). 429s are expected under chaos load; 500s indicate a real problem.

**Step 3: Correlate (Telemetry Tab)**
- **Traffic**: Confirms VU ramp — request rate jumped from ~50/s to ~1400/s
- **Latency**: p99 climbed from 50ms to 2.6s — DB connection pool saturating
- **Saturation**: CPU spiked to 85% on both instances, thread count maxed out

**Step 4: Drill Down (Logs Tab)** — Filter `level=ERROR`, `instance_id=url-shortener-a`. Log entries show `peewee.OperationalError: connection pool exhausted` — confirms DB saturation as root cause.

**Step 5: Resolve** — Remediation options from runbooks (see `DOCUMENTATION.md → Runbooks`):
- Short-term: Increase `DB_MAX_CONNECTIONS`, restart affected containers
- Long-term: Redis caching (already implemented) reduces DB load by 60-80%

**Step 6: Verify** — After fix, Golden Signals show latency returning to baseline, error rate dropping to 0%, saturation normalizing. Alertmanager sends "resolved" notification to Discord.