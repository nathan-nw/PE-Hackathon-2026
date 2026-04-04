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

# Create non-root user for security and give ownership of app dir
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Run with gunicorn (no re-sync needed)
CMD ["uv", "run", "--no-sync", "gunicorn", "--config", "gunicorn.conf.py", "run:app"]
