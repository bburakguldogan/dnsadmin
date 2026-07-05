import { parseZoneFile, generateZoneFile } from './zoneparser.js';

const mockZone = `
$ORIGIN example.com.
$TTL 86400
@   IN  SOA ns1.example.com. admin.example.com. (
            2026070401 ; serial
            3600       ; refresh
            1800       ; retry
            604800     ; expire
            86400      ; minimum
        )
@   IN  NS  ns1.example.com.
@   IN  NS  ns2.example.com.
@   IN  A   192.168.1.100
www IN  A   192.168.1.100
mail IN A   192.168.1.101
@   IN  MX  10 mail
txt IN  TXT "v=spf1 ip4:192.168.1.100 -all"
_sip._tcp IN SRV 10 20 5060 sipdir.example.com.
`;

try {
  console.log("Parsing mock zone...");
  const records = parseZoneFile(mockZone, 'example.com');
  console.log("Parsed Records:", JSON.stringify(records, null, 2));

  console.log("\nRe-generating zone file...");
  const compiled = generateZoneFile('example.com', records, 2026070402);
  console.log("Compiled Zone File:\n", compiled);
  console.log("TEST SUCCESSFUL!");
} catch (e) {
  console.error("TEST FAILED:", e);
}
