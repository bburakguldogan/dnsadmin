<?php
// DNSAdmin License Generator Utility (For Administrator Use Only)
if (php_sapi_name() !== 'cli') {
    die("This utility can only be run via command line interface (CLI).\n");
}

if ($argc < 3) {
    echo "Usage: php license_generator.php <server_ip> <expiry_date_yyyy-mm-dd>\n";
    echo "Example: php license_generator.php 1.2.3.4 2027-12-31\n";
    exit(1);
}

$ip = $argv[1];
$expires = $argv[2];
$secretKey = 'DNSAdmin_Global_Secret_Key_2026';

$signature = hash_hmac('sha256', $ip . '|' . $expires, $secretKey);

$license = [
    'ip' => $ip,
    'expires' => $expires,
    'signature' => $signature
];

$licensePayload = base64_encode(json_encode($license));

file_put_contents('license.key', $licensePayload);

echo "==================================================\n";
echo " License Key successfully generated!\n";
echo " Server IP: $ip\n";
echo " Expiry Date: $expires\n";
echo " License file saved as: license.key\n";
echo "==================================================\n";
