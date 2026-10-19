# PHP Backend Architecture

A high-performance, asynchronous IP intelligence aggregator built with modern PHP (8.1+ / 8.5+).

## Directory Structure

```
backend/
├── public/
│   ├── index.php                 # HTTP Entry point & API Gateway (CORS, routing, error handling)
│   └── .htaccess                 # Apache / LiteSpeed URL rewrite rules
├── src/
│   ├── Models/
│   │   └── NetworkProfile.php    # Domain model: coordinates, IPs, ISP, validation, country normalizer
│   ├── Services/
│   │   ├── NetworkAggregator.php # Non-blocking curl_multi engine, concurrency queue, early-stop logic
│   │   └── ProviderExtractor.php # Normalizes JSON & plain text responses from all providers
│   └── Support/
│       ├── ClientIpResolver.php  # Extracts real client IP behind proxies, CDNs (Cloudflare, Netlify)
│       └── ProviderRegistry.php  # Curated registry of verified fast free APIs (tested for Iranian IPs)
├── server.php                    # CLI router for PHP built-in web server
└── README.md
```

## Running the Backend Locally

```bash
npm run dev:backend
```

or directly using PHP:

```bash
php -d extension=curl -d extension=openssl -S 127.0.0.1:8000 backend/server.php
```

## Production Deployment

- **Apache / LiteSpeed / cPanel**: Point document root to `backend/public/`. The included `.htaccess` file handles URL rewriting.
- **Nginx**: Route requests to `backend/public/index.php`.
- **Docker / VPS**: Run with PHP-FPM and Nginx or Caddy.
