# Notification Pipeline Overview

The notification system acts as the digital nervous system for the application, designed to give engineers instant, actionable feedback during incidents without needing to manually comb through raw logs. 

When a critical threshold is breached—such as a container crashing or the error rate spiking above normal limits—Prometheus triggers a targeted alert to the Alertmanager. The Alertmanager immediately forwards a webhook payload to our custom backend integration service. This service instantly parses the alert data and pushes a richly formatted, color-coded embed (Red for Critical, Yellow for Warnings) directly into the engineering team's designated Discord channel. It displays exactly which service failed, the time of the incident, and a descriptive summary of the problem.

**Live Demo:** If you intentionally break the app during a demonstration (for example, by forcing the database offline via `docker stop`), within moments your phone or laptop will go *"Bing!"*, instantly delivering a detailed Discord notification outlining exactly what failed.
