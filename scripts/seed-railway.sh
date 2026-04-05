#!/usr/bin/env sh
# Seed production Postgres from url-shortener/csv_data (see seed-railway.ps1 for rationale).
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
POSTGRES_SERVICE="${RAILWAY_POSTGRES_SERVICE_NAME:-Postgres}"
DB_URL="$(railway variable list --service "$POSTGRES_SERVICE" --json | python -c "
import json, sys
d = json.load(sys.stdin)
u = (d.get('DATABASE_PUBLIC_URL') or '').strip() or (d.get('DATABASE_URL') or '').strip()
if not u:
    sys.stderr.write('No DATABASE_PUBLIC_URL or DATABASE_URL on Postgres service\n')
    sys.exit(1)
if 'sslmode=' not in u:
    u += ('&' if '?' in u else '?') + 'sslmode=require'
print(u)
")"
export DATABASE_URL="$DB_URL"
uv run --directory url-shortener python seed.py --merge
