# PE Hackathon 2026

Monorepo layout:

| Path | Purpose |
|------|---------|
| [`url-shortener/`](url-shortener/) | Flask API, tests, `uv run run.py` |
| [`load-balancer/`](load-balancer/) | NGINX config for API replicas |
| [`dashboard/`](dashboard/) | Admin UI placeholder |
| [`user-frontend/`](user-frontend/) | Public UI placeholder |

**Local API:** see [`url-shortener/README.md`](url-shortener/README.md).

**Docker (Postgres + two API replicas + LB + static sites):**

```bash
docker compose up --build
```

API via load balancer: `http://localhost:8080` · Dashboard: `http://localhost:3001` · User UI: `http://localhost:3002`
