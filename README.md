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
- PostgreSQL running locally (Docker Compose in this repo, or a local install)

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

# 2. Install dependencies
uv sync

# 3. PostgreSQL — pick one:

#    A) Docker (matches .env.example: postgres / postgres, DB hackathon_db)
#       Start Docker Desktop first, then:
docker compose up -d

#    B) Local PostgreSQL
#       Create the database and a user/password that match what you put in .env:
createdb hackathon_db   # macOS/Linux; on Windows use pgAdmin or: psql -U postgres -c "CREATE DATABASE hackathon_db;"

# 4. Configure environment
cp .env.example .env
# Edit .env so DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME, DATABASE_PORT match your server.

# 5. Run the server
uv run run.py

# 6. Verify
curl http://localhost:5000/health
# → {"status":"ok"}
```

On **Windows (PowerShell)** you can copy the env file with `Copy-Item .env.example .env` instead of `cp`.

### Troubleshooting

- **`FATAL: password authentication failed for user "postgres"`** — The values in `.env` do not match your PostgreSQL user and password. Update `DATABASE_USER` and `DATABASE_PASSWORD` (and `DATABASE_NAME` if needed), or use `docker compose up -d` with the stock `.env.example` (Docker maps Postgres to host port **15432** so it does not fight with a local install on **5432**).
- **`bind: ... Only one usage of each socket address`** — The host port in `docker-compose.yml` is already in use. Change the left side of `ports` (e.g. `"15432:5432"`) to a free port and set `DATABASE_PORT` in `.env` to match.
- **Docker: `open //./pipe/dockerDesktopLinuxEngine`** — Docker Desktop is not running. Start it, then run `docker compose up -d` again.
- **`/health` returns 500** — The app connects to PostgreSQL on every request. Fix the database connection (above) until `uv run run.py` can reach Postgres without errors.

## URL shortener API

This project includes a minimal JSON API: list/get/create short URLs, redirect by code, log events, and deactivate links. Seed CSVs live under `csv/` (`users.csv`, `urls.csv`, `events.csv`). Override the directory with env `SEED_CSV_DIR` if needed.

### Create the database and load seeds

1. Ensure PostgreSQL is running and `.env` matches your server (see Quick Start).
2. Install dependencies: `uv sync`
3. Create tables and import CSVs:

```bash
uv run python scripts/init_db.py
```

If data is already loaded, the script skips inserts unless you force a reload (this deletes existing rows in `users`, `urls`, and `events`):

```bash
uv run python scripts/init_db.py --force
```

### Start the app

```bash
uv run run.py
```

### Example `curl` commands

```bash
# Health
curl http://127.0.0.1:5000/health

# List URLs (?active=true|false, ?user_id=…)
curl "http://127.0.0.1:5000/urls?active=true"

# One URL by id
curl http://127.0.0.1:5000/urls/1

# Create a short URL (defaults to the lowest user id if user_id is omitted)
curl -X POST http://127.0.0.1:5000/urls -H "Content-Type: application/json" \
  -d "{\"original_url\":\"https://example.com\",\"user_id\":1}"

# Redirect by short code (302 to original_url)
curl -I http://127.0.0.1:5000/r/WqxP6K

# Deactivate
curl -X PATCH http://127.0.0.1:5000/urls/1/deactivate

# Events (?url_id=…, ?event_type=…, ?limit=…)
curl "http://127.0.0.1:5000/events?event_type=clicked&limit=10"
```

## Project Structure

```
mlh-pe-hackathon/
├── app/
│   ├── __init__.py          # App factory (create_app)
│   ├── database.py          # DatabaseProxy, BaseModel, connection hooks
│   ├── helpers.py           # URL validation, short code generation
│   ├── seed.py              # create_tables + CSV seeding
│   ├── models/
│   │   ├── user.py
│   │   ├── url.py
│   │   ├── event.py
│   │   └── __init__.py
│   └── routes/
│       ├── urls.py          # /urls CRUD + deactivate
│       ├── redirect.py      # GET /r/<short_code>
│       ├── events.py        # GET /events
│       └── __init__.py      # register_routes()
├── csv/                     # Seed CSVs (users, urls, events)
├── scripts/
│   └── init_db.py           # CLI: create tables + seed
├── .env.example             # DB connection template
├── .gitignore               # Python + uv gitignore
├── .python-version          # Pin Python version for uv
├── pyproject.toml           # Project metadata + dependencies
├── run.py                   # Entry point: uv run run.py
└── README.md
```

## How to Add a Model

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

1. Create a blueprint in `app/routes/`, e.g. `app/routes/products.py`:

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
