#!/bin/sh
set -e
cd /app
/app/.venv/bin/python scripts/apply_migrations.py
exec "$@"
