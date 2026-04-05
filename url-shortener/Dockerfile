FROM python:3.13-slim

# Install system dependencies for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files first (better Docker layer caching)
COPY pyproject.toml uv.lock* ./

# Install dependencies (as root, before switching user)
RUN uv sync --no-dev --frozen || uv sync --no-dev

# Copy application code
COPY . .

# Non-root user must own /app: `uv run` at container start syncs the env (and can pull dev groups),
# which writes under .venv and fails with "Permission denied" if .venv is root-only.
RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

# Avoid uv mutating the environment at runtime (no sync → no dev installs into site-packages).
ENV UV_NO_SYNC=1

EXPOSE 5000

# Liveness only — do not use /ready here (DB can be briefly unavailable without killing the container).
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:5000/live || exit 1

# Run gunicorn from the synced venv directly (no `uv run` → no implicit sync in prod).
CMD ["/app/.venv/bin/gunicorn", "--config", "gunicorn.conf.py", "run:app"]
