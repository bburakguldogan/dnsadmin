import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sourcePath = path.join(__dirname, 'license_check.src.php');
const outputPath = path.join(__dirname, 'license_check.php');

if (!fs.existsSync(sourcePath)) {
  console.error('Source PHP file not found!');
  process.exit(1);
}

let code = fs.readFileSync(sourcePath, 'utf8');

// 1. Remove PHP opening tag for processing
code = code.replace(/^<\?php\s*/, '');

// 2. Obfuscate critical strings (like the secret key and API endpoint) first to avoid comment stripping issues with slashes
code = code.replace(
  "'DNSAdmin_Global_Secret_Key_2026'",
  "base64_decode('RE5TQWRtaW5fR2xvYmFsX1NlY3JldF9LZXlfMjAyNg==')"
);
code = code.replace(
  '"https://api.ipify.org"',
  "base64_decode('aHR0cHM6Ly9hcGkuaXBpZnkub3Jn')"
);

// 3. Remove comments
code = code.replace(/\/\*[\s\S]*?\*\//g, '');
code = code.replace(/\/\/.*$/gm, '');

// 4. Rename variables dynamically to randomized/obfuscated names
const varMap = {
  '$licenseFile': '$o_lf',
  '$licenseData': '$o_ld',
  '$license': '$o_l',
  '$secretKey': '$o_sk',
  '$expectedSignature': '$o_es',
  '$expiryTimestamp': '$o_et',
  '$publicIp': '$o_pip',
  '$expectedSignature': '$o_sig',
  '$ch': '$o_ch'
};

for (const [orig, repl] of Object.entries(varMap)) {
  const escapedOrig = orig.replace('$', '\\$');
  const regex = new RegExp(escapedOrig + '\\b', 'g');
  code = code.replace(regex, repl);
}

// 5. Compress whitespace
code = code.replace(/\s+/g, ' ');
code = code.trim();

// 6. Wrap inside eval(base64_decode(...))
const base64Code = Buffer.from(code).toString('base64');
const obfuscatedPHP = `<?php\n// Encrypted with DNSAdmin Obfuscator Engine (Free Edition)\neval(base64_decode('${base64Code}'));\n`;

fs.writeFileSync(outputPath, obfuscatedPHP, 'utf8');
console.log('Successfully compiled and obfuscated license_check.php!');
