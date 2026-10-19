<?php

declare(strict_types=1);

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Serve static assets directly if they exist in public/
$publicFile = __DIR__ . '/public' . $uri;
if ($uri !== '/' && file_exists($publicFile) && !is_dir($publicFile)) {
    return false;
}

// Forward API & dynamic requests to the gateway index.php
require_once __DIR__ . '/public/index.php';
