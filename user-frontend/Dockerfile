FROM nginx:alpine
# Railway (and similar) set PORT at runtime; the default image only listens on :80, so health checks fail.
COPY index.html /usr/share/nginx/html/index.html
RUN rm -f /etc/nginx/conf.d/default.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=80
