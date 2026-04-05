FROM nginx:alpine
RUN apk add --no-cache curl
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
# Windows checkouts often use CRLF; a shebang of #!/bin/sh\r makes the kernel report "no such file".
# Strip CR and invoke sh explicitly so the container starts regardless of host line endings.
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
