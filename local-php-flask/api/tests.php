<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
require_login();

if ($method === 'GET') {
    $includeInactive = current_user()['role'] === 'Admin' && ($_GET['include_inactive'] ?? '') === '1';
    $where = $includeInactive ? '' : 'WHERE active = 1';
    $statement = db()->query(
        "SELECT test_id, test_code, test_name, category, specimen, price, normal_range, unit, active, created_at
         FROM test_catalog {$where} ORDER BY active DESC, test_name ASC"
    );
    respond(['data' => $statement->fetchAll()]);
}

require_csrf();
require_role(['Admin']);
$body = json_body();

$values = function (array $payload): array {
    $code = strtoupper(clean_string($payload['test_code'] ?? '', 20));
    $name = clean_string($payload['test_name'] ?? '', 120);
    $category = clean_string($payload['category'] ?? '', 80);
    $price = filter_var($payload['price'] ?? null, FILTER_VALIDATE_FLOAT);
    $normalRange = clean_string($payload['normal_range'] ?? '', 160);
    if ($code === '' || $name === '' || $category === '' || $normalRange === '' || $price === false || $price < 0) {
        respond(['error' => 'Code, test name, category, price and normal range are required.'], 422);
    }
    return [
        $code,
        $name,
        $category,
        clean_string($payload['specimen'] ?? '', 80) ?: null,
        (float) $price,
        $normalRange,
        clean_string($payload['unit'] ?? '', 40) ?: null,
        isset($payload['active']) ? (int) (bool) $payload['active'] : 1,
    ];
};

if ($method === 'POST') {
    $data = $values($body);
    try {
        $statement = db()->prepare(
            'INSERT INTO test_catalog (test_code, test_name, category, specimen, price, normal_range, unit, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $statement->execute($data);
    } catch (PDOException $error) {
        if ((string) $error->getCode() === '23000') {
            respond(['error' => 'That test code already exists.'], 409);
        }
        throw $error;
    }
    $id = (int) db()->lastInsertId();
    audit('test_created', 'test', $id, ['test_code' => $data[0]]);
    respond(['success' => true, 'test_id' => $id], 201);
}

if ($method === 'PUT') {
    $id = positive_int($body['test_id'] ?? 0);
    if ($id === 0) {
        respond(['error' => 'A valid test is required.'], 422);
    }
    $data = $values($body);
    $data[] = $id;
    $statement = db()->prepare(
        'UPDATE test_catalog SET test_code = ?, test_name = ?, category = ?, specimen = ?,
         price = ?, normal_range = ?, unit = ?, active = ? WHERE test_id = ?'
    );
    $statement->execute($data);
    audit('test_updated', 'test', $id);
    respond(['success' => true]);
}

if ($method === 'DELETE') {
    $id = positive_int($body['test_id'] ?? 0);
    if ($id === 0) {
        respond(['error' => 'A valid test is required.'], 422);
    }
    $used = db()->prepare('SELECT COUNT(*) FROM test_results WHERE test_id = ?');
    $used->execute([$id]);
    if ((int) $used->fetchColumn() > 0) {
        $disable = db()->prepare('UPDATE test_catalog SET active = 0 WHERE test_id = ?');
        $disable->execute([$id]);
        audit('test_deactivated', 'test', $id);
        respond(['success' => true, 'deactivated' => true]);
    }
    $delete = db()->prepare('DELETE FROM test_catalog WHERE test_id = ?');
    $delete->execute([$id]);
    audit('test_deleted', 'test', $id);
    respond(['success' => true, 'deleted' => true]);
}

respond(['error' => 'Method not allowed.'], 405);
