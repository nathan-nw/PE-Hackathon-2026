# Testing Guide

This project uses **pytest** for testing. The suite lives at the **repository root** in **`tests/`** (not under `url-shortener/`) so you can add cross-service checks (API + load balancer today; other folders later). CI runs from the repo root.

## Running Tests

From the **repository root** (the folder that contains `pyproject.toml` and `docker-compose.yml`):

```bash
uv sync --group dev
uv run pytest

# Verbose
uv run pytest -v

# One file
uv run pytest tests/url_shortener/routes/test_health.py

# One test
uv run pytest tests/url_shortener/routes/test_health.py::test_health_endpoint

# API through NGINX (docker compose up first)
# PowerShell: $env:TEST_LOAD_BALANCER_URL = "http://127.0.0.1:8080"
# bash: export TEST_LOAD_BALANCER_URL=http://127.0.0.1:8080
uv run pytest tests/integration -m integration -v

# NGINX stub_status on :8081 (full URL including path)
# export TEST_NGINX_STUB_STATUS_URL=http://127.0.0.1:8081/nginx_status
uv run pytest tests/load_balancer -m integration -v

# Default CI: integration tests are skipped (env vars unset)

uv run pytest -k "product"
```

## How the Test Setup Works

The test fixtures in `tests/url_shortener/conftest.py` handle two key things:

1. **App creation** — creates a Flask app instance in testing mode
2. **Database swap** — replaces PostgreSQL with a **file-backed SQLite** database (under `tmp_path`) so Peewee pooling behaves consistently and tests never touch your dev Postgres

```python
# tests/url_shortener/conftest.py (simplified)

@pytest.fixture()
def app(tmp_path):
    application = create_app()
    application.config.update(TESTING=True)
    db_path = tmp_path / "test.db"
    db.initialize(SqliteDatabase(str(db_path), pragmas={"foreign_keys": 1}))
    db.connect(reuse_if_open=True)
    db.create_tables([User, Url, Event], safe=True)
    yield application
    db.close()

@pytest.fixture()
def client(app):
    return app.test_client()
```

Use `client` when testing routes/endpoints. Use `app` when you need the Flask app context directly.

## Where tests live (not inside `app/routes/`)

Keep **pytest under the repo root `tests/`**, not next to application modules under `app/routes/`. The Flask app code stays in **`url-shortener/`**; root **`pyproject.toml`** depends on that package in editable mode and sets `pythonpath` / coverage for `app`.

| Folder | Purpose |
|--------|---------|
| `tests/url_shortener/` | Fast tests using the Flask `test_client()` (SQLite via `conftest.py`) |
| `tests/integration/` | Optional HTTP tests against the API **via** the load balancer (`TEST_LOAD_BALANCER_URL`) |
| `tests/load_balancer/` | Optional checks against NGINX-only endpoints (e.g. `TEST_NGINX_STUB_STATUS_URL`) |

Integration tests use `@pytest.mark.integration` and are **skipped** unless the matching env vars are set. CI does not set them.

## Writing Tests

### Test File Naming

- Place all test files in `tests/`
- Name them `test_<feature>.py` — pytest auto-discovers files matching this pattern
- Name test functions `test_<what_it_tests>`

```
tests/
├── __init__.py
├── url_shortener/
│   ├── conftest.py             # SQLite test DB + client fixtures
│   └── routes/
│       ├── test_health.py
│       ├── test_metrics.py
│       └── test_urls.py
├── integration/
│   └── test_api_via_load_balancer.py   # TEST_LOAD_BALANCER_URL
└── load_balancer/
    └── test_nginx_stub_status.py       # TEST_NGINX_STUB_STATUS_URL
```

### Testing a Route / Endpoint

Use the `client` fixture to make HTTP requests and check the response.

