# syntax=docker/dockerfile:1
#
# Production nginx image serving the pre-built client and proxying the API.
#
# Copies the client's pre-built static assets (from the codayon-client:prod
# image, which is FROM scratch and contains only /dist/) into nginx's
# document root, then serves them with same-origin proxying for /api and /ws.

FROM codayon-client:prod as client-dist
FROM nginx:1.27-alpine

ENV NGINX_PROFILE=prod

# Copy nginx configuration and entrypoint script.
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/root.prod.conf /etc/nginx/root.prod.conf
COPY docker/nginx/root.dev.conf /etc/nginx/root.dev.conf
COPY docker/nginx/entrypoint.sh /entrypoint.sh

# Copy the pre-built client static assets into nginx's document root.
COPY --from=client-dist /dist /usr/share/nginx/html

EXPOSE 80
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
