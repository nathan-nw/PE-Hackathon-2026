FROM nginx:alpine
# Railway (and similar) set PORT at runtime; the default image only listens on :80, so health checks fail.
# BACKEND_URL is written into /api-config.js at container start (browser-reachable load balancer URL).
RUN apk add --no-cache gettext
COPY docker-entrypoint.d/25-api-config.sh /docker-entrypoint.d/25-api-config.sh
# CRLF breaks exec on Linux ("not found" for /bin/sh\r).
RUN sed -i 's/\r$//' /docker-entrypoint.d/25-api-config.sh && chmod +x /docker-entrypoint.d/25-api-config.sh
COPY index.html /usr/share/nginx/html/index.html
COPY api-config.js api-config.js.template /usr/share/nginx/html/
RUN rm -f /etc/nginx/conf.d/default.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=80
ENV BACKEND_URL=http://localhost:18080
