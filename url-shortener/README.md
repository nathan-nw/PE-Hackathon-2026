# MLH PE Hackathon — Flask + Peewee + PostgreSQL Template

A minimal hackathon starter template. You get the scaffolding and database wiring — you build the models, routes, and CSV loading logic.

**Stack:** Flask · Peewee ORM · PostgreSQL · uv

## **Important**

You need to work with around the seed files that you can find in [MLH PE Hackathon](https://mlh-pe-hackathon.com) platform. This will help you build the schema for the database and have some data to do some testing and submit your project for judging. If you need help with this, reach out on Discord or on the Q&A tab on the platform.

## Prerequisites

- **uv** — a fast Python package manager that handles Python versions, virtual environments, and dependencies automatically.
  Install it with:
  ```bash
  # macOS / Linux
  curl -LsSf https://astral.sh/uv/install.sh | sh

  # Windows (PowerShell)
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```
  For other methods see the [uv installation docs](https://docs.astral.sh/uv/getting-started/installation/).
- PostgreSQL running locally (you can use Docker or a local instance)

## uv Basics

`uv` manages your Python version, virtual environment, and dependencies automatically — no manual `python -m venv` needed.

| Command | What it does |
|---------|--------------|
| `uv sync` | Install all dependencies (creates `.venv` automatically) |
| `uv run <script>` | Run a script using the project's virtual environment |
| `uv add <package>` | Add a new dependency |
| `uv remove <package>` | Remove a dependency |

## Quick Start

```bash
# 1. Clone the repo
git clone <repo-url> && cd mlh-pe-hackathon

# 2. API service (Flask app)
cd url-shortener
uv sync

# 3. Create the database
createdb hackathon_db

# 4. Configure environment
cp .env.example .env   # edit if your DB credentials differ

# 5. Run the server
uv run run.py

# 6. Verify
curl http://localhost:5000/health
```

**Full stack with Docker** (Postgres, two API replicas, NGINX load balancer, dashboard, user frontend):

```bash
docker compose up --build
# API via LB:        http://localhost:8080/health
# Liveness / ready:  GET http://localhost:8080/live   GET http://localhost:8080/ready
# Prometheus UI:     http://localhost:9090  (scrapes replicas directly on the Docker network)
# NGINX stub_status: http://localhost:8081/nginx_status  (LB-level; allow rules in load-balancer/nginx.conf)
# Per-replica metrics: GET http://localhost:8080/metrics  (Prometheus; per Gunicorn worker unless multiprocess mode)
# Dashboard:         http://localhost:3001/
# User UI:           http://localhost:3002/
# Postgres:          localhost:15432
```

**Prometheus `GET /metrics`:** the app exposes standard Prometheus text (including `http_requests_total` with an **`instance_id`** label, plus `app_instance` info). With **multiple Gunicorn workers**, each worker has its own in-memory registry unless you configure Prometheus **multiprocess** mode (`PROMETHEUS_MULTIPROC_DIR` plus Gunicorn hooks); behind the NGINX load balancer, each replica has its own `/metrics` as well.

**Replica label:** set **`INSTANCE_ID`** (e.g. `1`, `2`, …) in the environment. Docker Compose sets `INSTANCE_ID` for `url-shortener-a` / `url-shortener-b`. The web UI (`/`) shows a small **instance HUD** (top-right) fed by **`GET /api/instance-stats`** (CPU%, RSS memory, rolling average request latency, uptime, request count, thread count; load average on Linux).

**Autoscaling:** Docker Compose can **scale replicas statically** (e.g. duplicate services or `docker compose up --scale …` if you model workers that way), but it does **not** scale automatically from CPU or queue depth. For **demand-based autoscaling**, use a platform that supports it (e.g. **Kubernetes Horizontal Pod Autoscaler**, AWS ECS/Application Auto Scaling, Google Cloud Run, Railway, etc.) and point it at health/metrics from your app.

## Testing

Pytest is configured at the **repository root** (not inside this folder): see root `pyproject.toml` and **`tests/`**. From the repo root:

```bash
uv sync --group dev
uv run pytest
```

That prints a **coverage summary** for the `app/` package. No PostgreSQL is required for unit-style tests: fixtures swap in **SQLite**. Optional integration tests hit the real load balancer when you set `TEST_LOAD_BALANCER_URL`; see [`TESTING.md`](../TESTING.md).

Faster feedback (no coverage):

```bash
uv run pytest --no-cov
```

**GitHub Actions:** `.github/workflows/tests.yml` runs `uv sync --group dev` and `uv run pytest` from the repo root.

## Project Structure

```
mlh-pe-hackathon/
├── tests/                   # Pytest (repo root; see ../TESTING.md)
├── url-shortener/           # Flask API (Peewee + PostgreSQL)
│   ├── app/
│   │   ├── __init__.py      # App factory (create_app)
│   │   ├── database.py      # DatabaseProxy, BaseModel, connection hooks
│   │   ├── models/
│   │   └── routes/
│   ├── csv_data/            # Seed CSVs
│   ├── pyproject.toml
│   ├── run.py               # uv run run.py
│   └── .env.example
├── load-balancer/           # NGINX config → upstream API replicas
├── dashboard/               # Admin / ops UI (static placeholder; add a framework as needed)
├── user-frontend/           # Public shortening UI (static placeholder)
├── docker-compose.yml       # db + API replicas + LB + frontends
├── pyproject.toml           # Monorepo dev + pytest (depends on url-shortener)
├── .gitignore
└── README.md
```

## How to Add a Model

Work inside **`url-shortener/`** (all paths below are relative to that folder).

1. Create a file in `app/models/`, e.g. `app/models/product.py`:

```python
from peewee import CharField, DecimalField, IntegerField

from app.database import BaseModel


class Product(BaseModel):
    name = CharField()
    category = CharField()
    price = DecimalField(decimal_places=2)
    stock = IntegerField()
```

2. Import it in `app/models/__init__.py`:

```python
from app.models.product import Product
```

3. Create the table (run once in a Python shell or a setup script):

```python
from app.database import db
from app.models.product import Product

db.create_tables([Product])
```

## How to Add Routes

1. From `url-shortener/`, create a blueprint in `app/routes/`, e.g. `app/routes/products.py`:

```python
from flask import Blueprint, jsonify
from playhouse.shortcuts import model_to_dict

from app.models.product import Product

products_bp = Blueprint("products", __name__)


@products_bp.route("/products")
def list_products():
    products = Product.select()
    return jsonify([model_to_dict(p) for p in products])
```

2. Register it in `app/routes/__init__.py`:

```python
def register_routes(app):
    from app.routes.products import products_bp
    app.register_blueprint(products_bp)
```

## How to Load CSV Data

```python
import csv
from peewee import chunked
from app.database import db
from app.models.product import Product

def load_csv(filepath):
    with open(filepath, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    with db.atomic():
        for batch in chunked(rows, 100):
            Product.insert_many(batch).execute()
```

## Useful Peewee Patterns

```python
from peewee import fn
from playhouse.shortcuts import model_to_dict

# Select all
products = Product.select()

# Filter
cheap = Product.select().where(Product.price < 10)

# Get by ID
p = Product.get_by_id(1)

# Create
Product.create(name="Widget", category="Tools", price=9.99, stock=50)

# Convert to dict (great for JSON responses)
model_to_dict(p)

# Aggregations
avg_price = Product.select(fn.AVG(Product.price)).scalar()
total = Product.select(fn.SUM(Product.stock)).scalar()

# Group by
from peewee import fn
query = (Product
         .select(Product.category, fn.COUNT(Product.id).alias("count"))
         .group_by(Product.category))
```

## Tips

- Use `model_to_dict` from `playhouse.shortcuts` to convert model instances to dictionaries for JSON responses.
- Wrap bulk inserts in `db.atomic()` for transactional safety and performance.
- The template uses `teardown_appcontext` for connection cleanup, so connections are closed even when requests fail.
- Check `.env.example` for all available configuration options.
