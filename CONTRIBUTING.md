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

The repo tracks `uv.lock` for reproducible installs (CI uses `uv sync --group dev --frozen`). After changing dependencies in `pyproject.toml`, run `uv lock` and commit the updated lockfile.

```bash
# Install dependencies (including dev tools)
uv sync --group dev

# Run the app
uv run run.py

# Run linting
uv run ruff check .
uv run ruff format --check .

# Auto-fix lint issues
uv run ruff check --fix .
uv run ruff format .

# Run tests
uv run pytest -v
```

## Continuous Integration

GitHub Actions workflow **CI** (`.github/workflows/ci.yml`) runs on pushes and pull requests to `main` and `staging`, and can be run manually (**Actions** → **CI** → **Run workflow**). It:

- runs **Ruff** (`check` + `format --check`)
- **bytecode-compiles** `app/`, `run.py`, `scripts/`, and `tests/` (catches syntax errors)
- runs **pytest** against a **PostgreSQL 16** service (matches production-like DB; sets `CI=true` for the test harness)

Dependabot (`.github/dependabot.yml`) opens weekly update PRs for **GitHub Actions** and **uv** dependencies.

## Pull Request Checklist

- [ ] Code passes `ruff check .` and `ruff format --check .`
- [ ] Tests pass (`uv run pytest -v`)
- [ ] New features include tests
- [ ] PR targets the correct branch (`staging` for features, `main` for releases)
