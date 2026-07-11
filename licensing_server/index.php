<?php
// DNSAdmin Licensing Server Web Control Panel
session_start();

$dbFile = __DIR__ . '/database.db';
$adminPassword = 'admin_license_password_2026'; // Change this password for production security!

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
    die("Database connection failed: " . $e->getMessage());
}

// Authentication handling
if (isset($_POST['action']) && $_POST['action'] === 'login') {
    if ($_POST['password'] === $adminPassword) {
        $_SESSION['authenticated'] = true;
    } else {
        $loginError = "Invalid administrator password.";
    }
}

if (isset($_GET['action']) && $_GET['action'] === 'logout') {
    unset($_SESSION['authenticated']);
    header("Location: index.php");
    exit;
}

// Intercept unauthenticated access
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
    ?>
    <!DOCTYPE html>
    <html class="dark" lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
      <title>DNSadmin | Licensing Portal Login</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
      <style>
        * { font-family: 'Outfit', sans-serif; }
        body { background-color: #070a13; color: #f9fafb; }
        .cyber-card {
          border: 1px solid #1f2937;
          background-color: #0b0f19;
          border-radius: 16px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .cyber-card:hover {
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: 0 12px 30px -10px rgba(99, 102, 241, 0.15);
        }
      </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div class="absolute inset-0 z-0 opacity-20 pointer-events-none">
        <div class="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px]"></div>
      </div>
      <div class="max-w-md w-full z-10">
        <div class="flex flex-col items-center mb-8">
          <div class="w-16 h-16 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-indigo-400 mb-4 shadow-lg shadow-indigo-500/5">
            <span class="material-symbols-outlined text-[36px]" style="font-variation-settings: 'FILL' 1;">shield_person</span>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-white">DNSadmin Licensing</h1>
          <p class="text-gray-400 text-sm mt-1">Management Portal Login</p>
        </div>
        <div class="cyber-card p-6 shadow-2xl">
          <?php if (isset($loginError)): ?>
            <div class="bg-red-950/20 border border-red-500/10 text-red-300 rounded-lg p-3 text-sm mb-4">
              <?php echo htmlspecialchars($loginError); ?>
            </div>
          <?php endif; ?>
          <form method="POST">
            <input type="hidden" name="action" value="login"/>
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Admin Password</label>
                <input type="password" name="password" required class="w-full bg-[#030408] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" placeholder="Enter licensing admin password..."/>
              </div>
              <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg shadow-lg hover:shadow-indigo-600/20 active:translate-y-0 -translate-y-[1px] transition-all flex items-center justify-center gap-2 cursor-pointer">
                <span class="material-symbols-outlined text-[20px]">login</span>
                Login Portal
              </button>
            </div>
          </form>
        </div>
      </div>
    </body>
    </html>
    <?php
    exit;
}

// Database mutations handling
$mutationMessage = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['mutation'])) {
    $mutation = $_POST['mutation'];
    
    if ($mutation === 'add') {
        $ip = trim($_POST['ip']);
        $expiry = trim($_POST['expiry']);
        if (filter_var($ip, FILTER_VALIDATE_IP) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiry)) {
            try {
                $stmt = $db->prepare("INSERT INTO licenses (ip, expires_at) VALUES (?, ?) 
                                      ON CONFLICT(ip) DO UPDATE SET expires_at = excluded.expires_at, status = 'active'");
                $stmt->execute([$ip, $expiry]);
                $mutationMessage = "License added/updated successfully for $ip.";
            } catch (PDOException $e) {
                $mutationMessage = "Database error: " . $e->getMessage();
            }
        } else {
            $mutationMessage = "Validation failed: Invalid IP or date format.";
        }
    } elseif ($mutation === 'suspend') {
        $ip = $_POST['ip'];
        try {
            $stmt = $db->prepare("UPDATE licenses SET status = 'suspended' WHERE ip = ?");
            $stmt->execute([$ip]);
            $mutationMessage = "License suspended for $ip.";
        } catch (PDOException $e) {
            $mutationMessage = "Database error.";
        }
    } elseif ($mutation === 'resume') {
        $ip = $_POST['ip'];
        try {
            $stmt = $db->prepare("UPDATE licenses SET status = 'active' WHERE ip = ?");
            $stmt->execute([$ip]);
            $mutationMessage = "License activated for $ip.";
        } catch (PDOException $e) {
            $mutationMessage = "Database error.";
        }
    } elseif ($mutation === 'delete') {
        $ip = $_POST['ip'];
        try {
            $stmt = $db->prepare("DELETE FROM licenses WHERE ip = ?");
            $stmt->execute([$ip]);
            $mutationMessage = "License deleted for $ip.";
        } catch (PDOException $e) {
            $mutationMessage = "Database error.";
        }
    }
}

