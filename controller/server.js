import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { initDb, query } from './db.js';
import routes from './routes.js';
import { startNotifyListener } from './notify_listener.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5380;
const NOTIFY_PORT = process.env.NOTIFY_PORT || 5353;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-DNSAdmin-Token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static dashboard files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/v1', routes);

// Fallback to SPA for any UI route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Node Health Checker (runs every 30 seconds)
setInterval(async () => {
  try {
    // If last_seen is older than 60 seconds, mark as offline
    const result = await query.run(`
      UPDATE nodes 
      SET status = 'offline' 
      WHERE last_seen < NOW() - INTERVAL 60 SECOND AND status = 'online'
    `);
    if (result.changes > 0) {
      console.log(`[Health Monitor] Marked ${result.changes} inactive node(s) as offline`);
    }
  } catch (err) {
    console.error('[Health Monitor Error]', err.message);
  }
}, 30000);

// Initialize DB and Start Server
async function start() {
  console.log('Initializing DNSAdmin database...');
  await initDb();

  // Create default admin user if none exists
  try {
    const adminCount = await query.get('SELECT COUNT(*) as count FROM users');
    if (adminCount.count === 0) {
      const randomPassword = crypto.randomBytes(8).toString('hex'); // Secure 16-char password
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      await query.run(
        'INSERT INTO users (username, password, role, force_password_change) VALUES (?, ?, ?, ?)',
        ['admin', hashedPassword, 'admin', 1]
      );
      
      // Save credentials to local text file in case user misses console output
      const credsPath = path.join(__dirname, 'admin_credentials.txt');
      fs.writeFileSync(credsPath, `Username: admin\nPassword: ${randomPassword}\n`, 'utf8');

      console.log('==================================================');
      console.log('  DEFAULT ADMIN USER CREATED');
      console.log('  Username: admin');
      console.log(`  Password: ${randomPassword}`);
      console.log('  Please log in and change your password.');
      console.log(`  Credentials file saved to: ${credsPath}`);
      console.log('==================================================');
    }
  } catch (err) {
    console.error('Error creating default admin user:', err);
  }

  // Start the UDP DNS NOTIFY Listener
  try {
    startNotifyListener(NOTIFY_PORT);
  } catch (err) {
    console.error(`Failed to start DNS NOTIFY listener on UDP port ${NOTIFY_PORT}:`, err.message);
  }

  const bindHost = process.env.HOST || '0.0.0.0';
  app.listen(PORT, bindHost, () => {
    console.log(`DNSAdmin Controller is running on http://${bindHost}:${PORT}`);
  });
}

start().catch(console.error);
