#!/bin/bash
# ==============================================================================
# DNSAdmin DirectAdmin Hook Script
# Save this file to: /usr/local/directadmin/scripts/custom/dns_write_post.sh
# Make sure it's executable: chmod 700 /usr/local/directadmin/scripts/custom/dns_write_post.sh
# Owner: chown diradmin:diradmin /usr/local/directadmin/scripts/custom/dns_write_post.sh
# ==============================================================================

# CONFIGURATION
CONTROLLER_URL="http://your-controller-ip:5380/api/v1/agent/sync-zone"
AGENT_TOKEN="your_agent_api_key_here"

# DirectAdmin passes the DOMAIN as an environment variable
if [ -z "$DOMAIN" ]; then
    echo "Error: DOMAIN environment variable is empty."
    exit 1
fi

# Locate the zone file. Standard DA locations:
# /var/named/domain.com.db or /var/named/chroot/var/named/domain.com.db
ZONE_FILE=""
if [ -f "/var/named/${DOMAIN}.db" ]; then
    ZONE_FILE="/var/named/${DOMAIN}.db"
elif [ -f "/var/named/chroot/var/named/${DOMAIN}.db" ]; then
    ZONE_FILE="/var/named/chroot/var/named/${DOMAIN}.db"
elif [ -f "/etc/bind/${DOMAIN}.db" ]; then
    ZONE_FILE="/etc/bind/${DOMAIN}.db"
fi

if [ -z "$ZONE_FILE" ]; then
    echo "Error: DNS Zone file for $DOMAIN could not be found."
    exit 1
fi

# Read zone text
ZONE_TEXT=$(cat "$ZONE_FILE")

# Prepare JSON body (properly escaping JSON quotes & newlines)
# We use Python if installed for secure JSON construction to avoid shell escape issues
if command -v python3 &>/dev/null; then
    python3 -c "
import urllib.request, json
url = '$CONTROLLER_URL'
headers = {
    'Content-Type': 'application/json',
    'X-DNSAdmin-Token': '$AGENT_TOKEN'
}
data = {
    'domain': '$DOMAIN',
    'zone_text': '''$ZONE_TEXT'''
}
req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as res:
        print('DNSAdmin Sync Successful:', res.read().decode())
except Exception as e:
    print('DNSAdmin Sync Failed:', e)
"
else:
    # Fallback to pure bash and curl (caution: potential multiline escape issue)
    # Convert newlines to \n for JSON compatibility
    ESCAPED_ZONE=$(echo "$ZONE_TEXT" | sed -E ':a;N;$!ba;s/\n/\\n/g' | sed 's/"/\\"/g')
    JSON_BODY="{\"domain\":\"$DOMAIN\",\"zone_text\":\"$ESCAPED_ZONE\"}"
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -H "X-DNSAdmin-Token: $AGENT_TOKEN" \
      -d "$JSON_BODY" \
      "$CONTROLLER_URL")
      
    echo "DNSAdmin Curl Response: $RESPONSE"
fi
