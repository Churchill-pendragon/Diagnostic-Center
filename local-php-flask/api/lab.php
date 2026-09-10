<?php

declare(strict_types=1);

$action = $_GET['action'] ?? 'worklist';
if ($action === 'report-pdf') {
    define('MEDIDIAG_BINARY_RESPONSE', true);
}
require __DIR__ . '/_bootstrap.php';

$user = require_login();

function flask_request(string $method, string $path, ?array $payload = null): array
{
    $settings = app_config('flask');
    if (!function_exists('curl_init')) {
        respond(['error' => 'PHP cURL is disabled. Enable extension=curl in php.ini and restart Apache.'], 500);
    }
    $curl = curl_init(rtrim($settings['url'], '/') . $path);
    $headers = ['X-Service-Key: ' . $settings['service_key']];
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($payload));
    }
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => (int) $settings['timeout_seconds'],
        CURLOPT_HEADER => false,
    ]);
    $body = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $contentType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($body === false || $status === 0) {
        respond(['error' => 'The Flask laboratory service is offline. Start it and try again.', 'detail' => $error], 503);
    }
    return ['status' => $status, 'content_type' => $contentType, 'body' => $body];
}

if ($action === 'report-pdf') {
    $resultId = positive_int($_GET['result_id'] ?? 0);
    if ($resultId === 0) {
        http_response_code(422);
        exit('Invalid report.');
    }
    $response = flask_request('GET', "/reports/{$resultId}/pdf");
    http_response_code($response['status']);
    header('Content-Type: ' . ($response['content_type'] ?: 'application/pdf'));
    header('Content-Disposition: attachment; filename="MediDiag-Report-' . $resultId . '.pdf"');
    echo $response['body'];
    exit;
}

if ($action === 'worklist' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_role(['Admin', 'Lab Technician']);
    $response = flask_request('GET', '/worklist');
    http_response_code($response['status']);
    echo $response['body'];
    exit;
}

require_csrf();
require_role(['Admin', 'Lab Technician']);
$body = json_body();
$resultId = positive_int($body['result_id'] ?? 0);
if ($resultId === 0) {
    respond(['error' => 'Select a valid laboratory result.'], 422);
}

if ($action === 'start') {
    $response = flask_request('POST', "/results/{$resultId}/start", ['staff_id' => $user['staff_id']]);
    if ($response['status'] < 300) {
        audit('lab_analysis_started', 'result', $resultId);
    }
    http_response_code($response['status']);
    echo $response['body'];
    exit;
}

if ($action === 'complete') {
    $resultValue = clean_string($body['result_value'] ?? '', 4000);
    if ($resultValue === '') {
        respond(['error' => 'Enter the laboratory result.'], 422);
    }
    $response = flask_request('POST', "/results/{$resultId}/complete", [
        'staff_id' => $user['staff_id'],
        'result_value' => $resultValue,
        'result_notes' => clean_string($body['result_notes'] ?? '', 4000),
    ]);
    if ($response['status'] < 300) {
        audit('lab_result_completed', 'result', $resultId);
    }
    http_response_code($response['status']);
    echo $response['body'];
    exit;
}

respond(['error' => 'Unknown laboratory action.'], 404);

