<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'session' : 'login');

if ($method === 'GET' && $action === 'session') {
    $user = current_user();
    respond([
        'authenticated' => $user !== null,
        'user' => $user,
        'csrf_token' => $user === null ? null : create_csrf_token(),
    ]);
}

if ($method !== 'POST') {
    respond(['error' => 'Method not allowed.'], 405);
}

$body = json_body();

if ($action === 'login') {
    $now = time();
    $attempts = $_SESSION['login_attempts'] ?? [];
    $attempts = array_values(array_filter($attempts, fn (int $time): bool => $time > $now - 300));
    if (count($attempts) >= 5) {
        respond(['error' => 'Too many login attempts. Wait five minutes and try again.'], 429);
    }

    $username = strtolower(clean_string($body['username'] ?? '', 60));
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
        respond(['error' => 'Username and password are required.'], 422);
    }

    $statement = db()->prepare(
        'SELECT staff_id, full_name, username, password_hash, role, email, phone
         FROM staff WHERE username = ? AND active = 1 LIMIT 1'
    );
    $statement->execute([$username]);
    $member = $statement->fetch();

    if (!$member || !password_verify($password, $member['password_hash'])) {
        $attempts[] = $now;
        $_SESSION['login_attempts'] = $attempts;
        respond(['error' => 'Invalid username or password.'], 401);
    }

    session_regenerate_id(true);
    unset($member['password_hash']);
    $_SESSION['user'] = $member;
    $_SESSION['login_attempts'] = [];
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    audit('login', 'staff', $member['staff_id']);
    respond(['user' => $member, 'csrf_token' => $_SESSION['csrf_token']]);
}

require_login();
require_csrf();

if ($action === 'logout') {
    audit('logout', 'staff', current_user()['staff_id'] ?? null);
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], '', $params['secure'], $params['httponly']);
    }
    session_destroy();
    respond(['success' => true]);
}

if ($action === 'change-password') {
    $user = require_login();
    $currentPassword = (string) ($body['current_password'] ?? '');
    $newPassword = (string) ($body['new_password'] ?? '');
    if (strlen($newPassword) < 8) {
        respond(['error' => 'The new password must contain at least eight characters.'], 422);
    }
    $statement = db()->prepare('SELECT password_hash FROM staff WHERE staff_id = ?');
    $statement->execute([$user['staff_id']]);
    $hash = $statement->fetchColumn();
    if (!$hash || !password_verify($currentPassword, $hash)) {
        respond(['error' => 'The current password is incorrect.'], 422);
    }
    $update = db()->prepare('UPDATE staff SET password_hash = ? WHERE staff_id = ?');
    $update->execute([password_hash($newPassword, PASSWORD_DEFAULT), $user['staff_id']]);
    audit('password_changed', 'staff', $user['staff_id']);
    respond(['success' => true]);
}

respond(['error' => 'Unknown authentication action.'], 404);

