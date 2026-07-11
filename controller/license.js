import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export let isLicenseValid = true;
export let licenseError = '';
export let licenseDetails = null;

export function checkLicense() {
  const licenseScript = path.join(__dirname, 'license_check.php');
  
  if (!fs.existsSync(licenseScript)) {
    isLicenseValid = false;
    licenseError = 'Licensing verification script (license_check.php) is missing!';
    return;
  }

  exec(`php ${licenseScript}`, (err, stdout, stderr) => {
    if (err) {
      isLicenseValid = false;
      licenseError = `Licensing system error: ${stderr || err.message}`;
      return;
    }

    try {
      const result = JSON.parse(stdout.trim());
      if (result.success) {
        isLicenseValid = true;
        licenseError = '';
        licenseDetails = result.details;
      } else {
        isLicenseValid = false;
        licenseError = result.message || 'License is invalid or expired!';
        licenseDetails = null;
      }
    } catch (parseErr) {
      isLicenseValid = false;
      licenseError = 'Invalid response format from licensing script!';
      licenseDetails = null;
    }
  });
}

// Initial check on boot
checkLicense();

// Check every 5 minutes in background
setInterval(checkLicense, 5 * 60 * 1000);

// Express Middleware to intercept API requests if license is invalid
export function licenseMiddleware(req, res, next) {
  // Allow public check and license submission endpoints
  if (req.path === '/api/v1/public/license' || req.path === '/api/v1/public/license/update') {
    return next();
  }

  if (!isLicenseValid) {
    return res.status(402).json({
      error: 'License Required',
      message: licenseError || 'A valid license is required to operate this server.'
    });
  }

  next();
}
