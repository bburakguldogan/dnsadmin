#!/bin/bash
# ==============================================================================
# DNSAdmin - One-Click Master Installer Script
# Works on Debian/Ubuntu and RHEL/CentOS/AlmaLinux/CloudLinux
# Must be executed as root.
#
# If run on a clean remote server, it automatically downloads/clones the 
# codebase from the specified Git repository.
# ==============================================================================

# DEFAULT GIT REPOSITORY (Change this to your actual repository URL)
DEFAULT_REPO_URL="https://github.com/bburakguldogan/dnsadmin.git"

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run this installation script as root (sudo)."
  exit 1
fi

show_help() {
  echo "DNSAdmin One-Click Installer"
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --role <role>            Roles: controller, node, cpanel, plesk, directadmin"
  echo "  --controller-url <url>   URL of the central controller (Required for node/panel roles)"
  echo "  --token <token>          API Key / Secret Token (Required for node/panel roles)"
  echo "  --repo-url <url>         Override Git Repository URL for codebase downloads"
  echo "  --port <port>            Custom port (optional)"
  echo "  --notify-port <port>     UDP DNS NOTIFY listener port (default: 53, optional)"
  echo "  --ns-name <nameserver>   Nameserver Hostname (e.g. ns1.domain.com, required for node)"
  echo "  -h, --help               Show this help menu"
  echo ""
  echo "Examples:"
  echo "  # Install Central Controller Panel:"
  echo "  $0 --role controller --port 5380 --notify-port 53"
  echo ""
  echo "  # Install Nameserver Node (ns1 / ns2):"
  echo "  $0 --role node --controller-url http://1.2.3.4:5380 --token node_xyz123 --ns-name ns1.domain.com"
  echo ""
  echo "  # Install cPanel Hook Integration:"
  echo "  $0 --role cpanel --controller-url http://1.2.3.4:5380 --token agent_abc123"
}

# Parse command line options
ROLE=""
CONTROLLER_URL=""
TOKEN=""
PORT=""
NOTIFY_PORT=""
NS_NAME=""
REPO_URL="$DEFAULT_REPO_URL"

while [[ $# -gt 0 ]]; do
  case $1 in
    --role)
      ROLE="$2"
      shift 2
      ;;
    --controller-url)
      CONTROLLER_URL="$2"
      shift 2
      ;;
    --token)
      TOKEN="$2"
      shift 2
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --notify-port)
      NOTIFY_PORT="$2"
      shift 2
      ;;
    --ns-name)
      NS_NAME="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

if [ -z "$ROLE" ]; then
  echo "Error: --role option is required."
  show_help
  exit 1
fi

# Detect package manager
if command -v apt-get &>/dev/null; then
  PKG_MAN="apt"
elif command -v dnf &>/dev/null; then
  PKG_MAN="dnf"
elif command -v yum &>/dev/null; then
  PKG_MAN="yum"
else
  PKG_MAN="unknown"
fi

