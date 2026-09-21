#!/bin/sh
# Selects docker/nginx/root.dev.conf or root.prod.conf as the active `location /`
# block based on NGINX_PROFILE, and substitutes the upstream server hostname in
# nginx.conf (from "server" to "server-prod" or vice versa based on profile).

set -eu

profile="${NGINX_PROFILE:-prod}"
upstream_host="${UPSTREAM_HOST:-server}"

# Substitute the upstream hostname in nginx.conf for all proxy_pass directives.
sed -i "s|http://server:3000|http://$upstream_host:3000|g" /etc/nginx/nginx.conf

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
