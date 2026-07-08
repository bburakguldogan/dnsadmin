import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { parseZoneFile, generateZoneFile } from './zoneparser.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dnsadmin-super-secret-key-12345!';

// Public endpoint to catch browser logs / console errors
router.post('/agent/log-browser-error', express.json(), (req, res) => {
  const { message, source, lineno, colno, error } = req.body;
  console.error(`\n[BROWSER CONSOLE ERROR] ${message} at ${source}:${lineno}:${colno}`);
  if (error) {
    console.error(error);
  }
  console.error('\n');
  res.sendStatus(200);
});


// Middleware to authenticate JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;

    // Strict routing lock if user has force_password_change active
    if (user.force_password_change) {
      const allowedPaths = ['/profile', '/auth/me'];
      if (!allowedPaths.includes(req.path)) {
        return res.status(403).json({
          error: 'Password change required before performing any action',
          force_password_change: true
        });
      }
    }

    next();
  });
}

// Middleware to authenticate Hosting Servers (Agents)
async function authenticateAgent(req, res, next) {
  const token = req.headers['x-dnsadmin-token'] || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Server token required in X-DNSAdmin-Token header' });
  }

  try {
    const server = await query.get('SELECT * FROM servers WHERE token = ? AND status = "active"', [token]);
    if (!server) {
      return res.status(403).json({ error: 'Invalid server token' });
    }
    req.server = server;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
}

// Helper: Push zone updates to all DNS nodes
export async function pushZoneToSingleNode(domain, node, isDelete = false) {
  let zoneText = '';
  let serial = 1;

  if (!isDelete) {
    const zone = await query.get('SELECT * FROM zones WHERE domain = ?', [domain]);
    if (!zone) return;
    serial = zone.serial;
    const records = await query.all('SELECT * FROM records WHERE zone_id = ?', [zone.id]);
    zoneText = generateZoneFile(domain, records, serial);
  }

  try {
    const controllerUrl = `${node.url}/api/v1/zone`;
    const response = await fetch(controllerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DNSAdmin-Token': node.token
      },
      body: JSON.stringify({
        domain,
        action: isDelete ? 'delete' : 'update',
        zone_text: zoneText,
        serial
      }),
      // Timeout of 5 seconds
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      await query.run(
        'INSERT INTO sync_logs (node_id, zone, action, message) VALUES (?, ?, ?, ?)',
        [node.id, domain, 'sync_success', `Synced successfully with serial ${serial}`]
      );
      await query.run('UPDATE nodes SET status = "online", last_seen = NOW() WHERE id = ?', [node.id]);
    } else {
      const body = await response.text();
      throw new Error(body || `HTTP status ${response.status}`);
    }
  } catch (err) {
    await query.run(
      'INSERT INTO sync_logs (node_id, zone, action, message) VALUES (?, ?, ?, ?)',
      [node.id, domain, 'sync_failed', `Sync failed: ${err.message}`]
    );
    await query.run('UPDATE nodes SET status = "error", last_seen = NOW() WHERE id = ?', [node.id]);
  }
}

export async function pushZoneToNodes(domain, isDelete = false) {
  const nodes = await query.all('SELECT * FROM nodes');
  if (nodes.length === 0) return;

  for (const node of nodes) {
    // Fire and forget or handle asynchronously to not block API response
    (async () => {
      await pushZoneToSingleNode(domain, node, isDelete);
    })();
  }
}

