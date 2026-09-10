<?php

declare(strict_types=1);

return [
    'app' => [
        'name' => 'Diagnostic Center Management System',
        'timezone' => 'Africa/Accra',
        'debug' => true,
        'base_url' => 'http://localhost/diagnostic-center',
    ],
    'database' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'diagnostic_center',
        'user' => 'root',
        'password' => '',
        'charset' => 'utf8mb4',
    ],
    'flask' => [
        'url' => 'http://127.0.0.1:5001',
        'service_key' => 'change-this-service-key',
        'timeout_seconds' => 20,
    ],
];

