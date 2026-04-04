FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir -r /dev/stdin <<EOF
fastapi>=0.115
uvicorn>=0.34
confluent-kafka>=2.3
psycopg2-binary>=2.9
EOF

WORKDIR /app
COPY . .

# Railway (and others) set PORT at runtime; the proxy healthchecks this port.
EXPOSE 8000
ENV PORT=8000

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
