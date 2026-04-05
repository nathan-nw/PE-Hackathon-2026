# 🥉 Bronze Tier Verification: Structured Logging

**Objective:** Configure explicit JSON logs including dedicated timestamps and log levels (INFO, WARN, ERROR), completely eliminating fragile `print` statements. Implement a manual way to view logs safely without needing to SSH directly into backend servers.

### The Structured JSON Engine
All native backend services leverage a customized Python logging engine instead of raw string arrays. In `url-shortener/app/logging_config.py`, the system forces all output (HTTP requests, database connectivity warnings, application errors) to serialize into perfectly structured **JSON payloads**. 

By natively spitting out JSON formatted logs, parsing aggregators across the cluster instantly recognize explicit metadata fields globally, such as `{"level": "ERROR"}` or `{"timestamp": "2026-04-05T09:30:15Z"}`.

### Viewing Logs Without SSH
Because the entire infrastructure is deployed using strict containerization logic (Docker), developers and admins actively avoid dangerous SSH workflows into the production VMs. Rather, everything writes safely to the standard output (`stdout`).
1. **Via CLI:** Simply running `docker compose logs url-shortener-a` natively streams the aggregated JSON payload of any service immediately to your safe terminal.
2. **Via UI:** The React Dashboard consumes this exact JSON stream via Kafka and displays a beautifully formatted log-view tab right in the browser!

### Log Verification
Below is a clear visual verification indicating that our backend containers strictly output structured JSON logic securely.

*(To capture the best screenshot for this requirement, let the app run and execute a few test calls in another tab, then run `docker compose logs url-shortener-a` to see a massive block of beautiful JSON!)*

*[Insert Screenshot Here]*
