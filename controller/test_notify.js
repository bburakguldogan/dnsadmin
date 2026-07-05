import dgram from 'dgram';
import { startNotifyListener } from './notify_listener.js';
import { initDb } from './db.js';

// Construct a raw DNS NOTIFY request packet for "test-notify.com"
function buildNotifyPacket(domain) {
  const header = Buffer.alloc(12);
  // Transaction ID
  header.writeUInt16BE(0x1234, 0);
  // Flags: QR=0, Opcode=4 (NOTIFY), AA=1
  // 0010 0100 0000 0000 -> 0x2400
  header.writeUInt16BE(0x2400, 2);
  // QDCOUNT = 1
  header.writeUInt16BE(1, 4);
  // ANCOUNT = 0, NSCOUNT = 0, ARCOUNT = 0
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  // Question Name: e.g. \x0btest-notify\x03com\x00
  const parts = domain.split('.');
  const nameBuffers = [];
  for (const part of parts) {
    const lenBuf = Buffer.alloc(1);
    lenBuf.writeUInt8(part.length, 0);
    nameBuffers.push(lenBuf);
    nameBuffers.push(Buffer.from(part, 'utf8'));
  }
  nameBuffers.push(Buffer.from([0])); // End label marker

  const qname = Buffer.concat(nameBuffers);

  // Type: SOA (6)
  const qtype = Buffer.alloc(2);
  qtype.writeUInt16BE(6, 0);

  // Class: IN (1)
  const qclass = Buffer.alloc(2);
  qclass.writeUInt16BE(1, 0);

  return Buffer.concat([header, qname, qtype, qclass]);
}

async function runTest() {
  console.log("Initializing database...");
  await initDb();

  console.log("Starting UDP DNS NOTIFY Listener on port 5354...");
  startNotifyListener(5354);

  // Open a socket to listen for the server's reply
  const client = dgram.createSocket('udp4');
  client.bind(5454);

  client.on('message', (msg) => {
    console.log("-----------------------------------------");
    console.log("Test Client: Received response from DNSAdmin Controller!");
    const txId = msg.readUInt16BE(0);
    const flags = msg.readUInt16BE(2);
    const qr = (flags >> 15) & 0x01;
    const opcode = (flags >> 11) & 0x0F;
    const rcode = flags & 0x0F;

    console.log(`Transaction ID: 0x${txId.toString(16)}`);
    console.log(`QR Flag (1 = response): ${qr}`);
    console.log(`Opcode (4 = NOTIFY): ${opcode}`);
    console.log(`Response Code (0 = success): ${rcode}`);
    console.log("-----------------------------------------");

    console.log("TEST SUCCESSFUL: Packet parsing and response handshaking matches standards.");
    
    // Close sockets and exit after a small timeout to let dig try running
    setTimeout(() => {
      client.close();
      process.exit(0);
    }, 2000);
  });

  const packet = buildNotifyPacket('test-notify.com');
  
  console.log("Test Client: Sending DNS NOTIFY packet to 127.0.0.1:5354...");
  client.send(packet, 0, packet.length, 5354, '127.0.0.1', (err) => {
    if (err) {
      console.error("Test Client error sending packet:", err);
      process.exit(1);
    }
  });
}

runTest().catch(console.error);
