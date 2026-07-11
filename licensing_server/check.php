<?php
// DNSAdmin Central Licensing Server API Endpoint
header('Content-Type: application/json');

$dbFile = __DIR__ . '/database.db';
$secretKey = 'DNSAdmin_Global_Secret_Key_2026';

try {
    $db = new PDO("sqlite:$dbFile");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Create licenses table if it doesn't exist
    $db->exec("CREATE TABLE IF NOT EXISTS licenses (
        ip TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database connection failed.']);
    exit;
}

// Get client's connecting IP address (helps prevent client-side IP spoofing)
$clientIp = $_SERVER['REMOTE_ADDR'];

// Allow override via GET query parameter for testing or local NAT environments if passed
if (isset($_GET['ip']) && !empty($_GET['ip'])) {
    $clientIp = $_GET['ip'];
}

if (!$clientIp) {
    echo json_encode(['success' => false, 'message' => 'Unable to determine requesting IP address.']);
    exit;
}

try {
    $stmt = $db->prepare("SELECT * FROM licenses WHERE ip = ?");
    $stmt->execute([$clientIp]);
    $license = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database query failed.']);
    exit;
}

if (!$license) {
    echo json_encode([
        'success' => false,
        'message' => "No active license found for IP address: $clientIp"
    ]);
    exit;
}

if ($license['status'] !== 'active') {
    echo json_encode([
        'success' => false,
        'message' => "The license for IP address $clientIp has been suspended."
    ]);
    exit;
}

$expiryTimestamp = strtotime($license['expires_at']);
if (time() > $expiryTimestamp) {
    echo json_encode([
        'success' => false,
        'message' => "License expired on: " . $license['expires_at']
    ]);
    exit;
}

// Generate secure signature to prevent licensing server response spoofing
$signaturePayload = $clientIp . '|' . $license['expires_at'];
$responseSignature = hash_hmac('sha256', $signaturePayload, $secretKey);

echo json_encode([
    'success' => true,
    'ip' => $clientIp,
    'expires' => $license['expires_at'],
    'signature' => $responseSignature
]);
