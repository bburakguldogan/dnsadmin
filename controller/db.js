import mysql from 'mysql2/promise';

// MySQL Connection Pool Configuration
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  user: process.env.MYSQL_USER || 'dnsadmin',
  password: process.env.MYSQL_PASSWORD || 'dnsadmin_pass',
  database: process.env.MYSQL_DATABASE || 'dnsadmin',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Emulate SQLite query helper interface with MySQL pool execution
export const query = {
  async run(sql, params = []) {
    const [result] = await pool.execute(sql, params);
    return {
      id: result.insertId || null,
      changes: result.affectedRows || 0
    };
  },
  async get(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows[0] || null;
  },
  async all(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  },
  async exec(sql) {
    // MySQL query is suited for multi-line execs
    await pool.query(sql);
  }
};

export async function initDb() {
  // Create tables using MySQL-specific syntax
  
  await query.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) DEFAULT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'admin',
      force_password_change TINYINT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) UNIQUE NOT NULL,
      ip VARCHAR(45) DEFAULT NULL,
      url VARCHAR(255) NOT NULL,
      token VARCHAR(255) DEFAULT NULL,
      status VARCHAR(50) DEFAULT 'offline',
      last_seen DATETIME DEFAULT NULL,
      cpu_usage FLOAT DEFAULT 0,
      ram_usage FLOAT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) UNIQUE NOT NULL,
      ip VARCHAR(45) DEFAULT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      type VARCHAR(50) NOT NULL,
      status VARCHAR(50) DEFAULT 'active',
      last_sync DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      domain VARCHAR(255) UNIQUE NOT NULL,
      serial BIGINT DEFAULT 1,
      ttl INT DEFAULT 3600,
      status VARCHAR(50) DEFAULT 'active',
      last_sync DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      zone_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(20) NOT NULL,
      content VARCHAR(1024) NOT NULL,
      ttl INT DEFAULT 3600,
      priority INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    );
  `);

  await query.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      node_id INT DEFAULT NULL,
      zone VARCHAR(255) NOT NULL,
      action VARCHAR(100) NOT NULL,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
    );
  `);

  // Index creation
  try {
    await query.exec(`CREATE INDEX idx_records_zone_id ON records(zone_id);`);
  } catch (err) {
    // Index already exists, safe to ignore
  }

  try {
    await query.exec(`CREATE INDEX idx_sync_logs_zone ON sync_logs(zone(191));`);
  } catch (err) {
    // Index already exists, safe to ignore
  }
}

export default pool;
