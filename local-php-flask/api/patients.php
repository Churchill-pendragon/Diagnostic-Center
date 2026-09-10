<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$user = require_login();

if ($method === 'GET') {
    [$page, $perPage, $offset] = paginate();
    $query = clean_string($_GET['q'] ?? '', 100);
    $where = '';
    $params = [];
    if ($query !== '') {
        $where = "WHERE patient_no LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?";
        $term = "%{$query}%";
        $params = [$term, $term, $term, $term];
    }

    $count = db()->prepare("SELECT COUNT(*) FROM patients {$where}");
    $count->execute($params);
    $total = (int) $count->fetchColumn();

    $sql = "SELECT patient_id, patient_no, first_name, last_name, date_of_birth, gender,
                   phone, email, address, created_at
            FROM patients {$where}
            ORDER BY created_at DESC
            LIMIT {$perPage} OFFSET {$offset}";
    $statement = db()->prepare($sql);
    $statement->execute($params);
    respond([
        'data' => $statement->fetchAll(),
        'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => $total, 'pages' => (int) ceil($total / $perPage)],
    ]);
}

require_csrf();

if ($method === 'POST') {
    $user = require_role(['Admin', 'Receptionist']);
    $body = json_body();
    $firstName = clean_string($body['first_name'] ?? '', 60);
    $lastName = clean_string($body['last_name'] ?? '', 60);
    $dateOfBirth = clean_string($body['date_of_birth'] ?? '', 10);
    $gender = clean_string($body['gender'] ?? '', 10);
    $phone = preg_replace('/\s+/', '', clean_string($body['phone'] ?? '', 20));
    if ($firstName === '' || $lastName === '' || $dateOfBirth === '' || $phone === '') {
        respond(['error' => 'First name, last name, date of birth and phone are required.'], 422);
    }
    if (!in_array($gender, ['M', 'F', 'Other'], true)) {
        respond(['error' => 'Select a valid gender.'], 422);
    }
    if (!preg_match('/^\+?[0-9]{10,15}$/', $phone)) {
        respond(['error' => 'Enter a valid phone number using 10 to 15 digits.'], 422);
    }
    if (strtotime($dateOfBirth) === false || $dateOfBirth > date('Y-m-d')) {
        respond(['error' => 'Enter a valid date of birth.'], 422);
    }

    $patientNo = generate_code('PAT');
    $statement = db()->prepare(
        'INSERT INTO patients
         (patient_no, first_name, last_name, date_of_birth, gender, phone, email, address, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        $patientNo,
        $firstName,
        $lastName,
        $dateOfBirth,
        $gender,
        $phone,
        clean_string($body['email'] ?? '', 120) ?: null,
        clean_string($body['address'] ?? '', 255) ?: null,
        $user['staff_id'],
    ]);
    $id = (int) db()->lastInsertId();
    audit('patient_created', 'patient', $id, ['patient_no' => $patientNo]);
    respond(['success' => true, 'patient_id' => $id, 'patient_no' => $patientNo], 201);
}

if ($method === 'PUT') {
    require_role(['Admin', 'Receptionist']);
    $body = json_body();
    $id = positive_int($body['patient_id'] ?? 0);
    if ($id === 0) {
        respond(['error' => 'A valid patient is required.'], 422);
    }
    $firstName = clean_string($body['first_name'] ?? '', 60);
    $lastName = clean_string($body['last_name'] ?? '', 60);
    $dateOfBirth = clean_string($body['date_of_birth'] ?? '', 10);
    $gender = clean_string($body['gender'] ?? '', 10);
    $phone = preg_replace('/\s+/', '', clean_string($body['phone'] ?? '', 20));
    if ($firstName === '' || $lastName === '' || !in_array($gender, ['M', 'F', 'Other'], true)) {
        respond(['error' => 'Complete the required patient fields.'], 422);
    }
    if (!preg_match('/^\+?[0-9]{10,15}$/', $phone) || strtotime($dateOfBirth) === false || $dateOfBirth > date('Y-m-d')) {
        respond(['error' => 'Enter a valid date of birth and phone number.'], 422);
    }
    $statement = db()->prepare(
        'UPDATE patients SET first_name = ?, last_name = ?, date_of_birth = ?, gender = ?,
         phone = ?, email = ?, address = ? WHERE patient_id = ?'
    );
    $statement->execute([
        $firstName,
        $lastName,
        $dateOfBirth,
        $gender,
        $phone,
        clean_string($body['email'] ?? '', 120) ?: null,
        clean_string($body['address'] ?? '', 255) ?: null,
        $id,
    ]);
    audit('patient_updated', 'patient', $id);
    respond(['success' => true]);
}

if ($method === 'DELETE') {
    require_role(['Admin']);
    $body = json_body();
    $id = positive_int($body['patient_id'] ?? 0);
    if ($id === 0) {
        respond(['error' => 'A valid patient is required.'], 422);
    }
    $statement = db()->prepare('DELETE FROM patients WHERE patient_id = ?');
    $statement->execute([$id]);
    audit('patient_deleted', 'patient', $id);
    respond(['success' => true]);
}

respond(['error' => 'Method not allowed.'], 405);