```python
# tests/test_products.py

from app.models.product import Product


def test_list_products_empty(client, app):
    """Returns an empty list when no products exist."""
    with app.app_context():
        Product.create_table()

    response = client.get("/products")
    assert response.status_code == 200
    assert response.get_json() == []


def test_list_products(client, app):
    """Returns all products as JSON."""
    with app.app_context():
        Product.create_table()
        Product.create(name="Widget", category="Tools", price=9.99, stock=50)
        Product.create(name="Gadget", category="Tech", price=19.99, stock=30)

    response = client.get("/products")
    assert response.status_code == 200

    data = response.get_json()
    assert len(data) == 2
    assert data[0]["name"] == "Widget"
    assert data[1]["category"] == "Tech"


def test_product_not_found(client, app):
    """Returns 404 for a product that doesn't exist."""
    with app.app_context():
        Product.create_table()

    response = client.get("/products/999")
    assert response.status_code == 404
```

### Testing a Model

Test model logic directly without going through HTTP.

```python
# tests/test_product_model.py

import pytest
from peewee import IntegrityError

from app.models.product import Product


def test_create_product(app):
    """Can create a product with valid fields."""
    with app.app_context():
        Product.create_table()
        p = Product.create(name="Widget", category="Tools", price=9.99, stock=50)

        assert p.id is not None
        assert p.name == "Widget"


def test_product_query(app):
    """Can filter products by category."""
    with app.app_context():
        Product.create_table()
        Product.create(name="Widget", category="Tools", price=9.99, stock=50)
        Product.create(name="Gadget", category="Tech", price=19.99, stock=30)

        tools = Product.select().where(Product.category == "Tools")
        assert tools.count() == 1
        assert tools[0].name == "Widget"
```

### Testing CSV Loading

If you have a function that loads CSV data, test it with a temporary file.

```python
# tests/test_csv_loading.py

import csv
import tempfile
import os

from app.models.product import Product


def test_load_csv(app):
    """CSV loader correctly imports rows into the database."""
    with app.app_context():
        Product.create_table()

        # Create a temporary CSV file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["name", "category", "price", "stock"])
            writer.writeheader()
            writer.writerow({"name": "Widget", "category": "Tools", "price": "9.99", "stock": "50"})
            writer.writerow({"name": "Gadget", "category": "Tech", "price": "19.99", "stock": "30"})
            tmp_path = f.name

        try:
            # Import your CSV loading function and call it
            # from app.utils import load_csv
            # load_csv(tmp_path)

            # Then verify the data was loaded
            # assert Product.select().count() == 2
            pass
        finally:
            os.unlink(tmp_path)
```

### Testing Error Cases

Always test that your code handles bad input correctly.

```python
def test_create_product_missing_fields(client, app):
    """Returns 400 when required fields are missing."""
    with app.app_context():
        Product.create_table()

    response = client.post("/products", json={"name": "Widget"})
    assert response.status_code == 400


def test_invalid_json(client, app):
    """Returns 400 when request body is not valid JSON."""
    with app.app_context():
        Product.create_table()

    response = client.post(
        "/products",
        data="not json",
        content_type="application/json",
    )
    assert response.status_code == 400
```

## Shared Fixtures for Models

If many tests need database tables, add a fixture in `conftest.py` so you don't repeat `create_table()` everywhere.

```python
# tests/conftest.py — add this below the existing fixtures

from app.models.product import Product

@pytest.fixture(autouse=True)
def create_tables(app):
    """Create all model tables before each test, drop them after."""
    with app.app_context():
        Product.create_table()
        # Add more models here as you create them
        yield
        Product.drop_table()
```

With `autouse=True`, every test automatically gets fresh tables — no manual setup needed.

## Tips

- **One assert per concept** — a test can have multiple `assert` statements, but they should all verify the same behavior. If you're testing two different things, write two tests.
- **Test names are documentation** — `test_list_products_returns_empty_list_when_no_data` is better than `test_products_1`. When a test fails in CI, the name should tell you what broke.
- **Don't test the framework** — you don't need to test that Flask returns JSON or that Peewee saves to the database. Test *your* logic and *your* endpoints.
- **Keep tests independent** — each test should set up its own data. Don't rely on another test running first. The in-memory SQLite database is fresh for each test via the fixtures.
- **Run tests before pushing** — `uv run pytest -v` takes a few seconds and saves you from waiting for CI to tell you something is broken.
