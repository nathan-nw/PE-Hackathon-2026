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

# DB migrations at container start (avoids Railway preDeployCommand schema/UI merge issues).
RUN chmod +x /app/docker-entrypoint.sh

# Non-root user must own /app: `uv run` at container start syncs the env (and can pull dev groups),
# which writes under .venv and fails with "Permission denied" if .venv is root-only.
RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

# Invoke via `sh` so CRLF in the script (Windows checkouts) does not break the shebang path.
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]

# Avoid uv mutating the environment at runtime (no sync → no dev installs into site-packages).
ENV UV_NO_SYNC=1
ENV GUNICORN_WORKERS=2

EXPOSE 5000
ENV PORT=5000

# Liveness only — do not use /ready here (DB can be briefly unavailable without killing the container).
HEALTHCHECK --interval=15s --timeout=3s --start-period=90s --retries=3 \
    CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-5000}/live" || exit 1'

# Run gunicorn from the synced venv directly (no `uv run` → no implicit sync in prod).
CMD ["/app/.venv/bin/gunicorn", "--config", "gunicorn.conf.py", "run:app"]
