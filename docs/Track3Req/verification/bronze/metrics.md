# 🥉 Bronze Tier Verification: Metrics Endpoint

**Objective:** Expose a dedicated `/metrics` endpoint that outputs raw infrastructure and application data (such as CPU, RAM, and HTTP request counts) specifically for automated scrapers.

### The Metrics Engine
While our structured logs are excellent for investigating *what* explicitly happened during an isolated request, continuous metrics are necessary for understanding *how much* is happening globally across the system at any given second.

We integrated the official Prometheus client library directly into our core `url-shortener` backend. It natively mounts a dedicated `/metrics` HTTP route that silently calculates and exposes real-time vital signs—including active CPU saturation, Memory/RAM footprints, active Database Connection pool states, and rolling 500 Error rates. 

This endpoint is explicitly built for machine-readability. Every 15 seconds, our internal Prometheus container actively scrapes this page to generate the baseline mathematical data required to feed our Discord alerting system.

### Endpoint Verification
Below is visual confirmation showing our backend's `/metrics` endpoint successfully projecting live telemetry.

![image (3)](https://github.com/user-attachments/assets/8cfe85ad-f640-48a9-93f9-aa38b6bf0917)

