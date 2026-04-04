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

From the repo root (folder that contains `docker-compose.yml`):

```bash
docker compose up --build
```

Leave this running: logs from every service should scroll in that terminal. API via load balancer: `http://localhost:8080` · Dashboard: `http://localhost:3001` · User UI: `http://localhost:3002`

**If the terminal stays blank or seems to do nothing**

1. **Docker Engine must be running** — open Docker Desktop and wait until it says **Engine running**. Then run `docker info`. If that hangs or errors, Compose will too.
2. **First build can be quiet for a long time** (downloading layers). For step-by-step build output:  
   `docker compose build --progress=plain`  
   then  
   `docker compose up`
3. **Detached mode hides logs** — if you used `docker compose up -d`, the shell returns almost immediately. Follow logs with:  
   `docker compose logs -f`
4. **Windows (PowerShell)** — use `docker compose` (with a space). If an old `docker-compose.exe` shadows the plugin, prefer:  
   `& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up --build`
