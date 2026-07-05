#!/bin/bash
# ==============================================================================
# DNSAdmin Plesk Hook Script (Pure Bash)
# Save this file to: /usr/local/bin/dnsadmin-plesk-hook.sh
# Make it executable: chmod +x /usr/local/bin/dnsadmin-plesk-hook.sh
# ==============================================================================

# CONFIGURATION
CONTROLLER_URL="http://your-controller-ip:5380/api/v1/agent/sync-zone"
AGENT_TOKEN="your_agent_api_key_here"

log() {
  echo "[DNSAdmin Plesk] $1" >&2
}

# Plesk Event Manager passes "NEW_ZONE_NAME" via environment variable
DOMAIN="$NEW_ZONE_NAME"

if [ -z "$DOMAIN" ]; then
  # Fallback to CLI argument (e.g. manual trigger)
  if [ -n "$1" ]; then
    DOMAIN="$1"
  else
    log "Error: NEW_ZONE_NAME environment variable is empty."
    exit 1
  fi
fi

log "Syncing zone $DOMAIN triggered by Plesk..."

# Locate BIND zone file in Plesk
ZONE_FILE=""
for path in "/var/named/run-root/var/named/chroot/var/named/${DOMAIN}" \
            "/var/named/chroot/var/named/${DOMAIN}" \
            "/var/named/${DOMAIN}" \
            "/var/named/${DOMAIN}.db"; do
  if [ -f "$path" ]; then
    ZONE_FILE="$path"
    break
  fi
done

if [ -z "$ZONE_FILE" ]; then
  log "Error: Could not locate zone file for domain '$DOMAIN'"
  exit 1
fi

ZONE_TEXT=$(cat "$ZONE_FILE")

# Escape newlines and double quotes for JSON payload
ESCAPED_ZONE=$(echo "$ZONE_TEXT" | sed -E ':a;N;$!ba;s/\n/\\n/g' | sed 's/"/\\"/g')
JSON_BODY="{\"domain\":\"$DOMAIN\",\"zone_text\":\"$ESCAPED_ZONE\"}"

# Send update to Controller
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-DNSAdmin-Token: $AGENT_TOKEN" \
  -d "$JSON_BODY" \
  "$CONTROLLER_URL")

HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_STATUS" -eq 200 ]; then
  log "Successfully synchronized $DOMAIN. Response: $BODY"
  exit 0
else
  log "Sync failed for $DOMAIN (HTTP $HTTP_STATUS). Response: $BODY"
  exit 1
fi
