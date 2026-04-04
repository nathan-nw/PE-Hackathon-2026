# PE Hackathon 2026

Monorepo layout:

| Path | Purpose |
|------|---------|
| [`tests/`](tests/) | Pytest suite (API unit tests, optional LB / NGINX integration) |
| [`url-shortener/`](url-shortener/) | Flask API, `uv run run.py` |
| [`load-balancer/`](load-balancer/) | NGINX config for API replicas |
| [`prometheus/`](prometheus/) | Prometheus scrape config (optional Compose service) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System diagram, health probes, production notes |
| [`dashboard/`](dashboard/) | Admin UI placeholder |
| [`user-frontend/`](user-frontend/) | Public UI placeholder |

**Local API:** see [`url-shortener/README.md`](url-shortener/README.md).

**Docker (Postgres + two API replicas + LB + static sites):**

From the repo root (folder that contains `docker-compose.yml`):

```bash
docker compose up -d --build
docker compose logs -f
```

**One command (same as `docker compose up -d --build`):** from repo root:

- **Windows (PowerShell or CMD):** `.\scripts\start.ps1` or `.\scripts\start.cmd` — do **not** use `./scripts/start.sh` in PowerShell; it will not run the stack.
- **Git Bash / WSL / macOS / Linux:** `./scripts/start.sh`

Use **`-d`** (detached) so Compose is not holding the stack in a foreground session (foreground `docker compose up` can be flaky on some Docker Desktop builds). Stop following logs with **Ctrl+C** — that does **not** stop the stack when you only ran `logs -f`.

**If a replica stays `Exited` after `docker kill`:** Docker Desktop on Windows often **does not** auto-restart even with `restart: always` — that is a known engine/Desktop limitation. Run **`docker compose up -d url-shortener-a url-shortener-b`** (or **`.\scripts\ensure-api-replicas.ps1`**) to reconcile; see [`ARCHITECTURE.md`](ARCHITECTURE.md) (section *If a replica stays Exited*).

**API via load balancer:** `http://localhost:8080` · **Prometheus UI:** `http://localhost:9090` (scrapes both API replicas) · **NGINX stub_status (LB-level):** `http://localhost:8081/nginx_status` (restricted to local/private ranges; not a substitute for app health checks) · Dashboard: `http://localhost:3001` · User UI: `http://localhost:3002`. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for probes (`/live`, `/ready`), metrics, and how the pieces fit together.

**If the terminal stays blank or seems to do nothing**

1. **Docker Engine must be running** — open Docker Desktop and wait until it says **Engine running**. Then run `docker info`. If that hangs or errors, Compose will too.
2. **First build can be quiet for a long time** (downloading layers). For step-by-step build output:  
   `docker compose build --progress=plain`  
   then  
   `docker compose up -d`
3. **Detached mode hides logs** — if you used `docker compose up -d`, the shell returns almost immediately. Follow logs with:  
   `docker compose logs -f`
4. **Windows (PowerShell)** — use `docker compose` (with a space). If an old `docker-compose.exe` shadows the plugin, prefer:  
   `& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up --build`
