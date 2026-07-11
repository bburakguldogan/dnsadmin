<?php
// DNSAdmin License Verifier (Compatible with ionCube Obfuscation)
header('Content-Type: application/json');

// Central Licensing Server Settings (Change this to your license portal URL)
$licensingServerUrl = 'https://licensing.guldogan.dev/check.php';
$secretKey = 'DNSAdmin_Global_Secret_Key_2026';

// 1. Determine local server's public IP address
$publicIp = '';
if (function_exists('curl_init')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://api.ipify.org");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    $publicIp = trim(curl_exec($ch));
    curl_close($ch);
}

if (!$publicIp) {
    $publicIp = trim(shell_exec("hostname -I | awk '{print $1}'"));
}

if (!$publicIp) {
    $publicIp = $_SERVER['SERVER_ADDR'] ?? '';
}

if (!$publicIp) {
    echo json_encode(['success' => false, 'message' => 'Unable to determine the local server public IP address.']);
    exit(0);
}

// 2. Query Central Licensing Server
$queryUrl = $licensingServerUrl . '?ip=' . urlencode($publicIp);
$responseJson = '';

if (function_exists('curl_init')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $queryUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $responseJson = curl_exec($ch);
    curl_close($ch);
}

if (!$responseJson) {
    $responseJson = @file_get_contents($queryUrl);
}

if (!$responseJson) {
    echo json_encode(['success' => false, 'message' => 'Connection to central licensing server failed.']);
    exit(0);
}

$response = json_decode($responseJson, true);

if (!$response || !isset($response['success'])) {
    echo json_encode(['success' => false, 'message' => 'Invalid response from central licensing server.']);
    exit(0);
}

if (!$response['success']) {
    echo json_encode(['success' => false, 'message' => $response['message'] ?? 'License check failed.']);
    exit(0);
}

// 3. Cryptographically verify response signature to prevent DNS/hosts spoofing
if (!isset($response['ip']) || !isset($response['expires']) || !isset($response['signature'])) {
    echo json_encode(['success' => false, 'message' => 'License signature payload is missing.']);
    exit(0);
}

$expectedSignature = hash_hmac('sha256', $response['ip'] . '|' . $response['expires'], $secretKey);

if ($response['signature'] !== $expectedSignature) {
    echo json_encode(['success' => false, 'message' => 'Security Warning: Licensing response signature mismatch. Connection may be intercepted.']);
    exit(0);
}

// 4. Double check local date expiration (in case of server lag)
$expiryTimestamp = strtotime($response['expires']);
if (time() > $expiryTimestamp) {
    echo json_encode(['success' => false, 'message' => 'License expired on: ' . $response['expires']]);
    exit(0);
}

echo json_encode([
    'success' => true,
    'details' => [
        'ip' => $response['ip'],
        'expires' => $response['expires']
    ]
]);
