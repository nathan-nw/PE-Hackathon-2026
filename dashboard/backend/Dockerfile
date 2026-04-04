FROM python:3.13-slim

RUN pip install --no-cache-dir -r /dev/stdin <<EOF
fastapi>=0.115
uvicorn>=0.34
confluent-kafka>=2.3
EOF

WORKDIR /app
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
