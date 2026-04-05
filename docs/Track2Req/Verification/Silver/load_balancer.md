# Load Balancer — Nginx

## Deliverable
`docker ps` showing Nginx container routing traffic to multiple app instances.

## What We Implemented
Nginx sits in front of the two Flask replicas as a reverse proxy and load balancer, exposed on port 8080.

- **Algorithm:** `least_conn` — routes each request to the instance with the fewest active connections
- **Health checks:** Nginx proxies `/live`, `/ready`, and `/health` endpoints from the upstream instances
- **Stub status:** Exposed on port 8081 at `/nginx_status` for monitoring active connections and request counts

## Configuration
- `load-balancer/nginx.conf.template` — upstream block with both replicas, `least_conn` directive
- `load-balancer/docker-entrypoint.sh` — template rendering at container startup

## Traffic Flow
```
Client → Nginx (:8080) → url-shortener-a (:5000)
                        → url-shortener-b (:5000)
```

All external traffic enters through Nginx. No direct access to app instances from outside the Docker network.
