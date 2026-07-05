#!/bin/bash
# ==============================================================================
# DNSAdmin DirectAdmin Zone Deletion Hook Script
# Save this file to: /usr/local/directadmin/scripts/custom/dns_delete_post.sh
# Make sure it's executable: chmod 700 /usr/local/directadmin/scripts/custom/dns_delete_post.sh
# Owner: chown diradmin:diradmin /usr/local/directadmin/scripts/custom/dns_delete_post.sh
# ==============================================================================

# CONFIGURATION
CONTROLLER_URL="http://your-controller-ip:5380/api/v1/agent/delete-zone"
AGENT_TOKEN="your_agent_api_key_here"

# DirectAdmin passes the DOMAIN as an environment variable
if [ -z "$DOMAIN" ]; then
    echo "Error: DOMAIN environment variable is empty."
    exit 1
fi

# Send delete notification to DNSAdmin Controller
if command -v python3 &>/dev/null; then
    python3 -c "
import urllib.request, json
url = '$CONTROLLER_URL'
headers = {
    'Content-Type': 'application/json',
    'X-DNSAdmin-Token': '$AGENT_TOKEN'
}
data = {
    'domain': '$DOMAIN'
}
req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as res:
        print('DNSAdmin Zone Deletion Sync Successful:', res.read().decode())
except Exception as e:
    print('DNSAdmin Zone Deletion Sync Failed:', e)
"
else:
    JSON_BODY="{\"domain\":\"$DOMAIN\"}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -H "X-DNSAdmin-Token: $AGENT_TOKEN" \
      -d "$JSON_BODY" \
      "$CONTROLLER_URL")
      
    echo "DNSAdmin Delete Response: $RESPONSE"
fi
