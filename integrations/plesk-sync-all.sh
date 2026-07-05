#!/bin/bash
# ==============================================================================
# DNSAdmin Plesk Sync All Domains Script (Pure Bash)
# Save this file to: /usr/local/bin/dnsadmin-plesk-sync-all.sh
# Make it executable: chmod +x /usr/local/bin/dnsadmin-plesk-sync-all.sh
# ==============================================================================

HOOK_SCRIPT="/usr/local/bin/dnsadmin-plesk-hook.sh"

log() {
  echo "[DNSAdmin Sync All] $1" >&2
}

if [ ! -f "$HOOK_SCRIPT" ]; then
  log "Error: Hook script not found at $HOOK_SCRIPT"
  exit 1
fi

log "Scanning Plesk zone directories to synchronize all domains..."

for dir in "/var/named/run-root/var" "/var/named/run-root/var/named" "/var/named/chroot/var" "/var/named/chroot/var/named" "/var/named"; do
  [ -d "$dir" ] || continue
  
  find "$dir" -maxdepth 1 -type f ! -name "named.*" ! -name "*.conf" ! -name "*.key" ! -name "*.ca" ! -name "bind.*" ! -name "*.nzf" 2>/dev/null | while read -r filepath; do
    filename=$(basename "$filepath")
    domain="${filename%.db}"
    
    # Must look like a valid domain (contain at least one dot)
    if [[ "$domain" != *.* ]]; then
      continue
    fi
    
    log "Syncing domain: $domain..."
    "$HOOK_SCRIPT" "$domain"
  done
done

log "Full synchronization completed successfully."
