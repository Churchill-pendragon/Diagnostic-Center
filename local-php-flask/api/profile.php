<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$user = require_login();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $statement = db()->prepare('SELECT staff_id, full_name, username, role, email, phone, created_at FROM staff WHERE staff_id = ?');
    $statement->execute([$user['staff_id']]);
    respond(['data' => $statement->fetch()]);
}

if ($method === 'PUT') {
    require_csrf();
    $body = json_body();
    $name = clean_string($body['full_name'] ?? '', 120);
    if ($name === '') {
        respond(['error' => 'Full name is required.'], 422);
    }
    $email = clean_string($body['email'] ?? '', 120) ?: null;
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => 'Enter a valid email address.'], 422);
    }
    $phone = preg_replace('/\s+/', '', clean_string($body['phone'] ?? '', 20)) ?: null;
    $statement = db()->prepare('UPDATE staff SET full_name = ?, email = ?, phone = ? WHERE staff_id = ?');
    $statement->execute([$name, $email, $phone, $user['staff_id']]);
    $_SESSION['user']['full_name'] = $name;
    $_SESSION['user']['email'] = $email;
    $_SESSION['user']['phone'] = $phone;
    audit('profile_updated', 'staff', $user['staff_id']);
    respond(['success' => true, 'user' => $_SESSION['user']]);
}

respond(['error' => 'Method not allowed.'], 405);

