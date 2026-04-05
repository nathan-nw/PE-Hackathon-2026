# Contributing

## Branching Strategy

This project uses a two-branch deployment model:

```
feature branches → staging → main
```

| Branch    | Purpose                          | Deploys to  |
|-----------|----------------------------------|-------------|
| `main`    | Production-ready code            | Production  |
| `staging` | Pre-production testing & QA      | Staging     |
| `feature/*` | Individual work (any prefix ok) | —           |

### Workflow

1. **Create a feature branch** from `staging`:
   ```bash
   git checkout staging
   git pull origin staging
   git checkout -b feature/my-feature
   ```

2. **Do your work** — commit early and often.

3. **Open a pull request** into `staging`:
   - CI (linting + tests) runs automatically.
   - At least one approval is required.
   - All status checks must pass before merging.

4. **Merge into staging** — this triggers a deployment to the staging environment.

5. **Test in staging** — verify everything works in a production-like environment.

6. **Promote to production** — open a PR from `staging` into `main`. After review and merge, production deployment triggers automatically.

### Rules

- Never push directly to `main` or `staging` — always use pull requests.
- Keep feature branches short-lived. 
- Rebase or merge from `staging` regularly to avoid large conflicts.

## Development Setup

The Flask API lives under **`url-shortener/`**. The **pytest suite** lives at the **repository root** in **`tests/`** (alongside root `pyproject.toml`) so integration tests can cover the load balancer and other services as you add them.

**API + lint (from `url-shortener/`):**

```bash
cd url-shortener
uv sync --group dev
uv run run.py
uv run ruff check .
uv run ruff format --check .
uv run ruff check --fix .
uv run ruff format .
```

**Tests (from the repo root):**

```bash
uv sync --group dev
uv run pytest -v
```

## Pull Request Checklist

- [ ] Code passes `ruff check .` and `ruff format --check .`
- [ ] Tests pass from the repo root (`uv sync --group dev` then `uv run pytest -v`)
- [ ] New features include tests
- [ ] PR targets the correct branch (`staging` for features, `main` for releases)
