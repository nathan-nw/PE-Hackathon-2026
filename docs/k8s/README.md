# Kubernetes (full stack)

This directory mirrors **`docker-compose.yml`**: Postgres, two API replicas (`url-shortener-a` / `url-shortener-b`), NGINX load balancer, Prometheus (pod discovery for `/metrics`), Alertmanager, scheduled DB dumps, and static **dashboard** / **user-frontend** services.

Apply everything with **Kustomize**:

```bash
# From the repo root — build images your cluster can pull (see below), then:
kubectl apply -k k8s/
```

**One command (build + apply):** PowerShell: `.\scripts\start.ps1 -Target k8s` · CMD: `.\scripts\start.cmd k8s` · bash: `./scripts/start.sh k8s` (on Windows do not use the `.sh` script from PowerShell).

## Build images (local cluster)

Use the same Dockerfiles as Compose. Tag them so they match `kustomization.yaml` (`pe-hackathon/...`):

```bash
docker build -t pe-hackathon/url-shortener:latest ./url-shortener
docker build -t pe-hackathon/load-balancer:latest ./load-balancer
docker build -t pe-hackathon/dashboard:latest ./dashboard
docker build -t pe-hackathon/user-frontend:latest ./user-frontend
```

**Docker Desktop Kubernetes:** load local images into the cluster:

```bash
# If your setup supports it — otherwise push to a registry and set kustomize images.
```

**kind:**

```bash
kind load docker-image pe-hackathon/url-shortener:latest
kind load docker-image pe-hackathon/load-balancer:latest
kind load docker-image pe-hackathon/dashboard:latest
kind load docker-image pe-hackathon/user-frontend:latest
```

**Remote cluster:** push to your registry and edit `k8s/kustomization.yaml` `images:` `newName` / `newTag` (or use `kubectl set image` after deploy).

## Access (NodePorts)

Services use **NodePort** for a similar layout to Compose (replace `<node-ip>` with `localhost` on Docker Desktop / single-node clusters):

| Service | NodePort | Role |
|---------|----------|------|
| `load-balancer` | 30880 (HTTP), 30881 (`/nginx_status`) | API via NGINX |
| `prometheus` | 30990 | Prometheus UI |
| `alertmanager` | 30993 | Alertmanager UI |
| `dashboard` | 30001 | Admin placeholder |
| `user-frontend` | 30002 | Public placeholder |

Example:

```bash
curl "http://<node-ip>:30880/health"
```

Postgres is **ClusterIP only** (`db:5432` inside the namespace). Use `kubectl port-forward -n pe-hackathon svc/db 15432:5432` if you need host access.

## Secrets and production

- **`postgres-secret`** — default password is dev-only; replace with a sealed secret or external store.
- **Optional Ingress** — `ingress-url-shortener.yaml` routes to **`load-balancer:80`** (not directly to the API). Apply separately if you have an ingress controller and TLS secrets.

## Horizontal Pod Autoscaler

`hpa-url-shortener-a.yaml` and `hpa-url-shortener-b.yaml` require **metrics-server**:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# On local clusters you may need to add kubelet TLS flags — see metrics-server docs.
```

If metrics are unavailable, remove the two HPA manifests from `kustomization.yaml` or expect `UNKNOWN` status.

## Migrations

The API image does not automatically run SQL migrations. Run **`url-shortener/scripts/apply_migrations.py`** (or your process) against `db` after Postgres is up, same as any non-Compose environment.

## Layout

| File | Purpose |
|------|---------|
| `postgres-*.yaml` | Secret, StatefulSet + PVC, Service `db` |
| `deployment-url-shortener-*.yaml` | API replicas with `INSTANCE_ID` 1 and 2 |
| `deployment-load-balancer.yaml` | NGINX (`load-balancer/` image; upstreams `url-shortener-a/b`) |
| `configmap-prometheus.yaml` | Scrapes API pods via **Kubernetes SD** (works when HPA scales replicas) |
| `rbac-prometheus.yaml` | Lets Prometheus list/watch pods in `pe-hackathon` |
| `cronjob-db-backup.yaml` + `pvc-backups.yaml` | Nightly `pg_dump` with 7-day retention |
| `ingress-url-shortener.yaml` | Optional TLS ingress to the NGINX Service |
