import dgram from 'dgram';
import { exec } from 'child_process';
import { query } from './db.js';
import { parseZoneFile } from './zoneparser.js';
import { pushZoneToNodes } from './routes.js';

export function startNotifyListener(port = 5353) {
  const server = dgram.createSocket('udp4');

  server.on('message', async (msg, rinfo) => {
    try {
      if (msg.length < 12) return; // DNS Header is 12 bytes minimum

      // Parse Transaction ID
      const txId = msg.readUInt16BE(0);
      
      // Parse Flags
      const flags = msg.readUInt16BE(2);
      const qr = (flags >> 15) & 0x01; // 0 = Request, 1 = Response
      const opcode = (flags >> 11) & 0x0F; // Opcode: 4 = NOTIFY

      if (qr === 0 && opcode === 4) {
        // It's an incoming DNS NOTIFY request!
        // Decode the domain name from the Question Section
        let offset = 12;
        let domain = '';
        
        while (offset < msg.length) {
          const len = msg[offset];
          if (len === 0) {
            offset++;
            break;
          }
          if (offset + 1 + len > msg.length) {
            throw new Error('Malformed DNS packet label');
          }
          if (domain.length > 0) domain += '.';
          domain += msg.toString('utf8', offset + 1, offset + 1 + len);
          offset += 1 + len;
        }

        const senderIp = rinfo.address;
        console.log(`[NOTIFY] Received DNS NOTIFY for '${domain}' from master: ${senderIp}:${rinfo.port}`);

        // Basic domain name sanitization to prevent command injection
        if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
          console.warn(`[NOTIFY] Ignored invalid domain: ${domain}`);
          return;
        }

        // Validate if the sender is a registered web hosting server (master) in SQLite
        // In local development or tests, we allow loopback IPs as well
        const isLocalLoopback = senderIp === '127.0.0.1' || senderIp === '::1';
        const serverReg = await query.get(
          'SELECT * FROM servers WHERE ip = ? AND status = "active"',
          [senderIp]
        );

        if (!serverReg && !isLocalLoopback) {
          console.warn(`[NOTIFY] Ignored NOTIFY: Sender IP ${senderIp} is not registered or active`);
          return;
        }

        // Acknowledge the NOTIFY immediately by sending a standard DNS Response
        // We set the QR bit (bit 15) of flags to 1 (response)
        const responseBuf = Buffer.from(msg);
        responseBuf[2] = responseBuf[2] | 0x80; // QR = 1
        
        server.send(responseBuf, 0, responseBuf.length, rinfo.port, rinfo.address, (err) => {
          if (err) console.error(`[NOTIFY] Error sending response to ${senderIp}:`, err.message);
        });

        // Trigger AXFR pull asynchronously using standard "dig" utility
        console.log(`[NOTIFY] Querying master ${senderIp} for AXFR zone transfer of ${domain}...`);
        
        // Execute dig command
        exec(`dig @${senderIp} ${domain} AXFR`, { timeout: 10000 }, async (error, stdout, stderr) => {
          if (error) {
            console.error(`[NOTIFY] dig AXFR failed: ${error.message}`);
            await query.run(
              'INSERT INTO sync_logs (node_id, zone, action, message) VALUES (NULL, ?, ?, ?)',
              [domain, 'axfr_failed', `AXFR pull failed: ${error.message}`]
            );
            return;
          }

          if (stderr && stderr.includes('connection timed out')) {
            console.error(`[NOTIFY] dig AXFR timed out linking to ${senderIp}`);
            return;
          }

          try {
            // Parse BIND zone text output from stdout
            const parsedRecords = parseZoneFile(stdout, domain);
            
            if (parsedRecords.length === 0) {
              console.warn(`[NOTIFY] AXFR parsed 0 records for ${domain}. Zone transfer might be disallowed on master.`);
              await query.run(
                'INSERT INTO sync_logs (node_id, zone, action, message) VALUES (NULL, ?, ?, ?)',
                [domain, 'axfr_failed', 'AXFR returned 0 records. Check zone transfer permissions on cPanel/Plesk.']
              );
              return;
            }

            console.log(`[NOTIFY] AXFR successfully pulled ${parsedRecords.length} records for ${domain}`);

            // Find or create zone in SQLite
            let zone = await query.get('SELECT * FROM zones WHERE domain = ?', [domain]);
            let zoneId;
            let serial = 2026070501;

            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

            await query.run('BEGIN TRANSACTION');

            if (zone) {
              zoneId = zone.id;
              // Extract serial from parsed SOA if available, otherwise increment
              const parsedSoa = parsedRecords.find(r => r.type === 'SOA');
              if (parsedSoa) {
                const parts = parsedSoa.content.split(/\s+/);
                if (parts.length >= 3) {
                  serial = parseInt(parts[2], 10) || zone.serial;
                }
              } else {
                serial = parseInt(`${today}01`);
                if (String(zone.serial).startsWith(today)) {
                  serial = zone.serial + 1;
                }
              }
              await query.run('UPDATE zones SET serial = ?, last_sync = datetime("now") WHERE id = ?', [serial, zoneId]);
              await query.run('DELETE FROM records WHERE zone_id = ?', [zoneId]);
            } else {
              const result = await query.run(
                'INSERT INTO zones (domain, serial, last_sync) VALUES (?, ?, datetime("now"))',
                [domain, serial]
              );
              zoneId = result.id;
            }

            // Insert records
            for (const r of parsedRecords) {
              if (r.type === 'SOA') continue; // We write our own SOA serial management
              await query.run(
                'INSERT INTO records (zone_id, name, type, content, ttl, priority) VALUES (?, ?, ?, ?, ?, ?)',
                [zoneId, r.name, r.type, r.content, r.ttl, r.priority]
              );
            }

            await query.run('COMMIT');

            // Log successful pull
            await query.run(
              'INSERT INTO sync_logs (node_id, zone, action, message) VALUES (NULL, ?, ?, ?)',
              [domain, 'axfr_success', `AXFR pull succeeded from master. Records count: ${parsedRecords.length}`]
            );

            // Push updates immediately to all Nameserver Nodes
            await pushZoneToNodes(domain);

            // Update master server last sync log
            if (serverReg) {
              await query.run('UPDATE servers SET last_sync = datetime("now") WHERE id = ?', [serverReg.id]);
            }

          } catch (err) {
            await query.run('ROLLBACK');
            console.error(`[NOTIFY] Error storing AXFR zone ${domain}:`, err.message);
          }
        });
      }
    } catch (err) {
      console.error('[NOTIFY] Error processing UDP DNS packet:', err.message);
    }
  });

  server.on('error', (err) => {
    console.error('[NOTIFY] UDP Server error:', err.message);
    server.close();
  });

  server.bind(port, () => {
    console.log(`[NOTIFY] DNS NOTIFY UDP listener running on port ${port}`);
  });
}
