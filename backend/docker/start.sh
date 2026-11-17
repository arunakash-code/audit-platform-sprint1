#!/bin/sh
set -e

# Render tells us which port to listen on
PORT="${PORT:-10000}"
sed -ri "s/Listen [0-9]+/Listen ${PORT}/" /etc/apache2/ports.conf
sed -ri "s/<VirtualHost \*:[0-9]+>/<VirtualHost *:${PORT}>/" /etc/apache2/sites-available/000-default.conf

# Log to stderr so errors show up in Render's Logs tab
export LOG_CHANNEL="${LOG_CHANNEL:-stderr}"

php artisan config:clear
php artisan migrate --force

# First deploy only: set SEED_ON_START=true to load demo data, then set it back to false.
if [ "$SEED_ON_START" = "true" ]; then
  php artisan db:seed --force
fi

# Always make sure the API's own hostnames map to the tenant (idempotent).
php artisan db:seed --class=TenantHostsSeeder --force || true

php artisan config:cache
php artisan route:cache || true

exec apache2-foreground
