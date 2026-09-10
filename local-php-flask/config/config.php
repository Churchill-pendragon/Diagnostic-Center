<?php

declare(strict_types=1);

// Local development defaults. Change these values to match your XAMPP/MySQL setup.
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