install_nodejs() {
  NEED_INSTALL=0
  if ! command -v node &>/dev/null; then
    NEED_INSTALL=1
  else
    # Check current Node version
    CURRENT_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$CURRENT_VERSION" -lt 18 ]; then
      echo "Found outdated Node.js version: v$CURRENT_VERSION. Upgrading to Node.js v20..."
      NEED_INSTALL=1
    fi
  fi

  if [ "$NEED_INSTALL" -eq 1 ]; then
    echo "Installing modern Node.js & npm..."
    if [ "$PKG_MAN" == "apt" ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    elif [ "$PKG_MAN" == "dnf" ] || [ "$PKG_MAN" == "yum" ]; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      $PKG_MAN install -y nodejs
    else
      echo "Error: Node.js is outdated (< v18). Please upgrade Node.js manually."
      exit 1
    fi
  fi
}

# Prepare sources directory
SRC_DIR="."
if [ ! -d "controller" ] || [ ! -d "node-agent" ] || [ ! -d "integrations" ]; then
  echo "Local DNSAdmin codebase folders not found in current directory."
  echo "Checking out latest codebase from Git repository: $REPO_URL..."

  # Install git if not present
  if ! command -v git &>/dev/null; then
    echo "Git not found. Installing Git..."
    if [ "$PKG_MAN" == "apt" ]; then
      apt-get update && apt-get install -y git
    elif [ "$PKG_MAN" == "dnf" ] || [ "$PKG_MAN" == "yum" ]; then
      $PKG_MAN install -y git
    else
      echo "Error: git is not installed and cannot be installed automatically."
      exit 1
    fi
  fi

  # Clone repository
  rm -rf /tmp/dnsadmin-source
  git clone "$REPO_URL" /tmp/dnsadmin-source
  
  if [ ! -d "/tmp/dnsadmin-source/controller" ]; then
    echo "Error: Failed to clone repository or invalid repository structure."
    exit 1
  fi
  
  SRC_DIR="/tmp/dnsadmin-source"
fi

# ==========================================
# ROLE: CONTROLLER INSTALLATION
# ==========================================
if [ "$ROLE" == "controller" ]; then
  echo "Installing DNSAdmin Controller Panel..."
  install_nodejs

  # Setup defaults
  CTRL_PORT=${PORT:-5380}
  CTRL_NOTIFY_PORT=${NOTIFY_PORT:-53}
  INSTALL_DIR="/opt/dnsadmin-controller"

  # MySQL Provisioning
  echo "Checking MySQL/MariaDB database server..."
  if ! command -v mysql &>/dev/null; then
    echo "MySQL client/server not found. Installing MariaDB Server..."
    if [ "$PKG_MAN" == "apt" ]; then
      apt-get update && apt-get install -y mariadb-server
    elif [ "$PKG_MAN" == "dnf" ] || [ "$PKG_MAN" == "yum" ]; then
      $PKG_MAN install -y mariadb-server
    else
      echo "Warning: package manager not supported. Please install MariaDB server manually."
    fi
  fi

  # Enable and start DB service
  DB_SERVICE="mariadb"
  if [ "$PKG_MAN" == "apt" ]; then
    if systemctl list-unit-files | grep -q mariadb; then
      DB_SERVICE="mariadb"
    else
      DB_SERVICE="mysql"
    fi
  fi

  echo "Starting and enabling $DB_SERVICE service..."
  systemctl enable "$DB_SERVICE" &>/dev/null
  systemctl start "$DB_SERVICE" &>/dev/null

  # Generate random password
  DB_PASS=$(openssl rand -hex 12 2>/dev/null || echo "dnsadmin_pass_$(date +%s)")
  
  echo "Configuring MySQL Database 'dnsadmin'..."
  # Execute commands as root via socket authentication
  mysql -u root -e "CREATE DATABASE IF NOT EXISTS dnsadmin;"
  mysql -u root -e "CREATE USER IF NOT EXISTS 'dnsadmin'@'localhost' IDENTIFIED BY '${DB_PASS}';"
  mysql -u root -e "GRANT ALL PRIVILEGES ON dnsadmin.* TO 'dnsadmin'@'localhost';"
  mysql -u root -e "FLUSH PRIVILEGES;"

  # Stop existing service if running
  if systemctl is-active --quiet dnsadmin-controller; then
    echo "Stopping existing dnsadmin-controller service..."
    systemctl stop dnsadmin-controller
  fi

  # Copy files
  mkdir -p "$INSTALL_DIR"
  echo "Copying Controller codebase..."
  cp -r "$SRC_DIR/controller/"* "$INSTALL_DIR/"

  # Install npm packages
  echo "Installing dependencies..."
  cd "$INSTALL_DIR" || exit 1
  npm install --omit=dev

  # Locate node path (check standard paths and EasyApache paths for cPanel)
  NODE_PATH=$(which node 2>/dev/null || echo "/usr/bin/node")
  for ea_node in /opt/cpanel/ea-nodejs20/bin/node /opt/cpanel/ea-nodejs18/bin/node /opt/cpanel/ea-nodejs16/bin/node; do
    if [ -x "$ea_node" ]; then
      NODE_PATH="$ea_node"
      echo "Found EasyApache Node.js binary at $NODE_PATH"
      break
    fi
  done

  # Create systemd service
  echo "Creating systemd service daemon..."
  cat <<EOF > /etc/systemd/system/dnsadmin-controller.service
[Unit]
Description=DNSAdmin Central Controller
After=network.target $DB_SERVICE.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=PORT=$CTRL_PORT
Environment=NOTIFY_PORT=$CTRL_NOTIFY_PORT
Environment=JWT_SECRET=dnsadmin-sec-$(openssl rand -hex 16 2>/dev/null || echo "fallback-sec-123")
Environment=MYSQL_HOST=127.0.0.1
Environment=MYSQL_PORT=3306
Environment=MYSQL_USER=dnsadmin
Environment=MYSQL_PASSWORD=$DB_PASS
Environment=MYSQL_DATABASE=dnsadmin
ExecStart=$NODE_PATH server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

  # Reload systemd and start
  systemctl daemon-reload
  systemctl enable dnsadmin-controller
  systemctl start dnsadmin-controller

  echo "=================================================="
  echo " DNSAdmin Controller successfully installed!"
  echo " Web URL: http://your-ip:$CTRL_PORT"
  echo " UDP DNS NOTIFY port: $CTRL_NOTIFY_PORT"
  echo " Database Name: dnsadmin"
  echo " Database User: dnsadmin"
  echo " Database Pass: $DB_PASS"
  echo " Status: $(systemctl is-active dnsadmin-controller)"
  echo "=================================================="

# ==========================================
# ROLE: NAMESERVER NODE INSTALLATION
# ==========================================
elif [ "$ROLE" == "node" ]; then
  if [ -z "$CONTROLLER_URL" ] || [ -z "$TOKEN" ] || [ -z "$NS_NAME" ]; then
    echo "Error: --controller-url, --token, and --ns-name options are required for nameserver node setup."
    exit 1
  fi

  echo "Installing DNSAdmin Node Agent..."
  install_nodejs

  NODE_PORT=${PORT:-5300}
  INSTALL_DIR="/opt/dnsadmin-node"
  ZONES_DIR="$INSTALL_DIR/zones"
  NAMED_CONF="$INSTALL_DIR/dnsadmin.zones"

  # 1. Install BIND 9 DNS server
  echo "Installing BIND 9 DNS Daemon..."
  BIND_SERVICE="named"
  if [ "$PKG_MAN" == "apt" ]; then
    apt-get update
    apt-get install -y bind9 bind9utils
    BIND_SERVICE="bind9"
    BIND_CONF_LOCAL="/etc/bind/named.conf.local"
  elif [ "$PKG_MAN" == "dnf" ] || [ "$PKG_MAN" == "yum" ]; then
    $PKG_MAN install -y bind bind-utils
    BIND_SERVICE="named"
    BIND_CONF_LOCAL="/etc/named.conf"
  else
    echo "Warning: Unknown OS. Please configure BIND manually."
  fi

  # Create directories
  mkdir -p "$ZONES_DIR"
  touch "$NAMED_CONF"
  chown -R root:root "$INSTALL_DIR"
  
  # Set BIND user permissions to let named read the directories
  if [ "$BIND_SERVICE" == "bind9" ]; then
    chown -R bind:bind "$ZONES_DIR"
    chown bind:bind "$NAMED_CONF"
  else
    chown -R named:named "$ZONES_DIR"
    chown named:named "$NAMED_CONF"
  fi

  # 2. Append include file in local BIND configuration if not present
  if [ -f "$BIND_CONF_LOCAL" ]; then
    if ! grep -q "$NAMED_CONF" "$BIND_CONF_LOCAL"; then
      echo "Integrating configuration into BIND server..."
      echo -e "\ninclude \"$NAMED_CONF\";" >> "$BIND_CONF_LOCAL"
    fi
  fi

  # Copy node codebase
  if systemctl is-active --quiet dnsadmin-node-agent; then
    systemctl stop dnsadmin-node-agent
  fi
  cp -r "$SRC_DIR/node-agent/"* "$INSTALL_DIR/"

  # Install npm packages
  cd "$INSTALL_DIR" || exit 1
  npm install --omit=dev

  # Locate node path (check standard paths and EasyApache paths for cPanel)
  NODE_PATH=$(which node 2>/dev/null || echo "/usr/bin/node")
  for ea_node in /opt/cpanel/ea-nodejs20/bin/node /opt/cpanel/ea-nodejs18/bin/node /opt/cpanel/ea-nodejs16/bin/node; do
    if [ -x "$ea_node" ]; then
      NODE_PATH="$ea_node"
      echo "Found EasyApache Node.js binary at $NODE_PATH"
      break
    fi
  done

  # Create systemd service
  cat <<EOF > /etc/systemd/system/dnsadmin-node-agent.service
[Unit]
Description=DNSAdmin Nameserver Node Agent
After=network.target $BIND_SERVICE.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=PORT=$NODE_PORT
Environment=DNSADMIN_TOKEN=$TOKEN
Environment=DNSADMIN_CONTROLLER_URL=$CONTROLLER_URL
Environment=NODE_NAME=$NS_NAME
Environment=ZONES_DIR=$ZONES_DIR
Environment=NAMED_CONF_PATH=$NAMED_CONF
Environment=RELOAD_CMD="systemctl reload $BIND_SERVICE"
ExecStart=$NODE_PATH agent.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

  # Reload systemd and start BIND & Node Agent
  systemctl daemon-reload
  systemctl enable "$BIND_SERVICE"
  systemctl restart "$BIND_SERVICE"
  systemctl enable dnsadmin-node-agent
  systemctl start dnsadmin-node-agent

  echo "=================================================="
  echo " DNSAdmin Node Agent successfully installed!"
  echo " Nameserver Name: $NS_NAME"
  echo " Agent Port: $NODE_PORT"
  echo " BIND DNS Server Status: $(systemctl is-active $BIND_SERVICE)"
  echo " Node Agent Status: $(systemctl is-active dnsadmin-node-agent)"
  echo "=================================================="

# ==========================================
# ROLE: CPANEL HOOK INSTALLATION
# ==========================================
elif [ "$ROLE" == "cpanel" ]; then
  if [ -z "$CONTROLLER_URL" ] || [ -z "$TOKEN" ]; then
    echo "Error: --controller-url and --token are required for cPanel setup."
    exit 1
  fi

  echo "Registering cPanel DNS Hook (Bash)..."
  DEST="/usr/local/bin/dnsadmin-cpanel-hook.sh"

  # Copy hook script
  cp "$SRC_DIR/integrations/cpanel-hook.sh" "$DEST"
  chmod +x "$DEST"

  # Inject credentials into Bash script via sed
  sed -i "s|CONTROLLER_API=\"http://your-controller-ip:5380/api/v1/agent\"|CONTROLLER_API=\"$CONTROLLER_URL/api/v1/agent\"|g" "$DEST"
  sed -i "s|AGENT_TOKEN=\"your_agent_api_key_here\"|AGENT_TOKEN=\"$TOKEN\"|g" "$DEST"

  # Register hooks in WHM hook manager
  /usr/local/cpanel/bin/manage_hooks add script "$DEST" --manual --category Whostmgr --event 'DNS::zone' --stage post
  /usr/local/cpanel/bin/manage_hooks add script "$DEST" --manual --category Cpanel --event 'Zone::*' --stage post

  echo "cPanel hook integration installed and registered successfully."

# ==========================================
# ROLE: PLESK HOOK INSTALLATION
# ==========================================
elif [ "$ROLE" == "plesk" ]; then
  if [ -z "$CONTROLLER_URL" ] || [ -z "$TOKEN" ]; then
    echo "Error: --controller-url and --token are required for Plesk setup."
    exit 1
  fi

  if ! command -v plesk &>/dev/null; then
    echo "Error: Plesk CLI utility not found on this server."
    exit 1
  fi

  echo "Registering Plesk Event Hook (Bash)..."
  DEST="/usr/local/bin/dnsadmin-plesk-hook.sh"

  # Copy hook script
  cp "$SRC_DIR/integrations/plesk-hook.sh" "$DEST"
  chmod +x "$DEST"

  # Inject credentials via sed
  sed -i "s|CONTROLLER_API=\"http://your-controller-ip:5380/api/v1/agent\"|CONTROLLER_API=\"$CONTROLLER_URL/api/v1/agent\"|g" "$DEST"
  sed -i "s|AGENT_TOKEN=\"your_agent_api_key_here\"|AGENT_TOKEN=\"$TOKEN\"|g" "$DEST"

  # Register handlers via plesk bin event_handler
  plesk bin event_handler --create -event "dns_zone_created" -priority 50 -user root -command "$DEST"
  plesk bin event_handler --create -event "dns_zone_updated" -priority 50 -user root -command "$DEST"
  plesk bin event_handler --create -event "dns_zone_deleted" -priority 50 -user root -command "$DEST"

  echo "Plesk event handler hooks registered successfully."

# ==========================================
# ROLE: DIRECTADMIN HOOK INSTALLATION
# ==========================================
elif [ "$ROLE" == "directadmin" ]; then
  if [ -z "$CONTROLLER_URL" ] || [ -z "$TOKEN" ]; then
    echo "Error: --controller-url and --token are required for DirectAdmin setup."
    exit 1
  fi

  echo "Registering DirectAdmin DNS Hooks..."
  
  DA_WRITE_DEST="/usr/local/directadmin/scripts/custom/dns_write_post.sh"
  DA_DELETE_DEST="/usr/local/directadmin/scripts/custom/dns_delete_post.sh"

  # Copy scripts
  cp "$SRC_DIR/integrations/da-hook.sh" "$DA_WRITE_DEST"
  cp "$SRC_DIR/integrations/da-delete-hook.sh" "$DA_DELETE_DEST"

  # Set owner and permissions
  chown diradmin:diradmin "$DA_WRITE_DEST" "$DA_DELETE_DEST"
  chmod 700 "$DA_WRITE_DEST" "$DA_DELETE_DEST"

  # Inject credentials via sed
  sed -i "s|CONTROLLER_URL=\"http://your-controller-ip:5380/api/v1/agent/sync-zone\"|CONTROLLER_URL=\"$CONTROLLER_URL/api/v1/agent/sync-zone\"|g" "$DA_WRITE_DEST"
  sed -i "s|AGENT_TOKEN=\"your_agent_api_key_here\"|AGENT_TOKEN=\"$TOKEN\"|g" "$DA_WRITE_DEST"

  sed -i "s|CONTROLLER_URL=\"http://your-controller-ip:5380/api/v1/agent/delete-zone\"|CONTROLLER_URL=\"$CONTROLLER_URL/api/v1/agent/delete-zone\"|g" "$DA_DELETE_DEST"
  sed -i "s|AGENT_TOKEN=\"your_agent_api_key_here\"|AGENT_TOKEN=\"$TOKEN\"|g" "$DA_DELETE_DEST"

  echo "DirectAdmin write/delete hook integrations registered successfully."

else
  echo "Error: Unknown role '$ROLE'."
  show_help
  exit 1
fi

# Cleanup temporary git source folder if used
if [ "$SRC_DIR" == "/tmp/dnsadmin-source" ]; then
  echo "Cleaning up temporary installation files..."
  rm -rf /tmp/dnsadmin-source
fi
