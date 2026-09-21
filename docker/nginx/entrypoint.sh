#!/bin/sh
# Selects docker/nginx/root.dev.conf or root.prod.conf as the active `location /`
# block based on NGINX_PROFILE environment variable.
#
# Dev profile serves requests to "/" via the Vite dev server (on the 'client' service).
# Prod profile serves requests to "/" via static files from the nginx image.
# Both profiles proxy "/api" and "/ws" to the 'server' (dev) or 'server-prod' (prod) service.
#
# Upstream hostname resolution is handled by the resolver directive in nginx.conf,
# which dynamically resolves service names on the docker network at request time.

set -eu

profile="${NGINX_PROFILE:-prod}"

# Note: No runtime substitution needed. Nginx resolves service hostnames
# at request time based on the docker network (see nginx.conf resolver directive).
# Dev profile defines 'server' service, prod profile defines 'server-prod' service.
# Both are on the 'codayon' docker network, so nginx can reach either at runtime.

case "$profile" in
  dev)
    cp /etc/nginx/root.dev.conf /etc/nginx/conf.d/root.active.conf
    ;;
  prod)
    cp /etc/nginx/root.prod.conf /etc/nginx/conf.d/root.active.conf
    ;;
  *)
    echo "Unknown NGINX_PROFILE '$profile' (expected 'dev' or 'prod')" >&2
    exit 1
    ;;
esac

exec nginx -g "daemon off;"
