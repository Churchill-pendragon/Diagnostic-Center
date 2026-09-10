<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

$user = require_login();

$stats = db()->query(
    "SELECT
       COUNT(*) AS total_today,
       SUM(status = 'Scheduled') AS waiting,
       SUM(status = 'In Progress') AS in_progress,
       SUM(status = 'Completed') AS completed
     FROM appointments
     WHERE DATE(appointment_date) = CURRENT_DATE()"
)->fetch();

$appointments = db()->query(
    "SELECT a.appointment_id, a.appointment_no, a.appointment_date, a.status,
            CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.phone,
            s.full_name AS booked_by,
            GROUP_CONCAT(tc.test_name ORDER BY tc.test_name SEPARATOR ', ') AS tests
     FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN staff s ON s.staff_id = a.booked_by
     LEFT JOIN test_results tr ON tr.appointment_id = a.appointment_id
     LEFT JOIN test_catalog tc ON tc.test_id = tr.test_id
     WHERE DATE(a.appointment_date) = CURRENT_DATE()
     GROUP BY a.appointment_id
     ORDER BY a.appointment_date ASC
     LIMIT 8"
)->fetchAll();

$labStats = db()->query(
    "SELECT
       SUM(status = 'Sample Collected') AS samples_collected,
       SUM(status = 'Analyzing') AS analyzing,
       SUM(status = 'Report Ready' AND DATE(completed_at) = CURRENT_DATE()) AS reports_ready
     FROM test_results"
)->fetch();

respond([
    'user' => $user,
    'stats' => array_map('intval', $stats ?: []),
    'lab_stats' => array_map('intval', $labStats ?: []),
    'appointments' => $appointments,
    'server_time' => date(DATE_ATOM),
]);

