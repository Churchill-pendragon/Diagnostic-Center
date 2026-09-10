<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

require_login();
[$page, $perPage, $offset] = paginate();
$query = clean_string($_GET['q'] ?? '', 100);
$where = "tr.status = 'Report Ready'";
$params = [];
if ($query !== '') {
    $where .= ' AND (a.appointment_no LIKE ? OR p.patient_no LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR tc.test_name LIKE ?)';
    $term = "%{$query}%";
    $params = [$term, $term, $term, $term, $term];
}

$count = db()->prepare(
    "SELECT COUNT(*) FROM test_results tr
     JOIN appointments a ON a.appointment_id = tr.appointment_id
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN test_catalog tc ON tc.test_id = tr.test_id
     WHERE {$where}"
);
$count->execute($params);
$total = (int) $count->fetchColumn();

$statement = db()->prepare(
    "SELECT tr.result_id, tr.result_value, tr.result_notes, tr.completed_at,
            a.appointment_no, p.patient_no, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
            tc.test_code, tc.test_name, tc.normal_range, tc.unit,
            s.full_name AS verified_by
     FROM test_results tr
     JOIN appointments a ON a.appointment_id = tr.appointment_id
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN test_catalog tc ON tc.test_id = tr.test_id
     LEFT JOIN staff s ON s.staff_id = tr.verified_by
     WHERE {$where}
     ORDER BY tr.completed_at DESC
     LIMIT {$perPage} OFFSET {$offset}"
);
$statement->execute($params);
respond([
    'data' => $statement->fetchAll(),
    'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => $total, 'pages' => (int) ceil($total / $perPage)],
]);

