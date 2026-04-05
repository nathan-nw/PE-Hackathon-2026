# Ops Telemetry: scrape Flask `/metrics` on both API replicas over Railway private networking.
# See RAILWAY.md — add this Git-linked service (root directory `prometheus`) or run `node setup-railway.js`.
FROM prom/prometheus:v2.54.1
COPY prometheus.railway.yml /etc/prometheus/prometheus.yml
EXPOSE 9090
# Railway injects PORT; keep scrape targets on 8080 (same as SYNC_VARIABLES on url-shortener-*).
CMD ["sh", "-c", "exec /bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus --web.listen-address=0.0.0.0:${PORT:-9090}"]
