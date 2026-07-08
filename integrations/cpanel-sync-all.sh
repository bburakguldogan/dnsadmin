#!/bin/bash
# ==============================================================================
# DNSAdmin cPanel Sync All Domains Script (Pure Bash)
# Save this file to: /usr/local/bin/dnsadmin-cpanel-sync-all.sh
# Make it executable: chmod +x /usr/local/bin/dnsadmin-cpanel-sync-all.sh
# ==============================================================================

HOOK_SCRIPT="/usr/local/bin/dnsadmin-cpanel-hook.sh"

log() {
  echo "[DNSAdmin Sync All] $1" >&2
}

if [ ! -f "$HOOK_SCRIPT" ]; then
  log "Error: Hook script not found at $HOOK_SCRIPT"
  exit 1
fi

log "Scanning cPanel BIND zone files to synchronize all domains..."

for dir in "/var/named" "/var/named/chroot/var/named"; do
  [ -d "$dir" ] || continue
  
  find "$dir" -maxdepth 1 -type f -name "*.db" ! -name "named.*" 2>/dev/null | while read -r filepath; do
    filename=$(basename "$filepath")
    domain="${filename%.db}"
    
    # Must look like a valid domain (contain at least one dot)
    if [[ "$domain" != *.* ]]; then
      continue
    fi
    
    # Exclude default/template zones
    if [[ "$domain" == PROTO.* || "$domain" == localhost* || "$domain" == named.* ]]; then
      continue
    fi
    
    log "Syncing domain: $domain..."
    "$HOOK_SCRIPT" "$domain"
  done
done

log "Full synchronization completed successfully."
