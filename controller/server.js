import express from 'express';
import path from 'path';
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
      const defaultPassword = 'admin'; // Easy default password for local demo/dev
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await query.run(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        ['admin', hashedPassword, 'admin']
      );
      console.log('==================================================');
      console.log('  DEFAULT ADMIN USER CREATED');
      console.log('  Username: admin');
      console.log('  Password: admin');
      console.log('  Please change your password after logging in.');
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DNSAdmin Controller is running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
