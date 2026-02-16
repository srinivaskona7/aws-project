#!/bin/bash

# ==============================================================================
#  Nginx SSL Automation Script (Architect Grade) - v3.0 (Robust & Idempotent)
#  
#  Usage (Interactive): ./automate_nginx_ssl.sh
#  Usage (Direct):      ./automate_nginx_ssl.sh domain1.com domain2.com
#  Description:         Automates Nginx setup, DNS validation, Idempotency (Cleanup),
#                       SSL certification, and Post-Verification.
# ==============================================================================

# Configuration
EMAIL="admin@srinivaskona.life" 
MANAGED_TAG="# Managed by Nginx Automation Script"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper Functions
log_info() { echo -e "${BLUE}[INFO] $1${NC}"; }
log_success() { echo -e "${GREEN}[SUCCESS] $1${NC}"; }
log_warning() { echo -e "${YELLOW}[WARNING] $1${NC}"; }
log_error() { echo -e "${RED}[ERROR] $1${NC}"; }

# Report Data
declare -A REPORT_CONFIG
declare -A REPORT_SSL
declare -A REPORT_CONTENT
declare -A REPORT_PATH

echo "----------------------------------------------------------------"
echo "   Nginx SSL Automation Script (v3.0 - Robust)   "
echo "----------------------------------------------------------------"

# 0. System Check & Installation
echo ""
log_info "Phase 0: System Check & Installation"
SERVER_IP=$(curl -s ifconfig.me)
log_info "Detected Server IP: $SERVER_IP"

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
    if ! systemctl is-active --quiet nginx; then
        sudo systemctl start nginx
    fi
fi

# Check Certbot
if ! command -v certbot &> /dev/null; then
    log_info "Certbot not found. Installing..."
    sudo dnf install certbot python3-certbot-nginx -y
fi

# 1. Input Processing
echo ""
log_info "Phase 1: Domain Input Processing"

