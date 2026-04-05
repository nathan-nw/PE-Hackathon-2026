# Configuration File Map

Below is a map of the critical files that govern the alerting logic throughout the repository.

## Prometheus & Alertmanager
- **`prometheus/rules/slo.yml`**: Defines the core PromQL expressions, thresholds, and duration evaluations for alerts like `HighErrorRate`.
- **`alertmanager/alertmanager.yml`**: Controls alert routing, grouping wait times, and formatting before sending to our backend integration webhook.

## Backend Integration
- **`dashboard/backend/discord_alerter.py`**: The crucial Python script responsible for formatting raw Alertmanager JSON payloads into the beautiful color-coded Discord embeds.
- **`dashboard/backend/main.py`**: Exposes the `/api/alertmanager-webhook` endpoint that safely catches the POST requests from Alertmanager.

## Kubernetes Equivalents
- **`k8s/configmap-prometheus.yaml`** & **`k8s/configmap-alertmanager.yaml`**: Explicitly store the alerting config maps injected into the deployment clusters for production stability.
