# Production image for the Audit Platform API (Laravel 12) — used by Render.
FROM php:8.4-apache

# System libs + PHP extensions Laravel needs
RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip libzip-dev libicu-dev ca-certificates \
 && docker-php-ext-install pdo_mysql bcmath zip intl opcache \
 && a2enmod rewrite headers \
 && rm -rf /var/lib/apt/lists/*

# Serve Laravel's public/ folder
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
 && sed -ri 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
 && printf '<Directory /var/www/html/public>\n    AllowOverride All\n</Directory>\n' > /etc/apache2/conf-available/laravel.conf \
 && a2enconf laravel

# Production PHP settings
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Install dependencies first (better layer caching)
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

# App code
COPY . .
RUN rm -f bootstrap/cache/packages.php bootstrap/cache/services.php \
 && composer dump-autoload --optimize --no-dev \
 && php artisan package:discover --ansi \
 && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
 && chown -R www-data:www-data storage bootstrap/cache \
 && sed -i "s/\r$//" docker/start.sh && chmod +x docker/start.sh

EXPOSE 10000
CMD ["docker/start.sh"]