DOMAINS=()
if [ $# -gt 0 ]; then
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

# Validation Loop
VALID_DOMAINS=()
for D in "${DOMAINS[@]}"; do
    if [[ "$D" == *"."* ]]; then
        VALID_DOMAINS+=("$D")
    else
        log_error "Skipping invalid domain format: $D"
    fi
done
DOMAINS=("${VALID_DOMAINS[@]}")

if [ ${#DOMAINS[@]} -eq 0 ]; then
    log_error "No valid domains to process. Exiting."
    exit 1
fi

echo ""
echo "----------------------------------------------------------------"
log_info "Phase 2: Global DNS Propagation Check (5-min Wait Loop)"
echo "----------------------------------------------------------------"

# 2. Global DNS Wait Loop (Wait for ALL domains)
MAX_RETRIES=30
RETRY_COUNT=0
ALL_DNS_VERIFIED=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    PENDING_COUNT=0
    
    for DOMAIN in "${DOMAINS[@]}"; do
        DOMAIN_IP=$(dig +short "$DOMAIN" | tail -n1)
        if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
            ((PENDING_COUNT++))
        fi
    done

    if [ $PENDING_COUNT -eq 0 ]; then
        log_success "All domains pointing to $SERVER_IP."
        ALL_DNS_VERIFIED=true
        break
    else
        log_warning "Waiting for $PENDING_COUNT domain(s) to propagate... ($RETRY_COUNT/$MAX_RETRIES). Retrying in 10s..."
        sleep 10
        ((RETRY_COUNT++))
    fi
done

if [ "$ALL_DNS_VERIFIED" = false ]; then
    log_error "DNS Validation Timed Out. Some domains do not point to this server."
    read -p "Proceed anyway? [y/N]: " PROCEED
    if [[ ! "$PROCEED" =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "----------------------------------------------------------------"
log_info "Phase 3: Idempotency & Cleanup"
echo "----------------------------------------------------------------"

# 3. Idempotency - Cleanup unmanaged/old domains
# Scan /etc/nginx/conf.d/ for managed files not in current DOMAINS list
EXISTING_CONFS=$(sudo grep -l "$MANAGED_TAG" /etc/nginx/conf.d/*.conf 2>/dev/null)

for CONF in $EXISTING_CONFS; do
    CONF_FILENAME=$(basename "$CONF") # e.g., sri1-srinivaskona-life.conf
    # Extract original domain slug from filename (remove .conf)
    SLUG="${CONF_FILENAME%.conf}"
    
    # Check if this slug corresponds to any current domain (approximate matching)
    KEEP=false
    for DOMAIN in "${DOMAINS[@]}"; do
        CURRENT_SLUG=$(echo "$DOMAIN" | tr '.' '-')
        if [ "$SLUG" == "$CURRENT_SLUG" ]; then
            KEEP=true
            break
        fi
    done
    
    if [ "$KEEP" = false ]; then
        log_warning "Removing old configuration for: $SLUG"
        sudo rm -f "$CONF"
        
        # Archive Web Root
        OLD_WEB_ROOT="/var/www/$SLUG"
        if [ -d "$OLD_WEB_ROOT" ]; then
            ARCHIVE_DIR="/var/www/archive/$SLUG-$(date +%s)"
            sudo mkdir -p "/var/www/archive"
            sudo mv "$OLD_WEB_ROOT" "$ARCHIVE_DIR"
            log_info "Archived web root to $ARCHIVE_DIR"
        fi
        
        # Revoke/Delete Cert (Optional but clean)
        # sudo certbot delete --cert-name ... (Risky if automated, skipping for safety)
    fi
done

echo ""
echo "----------------------------------------------------------------"
log_info "Phase 4: Configuration & SSL"
echo "----------------------------------------------------------------"

for DOMAIN in "${DOMAINS[@]}"; do
  log_info ">>> Configuring: $DOMAIN"
  
  REPORT_CONFIG[$DOMAIN]="[FAIL]"
  REPORT_SSL[$DOMAIN]="[SKIP]"
  REPORT_CONTENT[$DOMAIN]="[WAIT]"
  REPORT_PATH[$DOMAIN]="$WEB_ROOT"

  SLUG=$(echo "$DOMAIN" | tr '.' '-')
  WEB_ROOT="/var/www/$SLUG"
  CONF_FILE="/etc/nginx/conf.d/$SLUG.conf"
  HTML_FILE="$WEB_ROOT/index.html"
  
  # 4.1 Content Generation (Idempotent)
  if [ ! -d "$WEB_ROOT" ]; then
      sudo mkdir -p "$WEB_ROOT"
      sudo chmod 755 "$WEB_ROOT"
  fi
  
  if [ -f "$HTML_FILE" ]; then
      log_warning "Content exists ($HTML_FILE). Skipping generation to preserve custom files."
  else
      # Dynamic "Hello" Page (Only if not exists)
      sudo tee "$HTML_FILE" > /dev/null <<EOF
<html>
<head><title>$DOMAIN</title></head>
<body>
    <h1>Hello $DOMAIN</h1>
    <p>Served by Nginx on $SERVER_IP</p>
    <p>Generated at $(date)</p>
    <p><em>(You can replace this file with your own HTML/CSS/JS)</em></p>
</body>
</html>
EOF
      log_success "Content Created: $HTML_FILE"
  fi

  # 4.2 Nginx Config
  # Always write fresh to ensure state matches input
  sudo tee "$CONF_FILE" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    index index.html;
    location / { try_files \$uri \$uri/ =404; }
    
    $MANAGED_TAG
}
EOF
  log_success "Config Written: $CONF_FILE"
  REPORT_CONFIG[$DOMAIN]="[OK]"

done

# Reload Nginx
if sudo nginx -t; then
    sudo systemctl reload nginx
else
    log_error "Nginx syntax check failed."
    exit 1
fi

# 5. SSL & Post-Verification
echo ""
echo "----------------------------------------------------------------"
log_info "Phase 5: SSL Automation & Verification"
echo "----------------------------------------------------------------"

for DOMAIN in "${DOMAINS[@]}"; do
  # 5.1 HTTP Reachability
  HTTP_CODE=$(curl -o /dev/null -s -w "%{http_code}" "http://$DOMAIN")
  if [[ "$HTTP_CODE" != "200" ]] && [[ "$HTTP_CODE" != "301" ]]; then
      log_error "HTTP Check Failed ($HTTP_CODE). Skipping SSL."
      REPORT_SSL[$DOMAIN]="[UNREACH]"
      continue
  fi

  # 5.2 Certbot
  log_info "Requesting SSL for $DOMAIN..."
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect --keep-until-expiring
  
  if [ $? -eq 0 ]; then
      REPORT_SSL[$DOMAIN]="[OK]"
  else
      REPORT_SSL[$DOMAIN]="[FAIL]"
      continue
  fi
  
  # 5.3 Post-Verification (HTTPS Content Check)
  log_info "Verifying HTTPS Content..."
  # -L follows redirects (HTTP -> HTTPS), -k allows self-signed if staging (but letsencrypt is real)
  CONTENT=$(curl -s -L "https://$DOMAIN")
  
  if echo "$CONTENT" | grep -q "Hello $DOMAIN"; then
      log_success "Verification Success: Found 'Hello $DOMAIN'"
      REPORT_CONTENT[$DOMAIN]="[MATCH]"
  else
      log_error "Verification Failed: Content mismatch."
      REPORT_CONTENT[$DOMAIN]="[MISMATCH]"
  fi
done

# 6. Final Report
echo ""
echo "=========================================================================="
echo "   FINAL DEPLOYMENT REPORT (v3.0)"
echo "=========================================================================="
printf "%-30s | %-8s | %-8s | %-10s | %s\n" "Domain" "Config" "SSL" "Content" "Web Root"
echo "---------------------------------------------------------------------------------------------------"

for DOMAIN in "${DOMAINS[@]}"; do
    printf "%-30s | %-8s | %-8s | %-10s | %s\n" "$DOMAIN" "${REPORT_CONFIG[$DOMAIN]}" "${REPORT_SSL[$DOMAIN]}" "${REPORT_CONTENT[$DOMAIN]}" "${REPORT_PATH[$DOMAIN]}"
done
echo "=========================================================================="
echo ""
