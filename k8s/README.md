# Kubernetes (reference manifests)

These files illustrate **autoscaling**, **Service**, **Ingress (TLS + HSTS via controller)**, and **probes** aligned with `ARCHITECTURE.md`. They are **not** wired to CI; adapt images, resources, and database connectivity for your cluster.

## Apply

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap-url-shortener.yaml
kubectl apply -f k8s/deployment-url-shortener.yaml
kubectl apply -f k8s/service-url-shortener.yaml
kubectl apply -f k8s/hpa-url-shortener.yaml
kubectl apply -f k8s/ingress-url-shortener.yaml
```

## Before production

- Build and push **`url-shortener`** to a registry; set `image:` to that reference (prefer **digest**).
- Replace **`DATABASE_PASSWORD`** with a **`Secret`** (`env.valueFrom.secretKeyRef`) — do not commit real credentials.
- Set **`DATABASE_HOST`** in the ConfigMap (or Secret) to your managed Postgres endpoint.
- Install an **Ingress controller** and optionally **cert-manager** for real TLS certificates; ingress annotations vary by controller.
- Tune **HPA** `minReplicas` / `maxReplicas` and **resource requests/limits** using measured CPU/memory from production-like load tests.

## INSTANCE_ID

The Deployment example sets **`INSTANCE_ID`** from **`metadata.name`** (unique per pod). If you prefer numeric ids, use a **StatefulSet** or an **init container** / **downward API** pattern that fits your metrics cardinality policy.
