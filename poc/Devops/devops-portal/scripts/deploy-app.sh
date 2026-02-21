#!/bin/bash
# Deploy DevOps Portal on EC2 instance
set -e

APP_DIR="/home/ec2-user/devops-portal"
APP_PORT=8080

echo "=== Deploying DevOps Portal ==="

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js not installed. Run scripts/install-tools.sh first"
    exit 1
fi

# Stop existing app if running
if command -v pm2 &>/dev/null; then
    pm2 stop devops-portal 2>/dev/null || true
fi

# Install PM2 if not present
if ! command -v pm2 &>/dev/null; then
    echo "[INFO] Installing PM2..."
    sudo npm install -g pm2
fi

cd "$APP_DIR"

# Install dependencies
echo "[INFO] Installing Node.js dependencies..."
npm install --production

# Configure environment
if [ ! -f .env ]; then
    cp .env.example .env 2>/dev/null || echo "PORT=8080" > .env
    echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
fi

# Start with PM2
echo "[INFO] Starting DevOps Portal on port $APP_PORT..."
pm2 start app.js --name devops-portal --update-env
pm2 save
pm2 startup 2>/dev/null || true

# Open firewall port if ufw is active
if command -v ufw &>/dev/null && sudo ufw status | grep -q active; then
    sudo ufw allow $APP_PORT/tcp
fi

echo ""
echo "=== DevOps Portal Deployed! ==="
echo "URL: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}'):$APP_PORT"
echo "Login: admin / password"
echo "PM2 status: $(pm2 status)"
