# Testing Guide

This project uses **pytest** for testing. Tests live in the `tests/` directory and run automatically in CI on every pull request.

## Running Tests

```bash
# Run all tests
uv run pytest

# Run with verbose output (see each test name)
uv run pytest -v

# Run a specific test file
uv run pytest tests/test_health.py

# Run a specific test function
uv run pytest tests/test_health.py::test_health_endpoint

# Run tests matching a keyword
uv run pytest -k "product"
```

## How the Test Setup Works

The test fixtures in `tests/conftest.py` handle two key things:

1. **App creation** — creates a Flask app instance in testing mode
2. **Database swap** — replaces PostgreSQL with an **in-memory SQLite** database so tests run fast and don't need a running database server

```python
# tests/conftest.py (already set up)

@pytest.fixture()
def app():
    test_db = SqliteDatabase(":memory:")
    app = create_app()
    app.config.update({"TESTING": True})
    db.initialize(test_db)
    test_db.connect()
    yield app
    test_db.close()

@pytest.fixture()
def client(app):
    return app.test_client()
```

Use `client` when testing routes/endpoints. Use `app` when you need the Flask app context directly.

## Writing Tests

### Test File Naming

- Place all test files in `tests/`
- Name them `test_<feature>.py` — pytest auto-discovers files matching this pattern
- Name test functions `test_<what_it_tests>`

```
tests/
├── __init__.py
├── conftest.py            # Shared fixtures
├── test_health.py         # Health endpoint tests
├── test_products.py       # Product route tests
└── test_csv_loading.py    # CSV import tests
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
