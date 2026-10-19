<?php

declare(strict_types=1);

// PSR-4 Autoloader
spl_autoload_register(function (string $class) {
    $prefix = 'App\\';
    $baseDir = __DIR__ . '/../src/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relativeClass = substr($class, $len);
    $file = $baseDir . str_replace('\\', '/', $relativeClass) . '.php';

    if (file_exists($file)) {
        require_once $file;
    }
});

// Security & CORS Response Headers
if (!headers_sent()) {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Content-Type: application/json; charset=utf-8');
}

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Handle preflight OPTIONS request
if ($requestMethod === 'OPTIONS') {
    if (!headers_sent()) {
        http_response_code(204);
    }
    exit;
}

// Only allow GET requests
if ($requestMethod !== 'GET') {
    if (!headers_sent()) {
        http_response_code(405);
    }
    echo json_encode([
        'success' => false,
        'error' => 'Method Not Allowed',
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

try {
    $response = \App\Services\NetworkAggregator::execute();
    if (!headers_sent()) {
        http_response_code(200);
    }
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
} catch (\Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
    }
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
