<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
require_login();

if ($method === 'GET') {
    [$page, $perPage, $offset] = paginate();
    $where = ['1 = 1'];
    $params = [];
    $query = clean_string($_GET['q'] ?? '', 100);
    $status = clean_string($_GET['status'] ?? '', 30);
    $date = clean_string($_GET['date'] ?? '', 10);
    if ($query !== '') {
        $where[] = '(a.appointment_no LIKE ? OR p.patient_no LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)';
        $term = "%{$query}%";
        array_push($params, $term, $term, $term, $term);
    }
    if ($status !== '') {
        $where[] = 'a.status = ?';
        $params[] = $status;
    }
    if ($date !== '') {
        $where[] = 'DATE(a.appointment_date) = ?';
        $params[] = $date;
    }
    $whereSql = implode(' AND ', $where);
    $count = db()->prepare(
        "SELECT COUNT(*) FROM appointments a JOIN patients p ON p.patient_id = a.patient_id WHERE {$whereSql}"
    );
    $count->execute($params);
    $total = (int) $count->fetchColumn();

    $statement = db()->prepare(
        "SELECT a.appointment_id, a.appointment_no, a.appointment_date, a.status, a.notes,
                p.patient_id, p.patient_no, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                p.phone, s.full_name AS booked_by,
                GROUP_CONCAT(tc.test_name ORDER BY tc.test_name SEPARATOR ', ') AS tests,
                SUM(tr.status = 'Report Ready') AS ready_count,
                COUNT(tr.result_id) AS test_count
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         JOIN staff s ON s.staff_id = a.booked_by
         LEFT JOIN test_results tr ON tr.appointment_id = a.appointment_id
         LEFT JOIN test_catalog tc ON tc.test_id = tr.test_id
         WHERE {$whereSql}
         GROUP BY a.appointment_id
         ORDER BY a.appointment_date DESC
         LIMIT {$perPage} OFFSET {$offset}"
    );
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
    $patientId = positive_int($body['patient_id'] ?? 0);
    $testIds = array_values(array_unique(array_filter(array_map('positive_int', $body['test_ids'] ?? []))));
    $rawDate = clean_string($body['appointment_date'] ?? '', 30);
    if ($patientId === 0 || $testIds === [] || $rawDate === '') {
        respond(['error' => 'Select a patient, appointment time and at least one test.'], 422);
    }
    try {
        $appointmentDate = (new DateTime($rawDate))->format('Y-m-d H:i:s');
    } catch (Throwable $error) {
        respond(['error' => 'Enter a valid appointment date and time.'], 422);
    }

    $placeholders = implode(',', array_fill(0, count($testIds), '?'));
    $testCheck = db()->prepare("SELECT test_id FROM test_catalog WHERE active = 1 AND test_id IN ({$placeholders})");
    $testCheck->execute($testIds);
    if (count($testCheck->fetchAll()) !== count($testIds)) {
        respond(['error' => 'One or more selected tests are unavailable.'], 422);
    }
    $patientCheck = db()->prepare('SELECT patient_id FROM patients WHERE patient_id = ?');
    $patientCheck->execute([$patientId]);
    if (!$patientCheck->fetchColumn()) {
        respond(['error' => 'The selected patient does not exist.'], 404);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $appointmentNo = generate_code('APT');
        $insert = $pdo->prepare(
            'INSERT INTO appointments (appointment_no, patient_id, appointment_date, status, notes, booked_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $appointmentNo,
            $patientId,
            $appointmentDate,
            'Scheduled',
            clean_string($body['notes'] ?? '', 1000) ?: null,
            $user['staff_id'],
        ]);
        $appointmentId = (int) $pdo->lastInsertId();
        $result = $pdo->prepare(
            "INSERT INTO test_results (appointment_id, test_id, status) VALUES (?, ?, 'Sample Collected')"
        );
        foreach ($testIds as $testId) {
            $result->execute([$appointmentId, $testId]);
        }
        $pdo->commit();
        audit('appointment_created', 'appointment', $appointmentId, ['appointment_no' => $appointmentNo, 'test_ids' => $testIds]);
        respond(['success' => true, 'appointment_id' => $appointmentId, 'appointment_no' => $appointmentNo], 201);
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

if ($method === 'PUT') {
    require_role(['Admin', 'Receptionist']);
    $body = json_body();
    $id = positive_int($body['appointment_id'] ?? 0);
    $status = clean_string($body['status'] ?? '', 30);
    if ($id === 0 || !in_array($status, ['Scheduled', 'In Progress', 'Completed', 'Cancelled'], true)) {
        respond(['error' => 'Select a valid appointment and status.'], 422);
    }
    if ($status === 'Completed') {
        $pending = db()->prepare(
            "SELECT COUNT(*) FROM test_results WHERE appointment_id = ? AND status != 'Report Ready'"
        );
        $pending->execute([$id]);
        if ((int) $pending->fetchColumn() > 0) {
            respond(['error' => 'An appointment cannot be completed while laboratory tests are still pending.'], 409);
        }
    }
    try {
        $appointmentDate = (new DateTime(clean_string($body['appointment_date'] ?? '', 30)))->format('Y-m-d H:i:s');
    } catch (Throwable $error) {
        respond(['error' => 'Enter a valid appointment date and time.'], 422);
    }
    $statement = db()->prepare('UPDATE appointments SET appointment_date = ?, status = ?, notes = ? WHERE appointment_id = ?');
    $statement->execute([$appointmentDate, $status, clean_string($body['notes'] ?? '', 1000) ?: null, $id]);
    audit('appointment_updated', 'appointment', $id, ['status' => $status]);
    respond(['success' => true]);
}

if ($method === 'DELETE') {
    require_role(['Admin']);
    $body = json_body();
    $id = positive_int($body['appointment_id'] ?? 0);
    if ($id === 0) {
        respond(['error' => 'A valid appointment is required.'], 422);
    }
    $statement = db()->prepare('DELETE FROM appointments WHERE appointment_id = ?');
    $statement->execute([$id]);
    audit('appointment_deleted', 'appointment', $id);
    respond(['success' => true]);
}

respond(['error' => 'Method not allowed.'], 405);
