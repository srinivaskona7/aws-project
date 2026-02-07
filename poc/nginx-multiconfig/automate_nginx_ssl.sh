#!/bin/bash

# Configuration
EMAIL="admin@srinivaskona.life" # Default email for Certbot

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO] $1${NC}"; }
log_success() { echo -e "${GREEN}[SUCCESS] $1${NC}"; }
log_error() { echo -e "${RED}[ERROR] $1${NC}"; }

echo "----------------------------------------------------------------"
echo "   Nginx SSL Automation Script (Architect Grade)   "
echo "----------------------------------------------------------------"

# 0. System Check & Installation
echo ""
log_info "Phase 0: System Check & Installation"

# Check Nginx
if ! command -v nginx &> /dev/null; then
    log_info "Nginx not found. Installing..."
    if sudo dnf install nginx -y; then
        log_success "Nginx Installed."
        sudo systemctl enable --now nginx
    else
        log_error "Failed to install Nginx."
        exit 1
    fi
else
    log_success "Nginx is already installed."
    if ! systemctl is-active --quiet nginx; then
        log_info "Starting Nginx..."
        sudo systemctl start nginx
    fi
fi

# Check Certbot
if ! command -v certbot &> /dev/null; then
    log_info "Certbot not found. Installing..."
    if sudo dnf install certbot python3-certbot-nginx -y; then
        log_success "Certbot Installed."
    else
        log_error "Failed to install Certbot."
        exit 1
    fi
else
    log_success "Certbot is already installed."
fi

# 1. Input Processing
echo ""
log_info "Phase 1: Domain Input Processing"

DOMAINS=()
if [ $# -gt 0 ]; then
    log_info "Mode: Argument Input"
    DOMAINS=("$@")
else
    log_info "Mode: Interactive Input"
    while true; do
      echo ""
      read -p "Enter Domain Name (e.g., sri1.srinivaskona.life) [Press Enter to Finish]: " SC_DOMAIN
      SC_DOMAIN=$(echo "$SC_DOMAIN" | xargs)
      [[ -z "$SC_DOMAIN" ]] && break
      DOMAINS+=("$SC_DOMAIN")
    done
fi

if [ ${#DOMAINS[@]} -eq 0 ]; then
    log_error "No domains entered. Usage: ./script.sh [domain1] [domain2]"
    exit 0
fi

echo ""
echo "----------------------------------------------------------------"
log_info "Processing ${#DOMAINS[@]} domains..."
echo "----------------------------------------------------------------"

# 2. Loop through domains for Setup
for DOMAIN in "${DOMAINS[@]}"; do
  echo ""
  log_info ">>> Processing: $DOMAIN"
  
  SLUG=$(echo "$DOMAIN" | tr '.' '-')
  WEB_ROOT="/var/www/$SLUG"
  CONF_FILE="/etc/nginx/conf.d/$SLUG.conf"
  HTML_FILE="$WEB_ROOT/index.html"
  
  # 2.1 Create Content
  if [ -d "$WEB_ROOT" ]; then
      log_info "Web root already exists: $WEB_ROOT"
  else
      log_info "Creating web root..."
      sudo mkdir -p "$WEB_ROOT"
      sudo chmod 755 "$WEB_ROOT"
  fi
  
  log_info "Generating HTML Content..."
  echo "<html><head><title>$DOMAIN</title></head><body><h1>$DOMAIN ($SLUG)</h1></body></html>" | sudo tee "$HTML_FILE" > /dev/null
  log_success "HTML File Created: $HTML_FILE"

  # 2.2 Create Nginx Config (HTTP)
  if [ -f "$CONF_FILE" ]; then
      log_info "Config exists: $CONF_FILE"
      if grep -q "ssl_certificate" "$CONF_FILE"; then
          log_info "SSL already configured. Skipping overwrite."
      else
          log_info "Overwriting HTTP config..."
          sudo tee "$CONF_FILE" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    index index.html;
    location / { try_files \$uri \$uri/ =404; }
}
EOF
          log_success "Nginx Config Updated: $CONF_FILE"
      fi
  else
      log_info "Creating Nginx HTTP Config..."
      sudo tee "$CONF_FILE" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    index index.html;
    location / { try_files \$uri \$uri/ =404; }
}
EOF
      log_success "Nginx Config Created: $CONF_FILE"
  fi

done

# 3. Reload Nginx
echo ""
echo "----------------------------------------------------------------"
log_info "Phase 3: Verifying Nginx Configuration"
echo "----------------------------------------------------------------"

if sudo nginx -t; then
    log_success "Nginx syntax is clean. Reloading..."
    sudo systemctl reload nginx
else
    log_error "Nginx syntax check failed. Aborting."
    exit 1
fi

# 4. Run Certbot
echo ""
echo "----------------------------------------------------------------"
log_info "Phase 4: SSL Automation (Certbot)"
echo "----------------------------------------------------------------"

for DOMAIN in "${DOMAINS[@]}"; do
  log_info "Requesting Certificate for: $DOMAIN"
  
  sudo certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect \
    --keep-until-expiring

  if [ $? -eq 0 ]; then
      log_success "SSL Configured for $DOMAIN"
      log_info "Configuration File: /etc/nginx/conf.d/$SLUG.conf"
  else
      log_error "Certbot failed for $DOMAIN"
  fi
done

echo ""
echo "----------------------------------------------------------------"
log_success "   Automation Complete!   "
echo "----------------------------------------------------------------"
