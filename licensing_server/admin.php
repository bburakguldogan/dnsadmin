<?php
// DNSAdmin Central Licensing Server Admin CLI Tool
if (php_sapi_name() !== 'cli') {
    die("This management utility can only be run via Command Line Interface (CLI).\n");
}

$dbFile = __DIR__ . '/database.db';

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
    die("Database initialization failed: " . $e->getMessage() . "\n");
}

function showHelp() {
    echo "==================================================\n";
    echo " DNSAdmin License Server Management CLI\n";
    echo "==================================================\n";
    echo "Usage:\n";
    echo "  php admin.php add <ip> <expiry_date_yyyy-mm-dd>   Add/Update a license\n";
    echo "  php admin.php suspend <ip>                         Suspend a license\n";
    echo "  php admin.php resume <ip>                          Activate a suspended license\n";
    echo "  php admin.php delete <ip>                          Delete a license\n";
    echo "  php admin.php list                                 List all licenses\n";
    echo "==================================================\n";
}

if ($argc < 2) {
    showHelp();
    exit(1);
}

$action = strtolower($argv[1]);

switch ($action) {
    case 'add':
        if ($argc < 4) {
            echo "Error: IP address and expiry date are required.\n";
            echo "Usage: php admin.php add <ip> <expiry_date_yyyy-mm-dd>\n";
            exit(1);
        }
        $ip = $argv[2];
        $expiry = $argv[3];
        
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            die("Error: Invalid IP address format: $ip\n");
        }
        
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiry)) {
            die("Error: Expiry date must be in YYYY-MM-DD format.\n");
        }
        
        try {
            $stmt = $db->prepare("INSERT INTO licenses (ip, expires_at) VALUES (?, ?) 
                                  ON CONFLICT(ip) DO UPDATE SET expires_at = excluded.expires_at, status = 'active'");
            $stmt->execute([$ip, $expiry]);
            echo "License successfully added/updated for IP: $ip (Expires: $expiry)\n";
        } catch (PDOException $e) {
            echo "DB Error: " . $e->getMessage() . "\n";
        }
        break;
        
    case 'suspend':
        if ($argc < 3) {
            die("Usage: php admin.php suspend <ip>\n");
        }
        $ip = $argv[2];
        try {
            $stmt = $db->prepare("UPDATE licenses SET status = 'suspended' WHERE ip = ?");
            $stmt->execute([$ip]);
            echo "License for IP $ip has been suspended.\n";
        } catch (PDOException $e) {
            echo "DB Error: " . $e->getMessage() . "\n";
        }
        break;
        
    case 'resume':
        if ($argc < 3) {
            die("Usage: php admin.php resume <ip>\n");
        }
        $ip = $argv[2];
        try {
            $stmt = $db->prepare("UPDATE licenses SET status = 'active' WHERE ip = ?");
            $stmt->execute([$ip]);
            echo "License for IP $ip has been reactivated.\n";
        } catch (PDOException $e) {
            echo "DB Error: " . $e->getMessage() . "\n";
        }
        break;
        
    case 'delete':
        if ($argc < 3) {
            die("Usage: php admin.php delete <ip>\n");
        }
        $ip = $argv[2];
        try {
            $stmt = $db->prepare("DELETE FROM licenses WHERE ip = ?");
            $stmt->execute([$ip]);
            echo "License for IP $ip has been deleted from the database.\n";
        } catch (PDOException $e) {
            echo "DB Error: " . $e->getMessage() . "\n";
        }
        break;
        
    case 'list':
        try {
            $stmt = $db->query("SELECT * FROM licenses ORDER BY created_at DESC");
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            if (empty($rows)) {
                echo "No licenses found in the database.\n";
            } else {
                echo str_pad("IP Address", 20) . str_pad("Expiry Date", 15) . str_pad("Status", 12) . "Created At\n";
                echo str_repeat("-", 65) . "\n";
                foreach ($rows as $row) {
                    echo str_pad($row['ip'], 20) . 
                         str_pad($row['expires_at'], 15) . 
                         str_pad(strtoupper($row['status']), 12) . 
                         $row['created_at'] . "\n";
                }
            }
        } catch (PDOException $e) {
            echo "DB Error: " . $e->getMessage() . "\n";
        }
        break;
        
    default:
        showHelp();
        break;
}
