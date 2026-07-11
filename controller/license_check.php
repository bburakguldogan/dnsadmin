<?php
// DNSAdmin License Verifier (Compatible with ionCube Obfuscation)
header('Content-Type: application/json');

$licenseFile = __DIR__ . '/license.key';
if (!file_exists($licenseFile)) {
    echo json_encode(['success' => false, 'message' => 'license.key file not found. Please place your license file in the installation directory.']);
    exit(0);
}

$licenseData = file_get_contents($licenseFile);
$license = json_decode(base64_decode($licenseData), true);

if (!$license || !isset($license['ip']) || !isset($license['expires']) || !isset($license['signature'])) {
    echo json_encode(['success' => false, 'message' => 'License file structure is invalid or corrupt.']);
    exit(0);
}

// Verify signature to prevent tampering
$secretKey = 'DNSAdmin_Global_Secret_Key_2026';
$expectedSignature = hash_hmac('sha256', $license['ip'] . '|' . $license['expires'], $secretKey);

if ($license['signature'] !== $expectedSignature) {
    echo json_encode(['success' => false, 'message' => 'License signature mismatch. The file has been modified.']);
    exit(0);
}

// Check Expiration Date
$expiryTimestamp = strtotime($license['expires']);
if (time() > $expiryTimestamp) {
    echo json_encode(['success' => false, 'message' => 'License expired on: ' . $license['expires']]);
    exit(0);
}

// Fetch public IP address with curl timeout
$publicIp = '';
if (function_exists('curl_init')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://api.ipify.org");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    $publicIp = trim(curl_exec($ch));
    curl_close($ch);
}

// Fallback to local network interfaces if curl fails or returns empty
if (!$publicIp) {
    $publicIp = trim(shell_exec("hostname -I | awk '{print $1}'"));
}

if (!$publicIp) {
    // If still empty, check server addr
    $publicIp = $_SERVER['SERVER_ADDR'] ?? '';
}

if ($license['ip'] !== $publicIp) {
    echo json_encode(['success' => false, 'message' => "License is registered for IP: {$license['ip']}, but current server IP is: {$publicIp}"]);
    exit(0);
}

echo json_encode([
    'success' => true,
    'details' => [
        'ip' => $license['ip'],
        'expires' => $license['expires']
    ]
]);
