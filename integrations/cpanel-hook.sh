#!/bin/bash
# ==============================================================================
# DNSAdmin cPanel Hook Script (Pure Bash)
# Save this file to: /usr/local/bin/dnsadmin-cpanel-hook.sh
# Make it executable: chmod +x /usr/local/bin/dnsadmin-cpanel-hook.sh
# ==============================================================================

# CONFIGURATION
CONTROLLER_API="http://your-controller-ip:5380/api/v1/agent"
AGENT_TOKEN="your_agent_api_key_here"

log() {
  echo "[DNSAdmin Hook] $1" >&2
}

# cPanel standardized hooks pass input JSON via stdin. Let's read it.
read -r -t 2 STDIN_JSON

# Fallback: Check if domain was passed as CLI argument (manual sync)
DOMAIN=""
if [ -n "$1" ]; then
  DOMAIN="$1"
elif [ -n "$STDIN_JSON" ]; then
  # Extract domain name using sed (robust regex matching "domain":"domain.com" or "domainname":"domain.com")
  DOMAIN=$(echo "$STDIN_JSON" | sed -n 's/.*"domain":"\([^"]*\)".*/\1/p')
  if [ -z "$DOMAIN" ]; then
    DOMAIN=$(echo "$STDIN_JSON" | sed -n 's/.*"domainname":"\([^"]*\)".*/\1/p')
  fi
fi

if [ -z "$DOMAIN" ]; then
  log "Error: Could not parse domain name from hook inputs."
  exit 0 # Exit 0 to prevent blocking WHM in case of metadata queries
fi

log "Processing domain: $DOMAIN"

# Locate zone file in standard cPanel paths
ZONE_FILE=""
for path in "/var/named/${DOMAIN}.db" "/var/named/chroot/var/named/${DOMAIN}.db" "/var/named/${DOMAIN}"; do
  if [ -f "$path" ]; then
    ZONE_FILE="$path"
    break
  fi
done

# If zone file is missing, treat as a DELETION
if [ -z "$ZONE_FILE" ]; then
  log "Zone file not found. Sending DELETE request for $DOMAIN..."
  
  JSON_BODY="{\"domain\":\"$DOMAIN\"}"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-DNSAdmin-Token: $AGENT_TOKEN" \
    -d "$JSON_BODY" \
    "$CONTROLLER_API/delete-zone")
    
  HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1)
  BODY=$(echo "$RESPONSE" | head -n -1)
  
  if [ "$HTTP_STATUS" -eq 200 ]; then
    log "Successfully deleted zone $DOMAIN. Response: $BODY"
  else
    log "Delete failed for $DOMAIN (HTTP $HTTP_STATUS). Response: $BODY"
  fi
  exit 0
fi

# If zone file exists, sync it
ZONE_TEXT=$(cat "$ZONE_FILE")

# Safely build JSON payload escaping all control characters, tabs, and newlines
if command -v python3 &>/dev/null; then
  JSON_BODY=$(python3 -c 'import sys, json; print(json.dumps({"domain": sys.argv[1], "zone_text": sys.argv[2]}))' "$DOMAIN" "$ZONE_TEXT")
elif command -v python &>/dev/null; then
  JSON_BODY=$(python -c 'import sys, json; print(json.dumps({"domain": sys.argv[1], "zone_text": sys.argv[2]}))' "$DOMAIN" "$ZONE_TEXT")
else
  # Fallback to shell escaping: clean backslashes, carriage returns, quotes, join lines, escape tabs
  ESCAPED_ZONE=$(echo "$ZONE_TEXT" | tr -d '\r' | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\t/\\t/g')
  JSON_BODY="{\"domain\":\"$DOMAIN\",\"zone_text\":\"$ESCAPED_ZONE\"}"
fi

# POST to DNSAdmin Controller
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-DNSAdmin-Token: $AGENT_TOKEN" \
  -d "$JSON_BODY" \
  "$CONTROLLER_API/sync-zone")

HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_STATUS" -eq 200 ]; then
  log "Sync successful for $DOMAIN. Response: $BODY"
else
  log "Sync failed for $DOMAIN (HTTP $HTTP_STATUS). Response: $BODY"
fi

exit 0
