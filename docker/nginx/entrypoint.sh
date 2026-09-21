#!/bin/sh
# Selects docker/nginx/root.dev.conf or root.prod.conf as the active `location /`
# block based on NGINX_PROFILE, then starts nginx normally.
#
# Used by both the dev profile (nginx official image + bind-mounted config,
# see docker-compose.yml) and the prod profile (baked into the nginx image by
# docker/nginx/Dockerfile).
set -eu

profile="${NGINX_PROFILE:-prod}"

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
