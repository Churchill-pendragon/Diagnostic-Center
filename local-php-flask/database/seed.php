<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Run this file from the command line.\n");
}

$configPath = __DIR__ . '/../config/config.php';
if (!file_exists($configPath)) {
    exit("Missing config/config.php. Copy config.example.php first.\n");
}

$config = require $configPath;
$db = $config['database'];
$dsn = sprintf(
    'mysql:host=%s;port=%d;dbname=%s;charset=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['charset']
);

$pdo = new PDO($dsn, $db['user'], $db['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);

$pdo->beginTransaction();
try {
    $staff = [
        ['System Administrator', 'admin', 'Admin@123', 'Admin', 'admin@medidiag.local', '0240000001'],
        ['Esi Mensah', 'reception', 'Reception@123', 'Receptionist', 'reception@medidiag.local', '0240000002'],
        ['Dr. Sena Asare', 'labtech', 'Lab@123', 'Lab Technician', 'lab@medidiag.local', '0240000003'],
    ];
    $staffSql = $pdo->prepare(
        'INSERT INTO staff (full_name, username, password_hash, role, email, phone)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role),
           email = VALUES(email), phone = VALUES(phone), active = 1'
    );
    foreach ($staff as $member) {
        [$name, $username, $password, $role, $email, $phone] = $member;
        $staffSql->execute([$name, $username, password_hash($password, PASSWORD_DEFAULT), $role, $email, $phone]);
    }

    $tests = [
        ['CBC', 'Complete Blood Count (CBC)', 'Haematology', 'Whole blood', 150.00, '4.5 – 11.0', '×10³/µL'],
        ['FBS', 'Fasting Blood Sugar (FBS)', 'Chemistry', 'Serum / plasma', 80.00, '70 – 99', 'mg/dL'],
        ['LIPID', 'Lipid Profile', 'Chemistry', 'Serum', 220.00, '< 200 total cholesterol', 'mg/dL'],
        ['CXR-PA', 'Chest X-Ray (PA View)', 'Radiology', 'Digital image', 300.00, 'Clear lung fields; normal cardiac size', null],
        ['MAL-RDT', 'Malaria Rapid Diagnostic Test', 'Parasitology', 'Whole blood', 60.00, 'Negative', null],
        ['URINE', 'Urinalysis', 'Clinical Pathology', 'Urine', 75.00, 'Within normal limits', null],
    ];
    $testSql = $pdo->prepare(
        'INSERT INTO test_catalog (test_code, test_name, category, specimen, price, normal_range, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE test_name = VALUES(test_name), category = VALUES(category),
           specimen = VALUES(specimen), price = VALUES(price), normal_range = VALUES(normal_range),
           unit = VALUES(unit), active = 1'
    );
    foreach ($tests as $test) {
        $testSql->execute($test);
    }

    $adminId = (int) $pdo->query("SELECT staff_id FROM staff WHERE username = 'admin'")->fetchColumn();
    $receptionId = (int) $pdo->query("SELECT staff_id FROM staff WHERE username = 'reception'")->fetchColumn();

    $patientSql = $pdo->prepare(
        'INSERT INTO patients (patient_no, first_name, last_name, date_of_birth, gender, phone, email, address, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE phone = VALUES(phone), email = VALUES(email), address = VALUES(address)'
    );
    $patientSql->execute(['PAT-DEMO-001', 'Kofi', 'Owusu', '1998-04-11', 'M', '0241234567', 'kofi@example.test', 'Kumasi', $adminId]);
    $patientSql->execute(['PAT-DEMO-002', 'Ama', 'Serwaa', '1995-09-23', 'F', '0549876543', 'ama@example.test', 'Asokwa, Kumasi', $adminId]);

    $patientOne = (int) $pdo->query("SELECT patient_id FROM patients WHERE patient_no = 'PAT-DEMO-001'")->fetchColumn();
    $patientTwo = (int) $pdo->query("SELECT patient_id FROM patients WHERE patient_no = 'PAT-DEMO-002'")->fetchColumn();
    $cbcId = (int) $pdo->query("SELECT test_id FROM test_catalog WHERE test_code = 'CBC'")->fetchColumn();
    $fbsId = (int) $pdo->query("SELECT test_id FROM test_catalog WHERE test_code = 'FBS'")->fetchColumn();

    $appointmentSql = $pdo->prepare(
        'INSERT INTO appointments (appointment_no, patient_id, appointment_date, status, notes, booked_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE appointment_date = VALUES(appointment_date), status = VALUES(status)'
    );
    $appointmentSql->execute(['APT-DEMO-101', $patientOne, date('Y-m-d 08:30:00'), 'Scheduled', 'Demo CBC appointment', $receptionId]);
    $appointmentSql->execute(['APT-DEMO-102', $patientTwo, date('Y-m-d 09:00:00'), 'In Progress', 'Demo FBS appointment', $receptionId]);

    $appointmentOne = (int) $pdo->query("SELECT appointment_id FROM appointments WHERE appointment_no = 'APT-DEMO-101'")->fetchColumn();
    $appointmentTwo = (int) $pdo->query("SELECT appointment_id FROM appointments WHERE appointment_no = 'APT-DEMO-102'")->fetchColumn();
    $resultSql = $pdo->prepare(
        'INSERT INTO test_results (appointment_id, test_id, status)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)'
    );
    $resultSql->execute([$appointmentOne, $cbcId, 'Sample Collected']);
    $resultSql->execute([$appointmentTwo, $fbsId, 'Analyzing']);

    $pdo->commit();
    echo "Seed completed successfully.\n";
    echo "Admin: admin / Admin@123\n";
    echo "Receptionist: reception / Reception@123\n";
    echo "Lab technician: labtech / Lab@123\n";
} catch (Throwable $error) {
    $pdo->rollBack();
    fwrite(STDERR, "Seed failed: {$error->getMessage()}\n");
    exit(1);
}

