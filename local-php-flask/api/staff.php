<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
require_role(['Admin']);

if ($method === 'GET') {
    $statement = db()->query(
        'SELECT staff_id, full_name, username, role, email, phone, active, created_at
         FROM staff ORDER BY active DESC, full_name ASC'
    );
    respond(['data' => $statement->fetchAll()]);
}

require_csrf();
$body = json_body();

if ($method === 'POST') {
    $name = clean_string($body['full_name'] ?? '', 120);
    $username = strtolower(clean_string($body['username'] ?? '', 60));
    $password = (string) ($body['password'] ?? '');
    $role = clean_string($body['role'] ?? '', 30);
    if ($name === '' || $username === '' || strlen($password) < 8 || !in_array($role, ['Admin', 'Receptionist', 'Lab Technician'], true)) {
        respond(['error' => 'Name, username, valid role and a password of at least eight characters are required.'], 422);
    }
    try {
        $statement = db()->prepare(
            'INSERT INTO staff (full_name, username, password_hash, role, email, phone)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([
            $name,
            $username,
            password_hash($password, PASSWORD_DEFAULT),
            $role,
            clean_string($body['email'] ?? '', 120) ?: null,
            clean_string($body['phone'] ?? '', 20) ?: null,
        ]);
    } catch (PDOException $error) {
        if ((string) $error->getCode() === '23000') {
            respond(['error' => 'That username is already in use.'], 409);
        }
        throw $error;
    }
    $id = (int) db()->lastInsertId();
    audit('staff_created', 'staff', $id, ['role' => $role]);
    respond(['success' => true, 'staff_id' => $id], 201);
}

if ($method === 'PUT') {
    $id = positive_int($body['staff_id'] ?? 0);
    $action = clean_string($body['action'] ?? 'update', 30);
    if ($id === 0) {
        respond(['error' => 'A valid staff account is required.'], 422);
    }
    if ($action === 'reset-password') {
        $password = (string) ($body['password'] ?? '');
        if (strlen($password) < 8) {
            respond(['error' => 'The new password must contain at least eight characters.'], 422);
        }
        $statement = db()->prepare('UPDATE staff SET password_hash = ? WHERE staff_id = ?');
        $statement->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
        audit('staff_password_reset', 'staff', $id);
        respond(['success' => true]);
    }
    $name = clean_string($body['full_name'] ?? '', 120);
    $role = clean_string($body['role'] ?? '', 30);
    if ($name === '' || !in_array($role, ['Admin', 'Receptionist', 'Lab Technician'], true)) {
        respond(['error' => 'Name and a valid role are required.'], 422);
    }
    $statement = db()->prepare(
        'UPDATE staff SET full_name = ?, role = ?, email = ?, phone = ?, active = ? WHERE staff_id = ?'
    );
    $statement->execute([
        $name,
        $role,
        clean_string($body['email'] ?? '', 120) ?: null,
        clean_string($body['phone'] ?? '', 20) ?: null,
        (int) (bool) ($body['active'] ?? true),
        $id,
    ]);
    audit('staff_updated', 'staff', $id, ['role' => $role]);
    respond(['success' => true]);
}

if ($method === 'DELETE') {
    $id = positive_int($body['staff_id'] ?? 0);
    if ($id === 0 || $id === (int) current_user()['staff_id']) {
        respond(['error' => 'You cannot deactivate this account.'], 422);
    }
    $statement = db()->prepare('UPDATE staff SET active = 0 WHERE staff_id = ?');
    $statement->execute([$id]);
    audit('staff_deactivated', 'staff', $id);
    respond(['success' => true]);
}

respond(['error' => 'Method not allowed.'], 405);

