<?php

declare(strict_types=1);

$configPath = __DIR__ . '/../config/config.php';
if (!file_exists($configPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Missing config/config.php. Copy config.example.php and edit it.']);
    exit;
}

$config = require $configPath;
date_default_timezone_set($config['app']['timezone'] ?? 'Africa/Accra');

session_name('medidiag_session');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

if (!defined('MEDIDIAG_BINARY_RESPONSE')) {
    header('Content-Type: application/json; charset=utf-8');
}
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');

function app_config(?string $section = null): mixed
{
    global $config;
    return $section === null ? $config : ($config[$section] ?? null);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $settings = app_config('database');
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $settings['host'],
        $settings['port'],
        $settings['name'],
        $settings['charset']
    );
    $pdo = new PDO($dsn, $settings['user'], $settings['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        respond(['error' => 'Invalid JSON request body.'], 400);
    }
    return $data;
}

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function current_user(): ?array
{
    return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
}

function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        respond(['error' => 'Authentication required.'], 401);
    }
    return $user;
}

function require_role(array $allowedRoles): array
{
    $user = require_login();
    if (!in_array($user['role'], $allowedRoles, true)) {
        respond(['error' => 'You do not have permission to perform this action.'], 403);
    }
    return $user;
}

function require_csrf(): void
{
    if (in_array($_SERVER['REQUEST_METHOD'], ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $saved = $_SESSION['csrf_token'] ?? '';
    if ($sent === '' || $saved === '' || !hash_equals($saved, $sent)) {
        respond(['error' => 'Your session token is invalid. Refresh and try again.'], 419);
    }
}

function create_csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function clean_string(mixed $value, int $maxLength = 255): string
{
    $text = trim((string) ($value ?? ''));
    return mb_substr($text, 0, $maxLength);
}

function positive_int(mixed $value): int
{
    $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    return $number === false ? 0 : (int) $number;
}

function generate_code(string $prefix): string
{
    return sprintf('%s-%s-%s', $prefix, date('ymd'), strtoupper(bin2hex(random_bytes(3))));
}

function paginate(): array
{
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = min(100, max(5, (int) ($_GET['per_page'] ?? 10)));
    return [$page, $perPage, ($page - 1) * $perPage];
}

function audit(string $action, ?string $entityType = null, string|int|null $entityId = null, array $details = []): void
{
    try {
        $user = current_user();
        $statement = db()->prepare(
            'INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([
            $user['staff_id'] ?? null,
            $action,
            $entityType,
            $entityId === null ? null : (string) $entityId,
            $details === [] ? null : json_encode($details, JSON_UNESCAPED_UNICODE),
            $_SERVER['REMOTE_ADDR'] ?? null,
        ]);
    } catch (Throwable $ignored) {
        // Auditing should never hide the result of the requested operation.
    }
}

set_exception_handler(function (Throwable $error): void {
    $debug = (bool) (app_config('app')['debug'] ?? false);
    respond([
        'error' => $debug ? $error->getMessage() : 'The server could not complete the request.',
    ], 500);
});

