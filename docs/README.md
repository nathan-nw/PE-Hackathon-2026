# Dashboard (Next.js)

Operations visibility UI: **Docker** (Compose project filter) or **Railway** (GraphQL — no Docker socket in the cloud), optional Kubernetes pods, Alertmanager alerts, **Kafka-backed app logs** (via `dashboard-backend`), and links to Prometheus and Alertmanager.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For Docker or cluster APIs you need matching access on the host (see below).

## Docker image

Telemetry deep links (`NEXT_PUBLIC_*`) are embedded at **build** time. Defaults target services published on the host (e.g. Prometheus at `http://localhost:9090`). Override build args when building the image:

```bash
docker build \
  --build-arg NEXT_PUBLIC_PROMETHEUS_URL=http://localhost:9090 \
  --build-arg NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL=http://localhost:9093 \
  -t dashboard .
```

## Visibility environment variables

| Variable | Purpose |
|----------|---------|
| `VISIBILITY_COMPOSE_PROJECT` | Compose project label filter (default `pe-hackathon-2026`). |
| `DOCKER_SOCKET_PATH` | Docker Engine socket (default `/var/run/docker.sock`). |
| `VISIBILITY_K8S_ENABLED` | Set to `true` to list pods (requires valid kubeconfig). |
| `VISIBILITY_K8S_NAMESPACE` | Namespace for pod list (default `pe-hackathon`). |
| `KUBECONFIG` | Path to kubeconfig **inside** the container (Compose sets `/kube/config`). |
| `KUBECONFIG_HOST` | (Compose only, optional) Host path bind-mounted to `/kube/config`; defaults to `~/.kube/config`. |
| `VISIBILITY_ALERTMANAGER_URL` | Server-side URL for Alertmanager API (e.g. `http://alertmanager:9093` on Compose network). |
| `VISIBILITY_PROMETHEUS_URL` | Reserved for future server-side PromQL; UI uses `NEXT_PUBLIC_PROMETHEUS_URL` for browser links. |
| `NEXT_PUBLIC_PROMETHEUS_URL` | Browser link base for Prometheus (baked at build). |
| `NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL` | Browser link base for Alertmanager UI (baked at build). |
| `DASHBOARD_BACKEND_URL` | FastAPI service that caches Kafka logs (`http://dashboard-backend:8000` in Compose; `http://127.0.0.1:8000` for `next dev` when the backend is published on the host). |
| `RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` | When both are set, the Ops tab uses the Railway GraphQL API instead of Docker (required on Railway hosting). |
| `RAILWAY_PROJECT_TOKEN` or `RAILWAY_API_TOKEN` | Token for that API ([project token](https://docs.railway.com/reference/public-api#project-token) or account token). **Server-side only** — never `NEXT_PUBLIC_*`. |
| `VISIBILITY_ALERTMANAGER_DISABLED` | Set to `1` when Alertmanager is not deployed (e.g. hosted Railway); the Alerts tab returns an empty list without erroring. |

## Kafka logs (Logs tab)

Flask replicas publish JSON logs to Kafka (`app-logs`); **`dashboard-backend`** (FastAPI) consumes them into an in-memory ring buffer and optional PostgreSQL (`dashboard-db`). The Next.js app proxies `/api/logs` and `/api/logs/stats` to that backend.

From the **Containers** tab, use **Instance 1 / 2** on `url-shortener-a` / `url-shortener-b` rows to jump to the **Logs** tab filtered by `instance_id`. The Logs tab supports level and text filters, pause/resume polling, and per-instance aggregate chips.

## Security

Mounting the Docker socket gives the dashboard container **full control of the host Docker engine**. Use only on trusted networks (local / hackathon). **Do not** expose this dashboard to the public internet with the socket mounted.

## Kubernetes (pods tab)

**Docker Compose (`dashboard` service):** `docker-compose.yml` mounts your host kubeconfig at `/kube/config`, sets `KUBECONFIG=/kube/config`, and `VISIBILITY_K8S_ENABLED=true`. Ensure `~/.kube/config` exists (or set **`KUBECONFIG_HOST`** in a repo-root `.env` file to an absolute path, e.g. `KUBECONFIG_HOST=C:/Users/YourName/.kube/config` on Windows if the default bind fails).

**`next dev` on the host:** copy `.env.local` from the snippet below so the API routes can reach your cluster:

```bash
VISIBILITY_K8S_ENABLED=true
VISIBILITY_K8S_NAMESPACE=pe-hackathon
KUBECONFIG=C:\Users\YourName\.kube\config
```

Use your real kubeconfig path; forward slashes are fine on Windows.

When disabled or the API is unreachable, the Pods tab shows an empty state and a short message.