// ==========================================
// Authentication Routes
// ==========================================

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await query.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, force_password_change: user.force_password_change },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        force_password_change: !!user.force_password_change
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// Profile Management Routes
// ==========================================

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await query.get('SELECT id, username, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', authenticateToken, async (req, res) => {
  const { email, password } = req.body;
  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await query.run('UPDATE users SET email = ?, password = ?, force_password_change = 0 WHERE id = ?', [email, hashedPassword, req.user.id]);
    } else {
      await query.run('UPDATE users SET email = ? WHERE id = ?', [email, req.user.id]);
    }
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// User Administration Routes
// ==========================================

router.get('/users', authenticateToken, async (req, res) => {
  try {
    const users = await query.all('SELECT id, username, email, role, created_at FROM users ORDER BY id ASC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', authenticateToken, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const existingUser = await query.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await query.run(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email || null, hashedPassword, role || 'admin']
    );
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', authenticateToken, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own logged-in account' });
  }
  try {
    await query.run('DELETE FROM users WHERE id = ?', [targetId]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Statistics Route
// ==========================================

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const totalZones = await query.get('SELECT COUNT(*) as count FROM zones');
    const totalNodes = await query.get('SELECT COUNT(*) as count FROM nodes');
    const onlineNodes = await query.get('SELECT COUNT(*) as count FROM nodes WHERE status = "online"');
    const totalServers = await query.get('SELECT COUNT(*) as count FROM servers');
    const recentLogs = await query.all('SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 10');
    
    res.json({
      zones: totalZones.count,
      nodes: {
        total: totalNodes.count,
        online: onlineNodes.count
      },
      servers: totalServers.count,
      recentLogs
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// Zone Management Routes
// ==========================================

router.get('/zones', authenticateToken, async (req, res) => {
  try {
    const zones = await query.all('SELECT * FROM zones ORDER BY domain ASC');
    res.json(zones);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/zones', authenticateToken, async (req, res) => {
  const { domain, ttl } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain is required' });

  try {
    const check = await query.get('SELECT id FROM zones WHERE domain = ?', [domain]);
    if (check) return res.status(400).json({ error: 'Zone already exists' });

    const result = await query.run(
      'INSERT INTO zones (domain, serial, ttl, last_sync) VALUES (?, ?, ?, NOW())',
      [domain, 2026070401, ttl || 3600]
    );

    // Create default NS records based on existing nodes
    const nodes = await query.all('SELECT name FROM nodes');
    for (const node of nodes) {
      await query.run(
        'INSERT INTO records (zone_id, name, type, content, ttl) VALUES (?, ?, ?, ?, ?)',
        [result.id, domain, 'NS', node.name, ttl || 3600]
      );
    }

    // Determine primary nameserver for SOA (MNAME)
    let primaryNs = `ns1.${domain}.`;
    if (req.headers.host) {
      const hostPart = req.headers.host.split(':')[0];
      if (!/^[0-9.]+$/.test(hostPart)) {
        primaryNs = hostPart.endsWith('.') ? hostPart : hostPart + '.';
      }
    }
    if (primaryNs.startsWith('ns1.') && nodes && nodes.length > 0) {
      primaryNs = nodes[0].name;
      if (!primaryNs.endsWith('.')) primaryNs += '.';
    }

    // Determine hostmaster email (RNAME)
    const adminUser = await query.get("SELECT email FROM users WHERE username = 'admin' LIMIT 1");
    let hostmaster = `admin.${domain}.`;
    if (adminUser && adminUser.email) {
      hostmaster = adminUser.email.replace('@', '.') + '.';
    }

    // Default SOA
    await query.run(
      'INSERT INTO records (zone_id, name, type, content, ttl) VALUES (?, ?, ?, ?, ?)',
      [result.id, domain, 'SOA', `${primaryNs} ${hostmaster} ${2026070401} 86400 7200 3600000 86400`, ttl || 3600]
    );

    await pushZoneToNodes(domain);
    res.json({ message: 'Zone created', id: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/zones/:domain', authenticateToken, async (req, res) => {
  try {
    const zone = await query.get('SELECT * FROM zones WHERE domain = ?', [req.params.domain]);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    const records = await query.all('SELECT * FROM records WHERE zone_id = ? ORDER BY type ASC, name ASC', [zone.id]);
    res.json({ zone, records });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/zones/:domain/propagation', authenticateToken, async (req, res) => {
  const { domain } = req.params;
  try {
    const zone = await query.get('SELECT * FROM zones WHERE domain = ?', [domain]);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    const nodes = await query.all('SELECT id, name, status, last_seen, ip FROM nodes');
    const propagation = [];
    
    for (const node of nodes) {
      const latestLog = await query.get(`
        SELECT action, message, created_at 
        FROM sync_logs 
        WHERE node_id = ? AND zone = ? 
        ORDER BY created_at DESC LIMIT 1
      `, [node.id, domain]);

      let status = 'pending';
      let message = 'Pending sync';
      let timestamp = null;

      if (latestLog) {
        timestamp = latestLog.created_at;
        if (latestLog.action === 'sync_success') {
          status = 'synced';
          message = latestLog.message;
        } else if (latestLog.action === 'sync_failed') {
          status = 'failed';
          message = latestLog.message;
        }
      }

      propagation.push({
        node_id: node.id,
        node_name: node.name,
        status,
        message,
        timestamp,
        ip: node.ip || 'None'
      });
    }

    res.json({
      domain,
      serial: zone.serial,
      propagation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/zones/:domain', authenticateToken, async (req, res) => {
  const { records } = req.body;
  const { domain } = req.params;
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Records array is required' });
  }

  try {
    const zone = await query.get('SELECT * FROM zones WHERE domain = ?', [domain]);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    // Update serial (YYYYMMDDNN style)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let newSerial = parseInt(`${today}01`);
    if (String(zone.serial).startsWith(today)) {
      newSerial = zone.serial + 1;
    }

    // Wrap in MySQL transaction manually
    await query.run('START TRANSACTION');
    
    // Delete existing records
    await query.run('DELETE FROM records WHERE zone_id = ?', [zone.id]);

    // Insert new records
    for (const r of records) {
      await query.run(
        'INSERT INTO records (zone_id, name, type, content, ttl, priority) VALUES (?, ?, ?, ?, ?, ?)',
        [zone.id, r.name, r.type, r.content, r.ttl || zone.ttl, r.priority || 0]
      );
    }

    // Update zone serial
    await query.run('UPDATE zones SET serial = ?, last_sync = NOW() WHERE id = ?', [newSerial, zone.id]);
    await query.run('COMMIT');

    await pushZoneToNodes(domain);
    res.json({ message: 'Zone records updated', serial: newSerial });
  } catch (err) {
    await query.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

router.delete('/zones/:domain', authenticateToken, async (req, res) => {
  const { domain } = req.params;
  try {
    const zone = await query.get('SELECT id FROM zones WHERE domain = ?', [domain]);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    await query.run('DELETE FROM zones WHERE id = ?', [zone.id]);
    // Records are deleted by ON DELETE CASCADE
    await pushZoneToNodes(domain, true);
    res.json({ message: 'Zone deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Cluster APIs
// ==========================================
router.get('/clusters', authenticateToken, async (req, res) => {
  try {
    const list = await query.all('SELECT * FROM clusters ORDER BY name ASC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clusters', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await query.run('INSERT INTO clusters (name) VALUES (?)', [name]);
    res.json({ id: result.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/clusters/:id', authenticateToken, async (req, res) => {
  try {
    await query.run('DELETE FROM clusters WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Dashboard Statistics API
// ==========================================
router.get('/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const userCount = await query.get('SELECT COUNT(*) as count FROM users');
    const serverCount = await query.get('SELECT COUNT(*) as count FROM servers');
    const zoneCount = await query.get('SELECT COUNT(*) as count FROM zones');

    const zoneDistribution = await query.all(`
      SELECT s.name as label, COUNT(z.id) as value 
      FROM servers s 
      LEFT JOIN zones z ON z.server_id = s.id 
      GROUP BY s.id
    `);

    const activityTrend = await query.all(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
             SUM(CASE WHEN action IN ('sync_success', 'create') THEN 1 ELSE 0 END) as additions,
             SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END) as removals
      FROM sync_logs 
      WHERE created_at >= NOW() - INTERVAL 6 MONTH 
      GROUP BY month 
      ORDER BY month ASC
    `);

    const latestLogs = await query.all(`
      SELECT action, zone, created_at 
      FROM sync_logs 
      ORDER BY created_at DESC 
      LIMIT 12
    `);

    res.json({
      counts: {
        users: userCount.count,
        servers: serverCount.count,
        zones: zoneCount.count
      },
      distribution: zoneDistribution,
      trend: activityTrend,
      logs: latestLogs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// DNS Node Management Routes
// ==========================================

router.get('/nodes', authenticateToken, async (req, res) => {
  try {
    const nodes = await query.all('SELECT * FROM nodes');
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/nodes', authenticateToken, async (req, res) => {
  const { name, ip, url, group_name } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });

  const token = 'node_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  try {
    const result = await query.run(
      'INSERT INTO nodes (name, ip, url, token, status, group_name) VALUES (?, ?, ?, ?, "offline", ?)',
      [name, ip || '', url, token, group_name || null]
    );
    res.json({ id: result.id, name, url, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/nodes/:id', authenticateToken, async (req, res) => {
  try {
    await query.run('DELETE FROM nodes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Node deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/nodes/:id', authenticateToken, async (req, res) => {
  const { name, ip, url, group_name } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });

  try {
    await query.run(
      'UPDATE nodes SET name = ?, ip = ?, url = ?, group_name = ? WHERE id = ?',
      [name, ip || '', url, group_name || null, req.params.id]
    );
    res.json({ message: 'Node updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Hosting Server (Agent) Management Routes
// ==========================================

router.get('/servers', authenticateToken, async (req, res) => {
  try {
    const servers = await query.all(`
      SELECT s.*,
             (SELECT COUNT(*) FROM zones WHERE server_id = s.id) as zone_count
      FROM servers s
    `);
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/servers', authenticateToken, async (req, res) => {
  const { name, ip, type, group_name } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and Type are required' });

  const token = 'agent_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  try {
    const result = await query.run(
      'INSERT INTO servers (name, ip, token, type, status, group_name) VALUES (?, ?, ?, ?, "active", ?)',
      [name, ip || '', token, type, group_name || null]
    );
    res.json({ id: result.id, name, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/servers/:id', authenticateToken, async (req, res) => {
  try {
    await query.run('DELETE FROM servers WHERE id = ?', [req.params.id]);
    res.json({ message: 'Hosting server agent deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/servers/:id', authenticateToken, async (req, res) => {
  const { name, ip, type, group_name } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and Type are required' });

  try {
    await query.run(
      'UPDATE servers SET name = ?, ip = ?, type = ?, group_name = ? WHERE id = ?',
      [name, ip || '', type, group_name || null, req.params.id]
    );
    res.json({ message: 'Hosting server updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Log Retrieval & Management Routes
// ==========================================

router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const logs = await query.all(`
      SELECT l.*, n.name as node_name 
      FROM sync_logs l 
      LEFT JOIN nodes n ON l.node_id = n.id 
      ORDER BY l.created_at DESC 
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.delete('/logs', authenticateToken, async (req, res) => {
  try {
    await query.run('DELETE FROM sync_logs');
    res.json({ message: 'Logs cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// Remote Hosting Server API (Hook Endpoint)
// ==========================================

router.post('/agent/sync-zone', authenticateAgent, async (req, res) => {
  const { domain, zone_text } = req.body;
  if (!domain || !zone_text) {
    return res.status(400).json({ error: 'domain and zone_text are required' });
  }

  // Reject template and default BIND zones
  const invalidZones = ['PROTO.localhost.rev', 'PROTO.localhost', 'localhost.rev', 'localhost', 'localhost.localdomain'];
  if (invalidZones.includes(domain) || domain.startsWith('PROTO.')) {
    return res.json({ success: true, message: `Ignored sync for template/default zone: ${domain}` });
  }

  try {
    const parsedRecords = parseZoneFile(zone_text, domain);
    if (parsedRecords.length === 0) {
      return res.status(400).json({ error: 'Could not parse any records from zone_text' });
    }

    // Check if zone exists
    let zone = await query.get('SELECT * FROM zones WHERE domain = ?', [domain]);
    let zoneId;
    let serial = 2026070401;

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    await query.run('START TRANSACTION');

    if (zone) {
      zoneId = zone.id;
      serial = parseInt(`${today}01`);
      if (String(zone.serial).startsWith(today)) {
        serial = zone.serial + 1;
      }
      await query.run(
        'UPDATE zones SET serial = ?, last_sync = NOW(), server_id = ? WHERE id = ?',
        [serial, req.server.id, zoneId]
      );
      await query.run('DELETE FROM records WHERE zone_id = ?', [zoneId]);
    } else {
      const result = await query.run(
        'INSERT INTO zones (domain, serial, server_id, last_sync) VALUES (?, ?, ?, NOW())',
        [domain, serial, req.server.id]
      );
      zoneId = result.id;
    }

    // Insert parsed records
    for (const r of parsedRecords) {
      // Exclude incoming SOA records because we generate our own serial-managed SOA
      if (r.type === 'SOA') continue;
      
      await query.run(
        'INSERT INTO records (zone_id, name, type, content, ttl, priority) VALUES (?, ?, ?, ?, ?, ?)',
        [zoneId, r.name, r.type, r.content, r.ttl, r.priority]
      );
    }

    await query.run('COMMIT');

    // Trigger distribution to nodes
    await pushZoneToNodes(domain);

    // Update server last sync log
    await query.run('UPDATE servers SET last_sync = NOW() WHERE id = ?', [req.server.id]);

    res.json({ success: true, message: `Zone ${domain} updated/created`, serial });
  } catch (err) {
    await query.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

router.post('/agent/delete-zone', authenticateAgent, async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  try {
    const zone = await query.get('SELECT id FROM zones WHERE domain = ?', [domain]);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    await query.run('DELETE FROM zones WHERE id = ?', [zone.id]);
    await pushZoneToNodes(domain, true);

    res.json({ success: true, message: `Zone ${domain} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agent/heartbeat', authenticateAgent, async (req, res) => {
  try {
    await query.run('UPDATE servers SET last_sync = NOW() WHERE id = ?', [req.server.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Node Agent Callback / Heartbeat Route
// ==========================================

router.post('/node/heartbeat', async (req, res) => {
  const token = req.headers['x-dnsadmin-token'];
  if (!token) return res.status(401).json({ error: 'Node token required' });

  const { name, cpu, memory, version } = req.body;

  try {
    const node = await query.get('SELECT id FROM nodes WHERE token = ?', [token]);
    if (!node) return res.status(403).json({ error: 'Invalid node token' });

    await query.run(
      'UPDATE nodes SET status = "online", cpu_usage = ?, ram_usage = ?, version = ?, last_seen = NOW() WHERE id = ?',
      [cpu || 0, memory || 0, version || 'v1.0.0', node.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