// Fetch stats
$totalLicenses = $db->query("SELECT COUNT(*) FROM licenses")->fetchColumn();
$activeLicenses = $db->query("SELECT COUNT(*) FROM licenses WHERE status = 'active' AND expires_at >= date('now')")->fetchColumn();
$suspendedLicenses = $db->query("SELECT COUNT(*) FROM licenses WHERE status = 'suspended'")->fetchColumn();
$expiredLicenses = $db->query("SELECT COUNT(*) FROM licenses WHERE expires_at < date('now')")->fetchColumn();

// Fetch all licenses
$stmt = $db->query("SELECT * FROM licenses ORDER BY created_at DESC");
$licenses = $stmt->fetchAll(PDO::FETCH_ASSOC);
?>
<!DOCTYPE html>
<html class="dark" lang="en">
<head>
  <meta charset="utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>DNSadmin | Licensing Control Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
  <style>
    * { font-family: 'Outfit', sans-serif; }
    body { background-color: #070a13; color: #f9fafb; }
    .cyber-card {
      border: 1px solid #1f2937;
      background-color: #0b0f19;
      border-radius: 16px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .cyber-card:hover {
      border-color: rgba(99, 102, 241, 0.3);
      box-shadow: 0 12px 30px -10px rgba(99, 102, 241, 0.15);
    }
    table {
      border-collapse: separate !important;
      border-spacing: 0 !important;
      width: 100% !important;
    }
    table th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #9ca3af;
      font-weight: 600;
      border-bottom: 1px solid #1f2937;
      background-color: #0b0f19;
      padding: 14px 18px;
    }
    table td {
      border-bottom: 1px solid rgba(31, 41, 55, 0.4);
      color: #f3f4f6;
      font-size: 14px;
      padding: 14px 18px;
      vertical-align: middle;
    }
    table tbody tr {
      transition: background-color 0.15s ease-in-out;
    }
    table tbody tr:hover {
      background-color: rgba(99, 102, 241, 0.02);
    }
  </style>
</head>
<body class="min-h-screen py-10 px-6 max-w-6xl mx-auto relative overflow-x-hidden">
  <!-- Top bar logo and logout -->
  <header class="flex justify-between items-center mb-10 pb-6 border-b border-gray-800/60">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 bg-indigo-950/40 border border-indigo-500/30 rounded-xl flex items-center justify-center text-indigo-400">
        <span class="material-symbols-outlined text-[24px]">shield_person</span>
      </div>
      <div>
        <h1 class="text-xl font-bold tracking-tight text-white">DNSadmin Licensing</h1>
        <p class="text-gray-400 text-xs mt-0.5">Central Server Portal</p>
      </div>
    </div>
    <a href="?action=logout" class="bg-red-950/20 border border-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm hover:bg-red-950/40 transition-colors flex items-center gap-2">
      <span class="material-symbols-outlined text-[18px]">logout</span>
      Logout Portal
    </a>
  </header>

  <?php if (!empty($mutationMessage)): ?>
    <div class="bg-indigo-950/30 border border-indigo-500/20 text-indigo-300 rounded-xl p-4 text-sm mb-6 flex items-center gap-2">
      <span class="material-symbols-outlined text-[20px]">info</span>
      <?php echo htmlspecialchars($mutationMessage); ?>
    </div>
  <?php endif; ?>

  <!-- Stats Grid -->
  <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
    <div class="cyber-card p-6 flex flex-col justify-between">
      <span class="text-gray-400 text-xs font-semibold uppercase tracking-wider">Total Issued</span>
      <h2 class="text-3xl font-bold text-white mt-2"><?php echo $totalLicenses; ?></h2>
    </div>
    <div class="cyber-card p-6 flex flex-col justify-between">
      <span class="text-emerald-400 text-xs font-semibold uppercase tracking-wider">Active</span>
      <h2 class="text-3xl font-bold text-emerald-400 mt-2"><?php echo $activeLicenses; ?></h2>
    </div>
    <div class="cyber-card p-6 flex flex-col justify-between">
      <span class="text-amber-400 text-xs font-semibold uppercase tracking-wider">Suspended</span>
      <h2 class="text-3xl font-bold text-amber-400 mt-2"><?php echo $suspendedLicenses; ?></h2>
    </div>
    <div class="cyber-card p-6 flex flex-col justify-between">
      <span class="text-red-400 text-xs font-semibold uppercase tracking-wider">Expired</span>
      <h2 class="text-3xl font-bold text-red-400 mt-2"><?php echo $expiredLicenses; ?></h2>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
    <!-- List Table -->
    <div class="lg:col-span-8 bg-surface-container border border-outline-variant rounded-xl overflow-hidden cyber-card">
      <div class="p-6 border-b border-gray-800 bg-[#0b0f19]/40 flex justify-between items-center">
        <h3 class="text-base font-semibold text-white">Active Licenses</h3>
      </div>
      <div class="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Server IP</th>
              <th>Expiry Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <?php if (empty($licenses)): ?>
              <tr>
                <td colspan="4" class="text-center text-gray-500 py-10">No licenses issued yet. Use the panel on the right to create one.</td>
              </tr>
            <?php else: ?>
              <?php foreach ($licenses as $row): ?>
                <?php
                $expired = strtotime($row['expires_at']) < time();
                $statusColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                if ($row['status'] === 'suspended') {
                    $statusColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
                } elseif ($expired) {
                    $statusColor = 'bg-red-500/10 text-red-400 border-red-500/20';
                }
                ?>
                <tr>
                  <td class="font-mono text-white"><?php echo htmlspecialchars($row['ip']); ?></td>
                  <td class="font-mono"><?php echo htmlspecialchars($row['expires_at']); ?></td>
                  <td>
                    <span class="border px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider <?php echo $statusColor; ?>">
                      <?php echo $row['status'] === 'suspended' ? 'Suspended' : ($expired ? 'Expired' : 'Active'); ?>
                    </span>
                  </td>
                  <td>
                    <div class="flex gap-2">
                      <?php if ($row['status'] === 'active'): ?>
                        <form method="POST" class="inline">
                          <input type="hidden" name="mutation" value="suspend"/>
                          <input type="hidden" name="ip" value="<?php echo htmlspecialchars($row['ip']); ?>"/>
                          <button type="submit" class="bg-amber-650 hover:bg-amber-750 text-xs px-2.5 py-1 text-amber-400 border border-amber-500/20 rounded cursor-pointer transition-all">Suspend</button>
                        </form>
                      <?php else: ?>
                        <form method="POST" class="inline">
                          <input type="hidden" name="mutation" value="resume"/>
                          <input type="hidden" name="ip" value="<?php echo htmlspecialchars($row['ip']); ?>"/>
                          <button type="submit" class="bg-emerald-650 hover:bg-emerald-750 text-xs px-2.5 py-1 text-emerald-400 border border-emerald-500/20 rounded cursor-pointer transition-all">Activate</button>
                        </form>
                      <?php endif; ?>
                      <form method="POST" class="inline" onsubmit="return confirm('Are you sure you want to delete this license?');">
                        <input type="hidden" name="mutation" value="delete"/>
                        <input type="hidden" name="ip" value="<?php echo htmlspecialchars($row['ip']); ?>"/>
                        <button type="submit" class="bg-red-950/20 hover:bg-red-950/40 text-xs px-2.5 py-1 text-red-400 border border-red-500/20 rounded cursor-pointer transition-all">Delete</button>
                      </form>
                    </div>
                  </td>
                </tr>
              <?php endforeach; ?>
            <?php endif; ?>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Form -->
    <div class="lg:col-span-4 cyber-card p-6 flex flex-col justify-between self-start">
      <div class="mb-6">
        <h3 class="text-base font-semibold text-white mb-2">Issue New License</h3>
        <p class="text-gray-400 text-xs leading-relaxed">Add a server public IP and define the expiry date. If the IP exists, it will override the expiry and status.</p>
      </div>
      <form method="POST">
        <input type="hidden" name="mutation" value="add"/>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Server Public IP</label>
            <input type="text" name="ip" required placeholder="e.g. 185.123.45.67" class="w-full bg-[#030408] border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"/>
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Expiry Date</label>
            <input type="date" name="expiry" required value="<?php echo date('Y-m-d', strtotime('+30 days')); ?>" class="w-full bg-[#030408] border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"/>
          </div>
          <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 px-4 rounded-lg shadow-lg hover:shadow-indigo-600/20 active:translate-y-0 -translate-y-[1px] transition-all flex items-center justify-center gap-2 cursor-pointer mt-4">
            <span class="material-symbols-outlined text-[20px]">add_moderator</span>
            Issue License
          </button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>
