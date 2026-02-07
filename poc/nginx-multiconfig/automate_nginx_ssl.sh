#!/bin/bash

# Configuration
EMAIL="admin@srinivaskona.life" # Default email for Certbot

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Arrays to store domains
DOMAINS=()

echo "----------------------------------------------------------------"
echo "   Nginx SSL Automation Script (Architect Grade)   "
echo "----------------------------------------------------------------"

# 1. Input Processing
# If arguments are passed (e.g., ./script domain1 domain2), use them.
if [ $# -gt 0 ]; then
    echo -e "${GREEN}>>> Mode: Argument Input${NC}"
    DOMAINS=("$@")
else
    # Otherwise, fall back to Interactive Mode
    echo -e "${GREEN}>>> Mode: Interactive Input${NC}"
    while true; do
      echo ""
      read -p "Enter Domain Name (e.g., sri1.srinivaskona.life) [Press Enter to Finish]: " SC_DOMAIN
      
      # Trim whitespace
      SC_DOMAIN=$(echo "$SC_DOMAIN" | xargs)
      
      if [[ -z "$SC_DOMAIN" ]]; then
        break
      fi
      
      DOMAINS+=("$SC_DOMAIN")
    done
fi

# Check if any domains were entered
if [ ${#DOMAINS[@]} -eq 0 ]; then
    echo -e "${RED}No domains entered. Usage: ./script.sh [domain1] [domain2]${NC}"
    exit 0
fi

echo ""
echo "----------------------------------------------------------------"
echo "Processing ${#DOMAINS[@]} domains..."
echo "----------------------------------------------------------------"

# 2. Loop through domains for Setup
for DOMAIN in "${DOMAINS[@]}"; do
  echo ""
  echo ">>> Processing: $DOMAIN"
  
  # Generate Slug (replace dots with hyphens)
  SLUG=$(echo "$DOMAIN" | tr '.' '-')
  WEB_ROOT="/var/www/$SLUG"
  CONF_FILE="/etc/nginx/conf.d/$SLUG.conf"
  HTML_FILE="$WEB_ROOT/index.html"
  
  # 2.1 Create Content Directory & HTML
  if [ -d "$WEB_ROOT" ]; then
      echo "    [SKIP] Web root already exists: $WEB_ROOT"
  else
      echo "    [CREATE] Creating web root..."
      sudo mkdir -p "$WEB_ROOT"
      # Set permissions
      sudo chmod 755 "$WEB_ROOT"
  fi
  
  # Create HTML File (Idempotent)
  echo "    [WRITE] Generating HTML Content..."
  echo "<html><head><title>$DOMAIN</title></head><body><h1>$DOMAIN ($SLUG)</h1></body></html>" | sudo tee "$HTML_FILE" > /dev/null
  echo -e "${GREEN}    [SUCCESS] HTML File Created: $HTML_FILE${NC}"

  # 2.2 Create Initial Nginx Config (HTTP Only)
  if [ -f "$CONF_FILE" ]; then
      echo "    [CHECK] Config exists: $CONF_FILE"
      if grep -q "ssl_certificate" "$CONF_FILE"; then
          echo "    [SKIP] SSL already configured. Skipping overwrite."
      else
          echo "    [UPDATE] Overwriting HTTP config..."
          sudo tee "$CONF_FILE" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
          echo -e "${GREEN}    [SUCCESS] Nginx Config Updated: $CONF_FILE${NC}"
      fi
  else
      echo "    [CREATE] Creating Nginx HTTP Config..."
      sudo tee "$CONF_FILE" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
      echo -e "${GREEN}    [SUCCESS] Nginx Config Created: $CONF_FILE${NC}"
  fi

done

# 3. Reload Nginx to pick up HTTP configs
echo ""
echo "----------------------------------------------------------------"
echo "Verifying Nginx Configuration..."
echo "----------------------------------------------------------------"

if sudo nginx -t; then
    echo -e "${GREEN}    [SUCCESS] Nginx syntax is clean. Reloading...${NC}"
    sudo systemctl reload nginx
else
    echo -e "${RED}    [ERROR] Nginx syntax check failed. Aborting Certbot.${NC}"
    exit 1
fi

# 4. Run Certbot (SSL)
echo ""
echo "----------------------------------------------------------------"
echo "Running Certbot (SSL Automation)"
echo "----------------------------------------------------------------"

for DOMAIN in "${DOMAINS[@]}"; do
  echo ">>> Requesting Certificate for: $DOMAIN"
  
  sudo certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect \
    --keep-until-expiring

  if [ $? -eq 0 ]; then
      echo -e "${GREEN}    [SUCCESS] SSL Configured for $DOMAIN${NC}"
      echo -e "${GREEN}    [INFO] Configuration File: /etc/nginx/conf.d/$SLUG.conf${NC}"
  else
      echo -e "${RED}    [ERROR] Certbot failed for $DOMAIN${NC}"
  fi
done

echo ""
echo "----------------------------------------------------------------"
echo -e "${GREEN}   Automation Complete!   ${NC}"
echo "----------------------------------------------------------------"
