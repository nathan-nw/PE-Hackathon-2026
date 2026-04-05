# 🥈 Silver Tier Verification: 50% Coverage

**Objective:** Use `pytest-cov` to ensure at least half of the code lines are hit by tests, creating a fortress against shipping broken backend logic.

### Codebase Integration
We strictly enforce code coverage using the `pytest-cov` plugin. The configuration is baked directly into the root `pyproject.toml` configuration file:

```toml
[tool.pytest.ini_options]
addopts = "-v --cov=url-shortener/app --cov=dashboard/backend --cov-report=term-missing"
```

Because of this `addopts` configuration, every single time `pytest` is invoked (either locally or in our CI), it automatically calculates line coverage across both the `url-shortener/app` backend and the `dashboard/backend`. It also prints a `term-missing` report detailing exactly which lines of code remain untested.

### Coverage Verification
Below is the visual verification of our test suite hitting the >50% coverage benchmark. 

*(To capture your screenshot: open the terminal at the root of the repo and run `uv run pytest`. This evaluates the entire test suite, not just one file, and will automatically produce the complete `coverage` block at the bottom of the terminal output!)*

*[Insert Screenshot Here]*
