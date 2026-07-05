#!/bin/bash
# ==============================================================================
# DNSAdmin Plesk Hook Script (Pure Bash)
# Save this file to: /usr/local/bin/dnsadmin-plesk-hook.sh
# Make it executable: chmod +x /usr/local/bin/dnsadmin-plesk-hook.sh
# ==============================================================================

# CONFIGURATION
CONTROLLER_API="http://your-controller-ip:5380/api/v1/agent"
AGENT_TOKEN="your_agent_api_key_here"

log() {
  echo "[DNSAdmin Plesk] $1" >&2
}

# Plesk Event Manager passes NEW_ZONE_NAME for create/update, and OLD_ZONE_NAME for delete
DOMAIN="$NEW_ZONE_NAME"
if [ -z "$DOMAIN" ]; then
  DOMAIN="$OLD_ZONE_NAME"
fi

if [ -z "$DOMAIN" ]; then
  # Fallback to CLI argument (e.g. manual trigger)
  if [ -n "$1" ]; then
    DOMAIN="$1"
  else
    log "Error: DOMAIN environment variable is empty."
    exit 1
  fi
fi

log "Processing zone $DOMAIN triggered by Plesk..."

# Allow Plesk Event Manager a small window to fully commit BIND zone records to disk
sleep 2

# Locate BIND zone file in Plesk
ZONE_FILE=""
for path in "/var/named/run-root/var/${DOMAIN}" \
            "/var/named/run-root/var/named/${DOMAIN}" \
            "/var/named/chroot/var/${DOMAIN}" \
            "/var/named/chroot/var/named/${DOMAIN}" \
            "/var/named/${DOMAIN}" \
            "/var/named/${DOMAIN}.db"; do
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
    exit 0
  else
    log "Delete failed for $DOMAIN (HTTP $HTTP_STATUS). Response: $BODY"
    exit 1
  fi
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

# Send update to Controller
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-DNSAdmin-Token: $AGENT_TOKEN" \
  -d "$JSON_BODY" \
  "$CONTROLLER_API/sync-zone")

HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_STATUS" -eq 200 ]; then
  log "Successfully synchronized $DOMAIN. Response: $BODY"
  exit 0
else
  log "Sync failed for $DOMAIN (HTTP $HTTP_STATUS). Response: $BODY"
  exit 1
fi
