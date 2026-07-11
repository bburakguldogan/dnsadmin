<?php
// DNSAdmin Central Licensing Server WHMCS-Compatible Provisioning API
header('Content-Type: application/json');

$dbFile = __DIR__ . '/database.db';
$apiKey = 'DNSAdmin_Licensing_Server_API_Key_2026'; // Change this key for WHMCS security integration!

try {
    $db = new PDO("sqlite:$dbFile");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// 1. Authenticate Request
$requestKey = $_REQUEST['api_key'] ?? '';
if (empty($requestKey) || $requestKey !== $apiKey) {
    echo json_encode(['success' => false, 'message' => 'Unauthorized: Invalid API Key.']);
    exit;
}

// 2. Determine Action
$action = strtolower($_REQUEST['action'] ?? '');
$ip = trim($_REQUEST['ip'] ?? '');

if (empty($ip)) {
    echo json_encode(['success' => false, 'message' => 'Missing IP address parameter.']);
    exit;
}

if (!filter_var($ip, FILTER_VALIDATE_IP)) {
    echo json_encode(['success' => false, 'message' => 'Invalid IP address format.']);
    exit;
}

switch ($action) {
    case 'create':
    case 'update':
        $expires = trim($_REQUEST['expires'] ?? '');
        if (empty($expires)) {
            // Default to 30 days if not provided
            $expires = date('Y-m-d', strtotime('+30 days'));
        }
        
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $expires)) {
            echo json_encode(['success' => false, 'message' => 'Invalid date format. Must be YYYY-MM-DD.']);
            exit;
        }

        try {
            $stmt = $db->prepare("INSERT INTO licenses (ip, expires_at, status) VALUES (?, ?, 'active') 
                                  ON CONFLICT(ip) DO UPDATE SET expires_at = excluded.expires_at, status = 'active'");
            $stmt->execute([$ip, $expires]);
            echo json_encode([
                'success' => true,
                'message' => "License successfully created/updated for $ip.",
                'ip' => $ip,
                'expires_at' => $expires,
                'status' => 'active'
            ]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'message' => 'Database operation failed.']);
        }
        break;

    case 'suspend':
        try {
            $stmt = $db->prepare("UPDATE licenses SET status = 'suspended' WHERE ip = ?");
            $stmt->execute([$ip]);
            echo json_encode([
                'success' => true,
                'message' => "License successfully suspended for $ip.",
                'ip' => $ip,
                'status' => 'suspended'
            ]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'message' => 'Database operation failed.']);
        }
        break;

    case 'unsuspend':
    case 'resume':
        try {
            $stmt = $db->prepare("UPDATE licenses SET status = 'active' WHERE ip = ?");
            $stmt->execute([$ip]);
            echo json_encode([
                'success' => true,
                'message' => "License successfully unsuspended for $ip.",
                'ip' => $ip,
                'status' => 'active'
            ]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'message' => 'Database operation failed.']);
        }
        break;

    case 'terminate':
    case 'delete':
        try {
            $stmt = $db->prepare("DELETE FROM licenses WHERE ip = ?");
            $stmt->execute([$ip]);
            echo json_encode([
                'success' => true,
                'message' => "License successfully terminated for $ip.",
                'ip' => $ip
            ]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'message' => 'Database operation failed.']);
        }
        break;

    case 'status':
        try {
            $stmt = $db->prepare("SELECT * FROM licenses WHERE ip = ?");
            $stmt->execute([$ip]);
            $license = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($license) {
                echo json_encode([
                    'success' => true,
                    'found' => true,
                    'ip' => $license['ip'],
                    'expires_at' => $license['expires_at'],
                    'status' => $license['status'],
                    'expired' => strtotime($license['expires_at']) < time()
                ]);
            } else {
                echo json_encode([
                    'success' => true,
                    'found' => false,
                    'message' => 'No license found for this IP.'
                ]);
            }
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'message' => 'Database query failed.']);
        }
        break;

    default:
        echo json_encode([
            'success' => false,
            'message' => 'Invalid action. Supported actions: create, suspend, unsuspend, terminate, status.'
        ]);
        break;
}
