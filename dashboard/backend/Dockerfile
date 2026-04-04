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

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
