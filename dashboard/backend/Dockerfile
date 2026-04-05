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

# Railway sets PORT at runtime (sync script pins 8080 to match url-shortener / variable references).
EXPOSE 8080
ENV PORT=8080

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
