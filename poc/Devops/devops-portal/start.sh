#\!/bin/bash
# DevOps Portal - Quick Start Script
# Usage: bash start.sh

set -e

REPO="sriniv7654/devops-as-a-service"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PORT=8080

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

banner() {
  echo -e "${GREEN}"
  cat << 'BANNER'
  ██████╗ ███████╗██╗   ██╗ ██████╗ ██████╗ ███████╗
  ██╔══██╗██╔════╝██║   ██║██╔═══██╗██╔══██╗██╔════╝
  ██║  ██║█████╗  ██║   ██║██║   ██║██████╔╝███████╗
  ██║  ██║██╔══╝  ╚██╗ ██╔╝██║   ██║██╔═══╝ ╚════██║
  ██████╔╝███████╗ ╚████╔╝ ╚██████╔╝██║     ███████║
  ╚═════╝ ╚══════╝  ╚═══╝   ╚═════╝ ╚═╝     ╚══════╝
  DevOps as a Service Platform | github.com/sriniv7654/devops-as-a-service
BANNER
  echo -e "${NC}"
}

check_node() {
  if \! command -v node &>/dev/null; then
    echo -e "${RED}[ERROR] Node.js not found. Install from https://nodejs.org (v18+)${NC}"
    exit 1
  fi
  NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${RED}[ERROR] Node.js v18+ required. Current: v$(node --version)${NC}"
    exit 1
  fi
  echo -e "${GREEN}[✓] Node.js $(node --version)${NC}"
}

check_docker() {
  if \! command -v docker &>/dev/null; then
    echo -e "${YELLOW}[WARN] Docker not found. Docker option unavailable.${NC}"
    return 1
  fi
  if \! docker info &>/dev/null; then
    echo -e "${YELLOW}[WARN] Docker daemon not running.${NC}"
    return 1
  fi
  echo -e "${GREEN}[✓] Docker $(docker --version | cut -d' ' -f3 | tr -d ',')${NC}"
  return 0
}

install_deps() {
  echo -e "${BLUE}[INFO] Installing Node.js dependencies...${NC}"
  cd "$APP_DIR"
  npm install --legacy-peer-deps --silent
  echo -e "${GREEN}[✓] Dependencies installed${NC}"
}

get_host_ip() {
  # Try to get public IP, fall back to private
  PUBLIC_IP=$(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || \
              curl -s --max-time 3 https://api.ipify.org 2>/dev/null || \
              hostname -I 2>/dev/null | awk '{print $1}' || \
              echo "localhost")
  echo "$PUBLIC_IP"
}

check_status() {
  IP=$(get_host_ip)
  echo ""
  echo -e "${CYAN}Checking if DevOps Portal is running on port ${APP_PORT}...${NC}"
  if curl -s --max-time 5 "http://localhost:${APP_PORT}/health" | grep -q '"status":"ok"' 2>/dev/null; then
    echo -e "${GREEN}[✓] DevOps Portal is RUNNING\!${NC}"
    echo -e "${GREEN}    Local:   http://localhost:${APP_PORT}${NC}"
    echo -e "${GREEN}    Network: http://${IP}:${APP_PORT}${NC}"
    echo -e "${YELLOW}    Login:   admin / password${NC}"
    return 0
  else
    echo -e "${RED}[✗] DevOps Portal is NOT running on port ${APP_PORT}${NC}"
    return 1
  fi
}

option_run_app() {
  echo ""
  echo -e "${BLUE}=== Option 1: Run App Locally ===${NC}"
  check_node
  install_deps

  # Setup .env if not present
  if [ \! -f "${APP_DIR}/.env" ]; then
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env" 2>/dev/null || true
    # Generate random session secret
    if command -v openssl &>/dev/null; then
      echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "${APP_DIR}/.env"
    fi
    echo "PORT=${APP_PORT}" >> "${APP_DIR}/.env"
    echo -e "${GREEN}[✓] Created .env file${NC}"
  fi

  IP=$(get_host_ip)
  echo ""
  echo -e "${GREEN}Starting DevOps Portal on port ${APP_PORT}...${NC}"

  if command -v pm2 &>/dev/null; then
    pm2 stop devops-portal 2>/dev/null || true
    pm2 start "${APP_DIR}/app.js" --name devops-portal
    pm2 save
    echo -e "${GREEN}[✓] Running with PM2 (process manager)${NC}"
  else
    echo -e "${YELLOW}[INFO] PM2 not found. Starting directly with node...${NC}"
    echo -e "${YELLOW}[INFO] Press Ctrl+C to stop${NC}"
    PORT=${APP_PORT} node "${APP_DIR}/app.js" &
    APP_PID=$\!
    sleep 3
    if kill -0 $APP_PID 2>/dev/null; then
      echo -e "${GREEN}[✓] Server started (PID: $APP_PID)${NC}"
    fi
  fi

  sleep 2
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   DevOps Portal is ready\!                ║${NC}"
  echo -e "${GREEN}║   Local:   http://localhost:${APP_PORT}       ║${NC}"
  echo -e "${GREEN}║   Network: http://${IP}:${APP_PORT}       ║${NC}"
  echo -e "${GREEN}║   Login:   admin / password              ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
}

option_docker() {
  echo ""
  echo -e "${BLUE}=== Option 2: Build Docker Image & Run ===${NC}"
  if \! check_docker; then
    echo -e "${RED}[ERROR] Docker required for this option${NC}"
    return 1
  fi

  IMAGE_NAME="sriniv7654/devops-as-a-service"
  TAG="latest"

  echo -e "${BLUE}[INFO] Building Docker image: ${IMAGE_NAME}:${TAG}${NC}"
  docker build -t "${IMAGE_NAME}:${TAG}" "${APP_DIR}"
  echo -e "${GREEN}[✓] Docker image built: ${IMAGE_NAME}:${TAG}${NC}"

  # Stop existing container if running
  docker stop devops-portal 2>/dev/null || true
  docker rm devops-portal 2>/dev/null || true

  echo -e "${BLUE}[INFO] Starting container on port 80...${NC}"
  docker run -d \
    --name devops-portal \
    -p 80:8080 \
    --restart unless-stopped \
    -e SESSION_SECRET="$(openssl rand -hex 32 2>/dev/null || echo 'devops-secret-change-me')" \
    -e NODE_ENV=production \
    "${IMAGE_NAME}:${TAG}"

  sleep 3

  IP=$(get_host_ip)
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   DevOps Portal running in Docker\!       ║${NC}"
  echo -e "${GREEN}║   Local:   http://localhost:80           ║${NC}"
  echo -e "${GREEN}║   Network: http://${IP}:80           ║${NC}"
  echo -e "${GREEN}║   Login:   admin / password              ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"

  echo ""
  read -p "Push image to Docker Hub? (y/N): " push_confirm
  if [[ "$push_confirm" =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}[INFO] Pushing ${IMAGE_NAME}:${TAG} to Docker Hub...${NC}"
    docker push "${IMAGE_NAME}:${TAG}"
    echo -e "${GREEN}[✓] Pushed\! Pull with: docker pull ${IMAGE_NAME}:${TAG}${NC}"
  fi
}

option_check_status() {
  echo ""
  echo -e "${BLUE}=== Option 3: Check Status ===${NC}"

  # Check on port 8080 (default)
  APP_PORT=8080
  if \! check_status; then
    # Try port 80 (docker)
    APP_PORT=80
    echo -e "${CYAN}Checking port 80 (Docker)...${NC}"
    if curl -s --max-time 5 "http://localhost:80/health" | grep -q '"status":"ok"' 2>/dev/null; then
      echo -e "${GREEN}[✓] DevOps Portal is RUNNING on port 80 (Docker)\!${NC}"
      IP=$(get_host_ip)
      echo -e "${GREEN}    URL: http://${IP}:80${NC}"
    else
      echo -e "${RED}[✗] App not running on port 80 either${NC}"
      echo -e "${YELLOW}[HINT] Run option 1 or 2 to start the app${NC}"

      # Check if processes exist
      if command -v pm2 &>/dev/null; then
        echo ""
        echo -e "${CYAN}PM2 processes:${NC}"
        pm2 list 2>/dev/null || echo "No PM2 processes"
      fi
      if command -v docker &>/dev/null; then
        echo ""
        echo -e "${CYAN}Docker containers:${NC}"
        docker ps -a --filter "name=devops-portal" 2>/dev/null || true
      fi
    fi
  fi
}

# ===== MAIN MENU =====
clear
banner
echo -e "${CYAN}What would you like to do?${NC}"
echo ""
echo -e "  ${GREEN}1${NC}) Run app locally         (Node.js, port ${APP_PORT})"
echo -e "  ${GREEN}2${NC}) Containerize & run       (Docker, port 80)"
echo -e "  ${GREEN}3${NC}) Check status             (verify if app is running)"
echo ""
read -p "Enter option [1/2/3]: " choice

case "$choice" in
  1) option_run_app ;;
  2) option_docker ;;
  3) option_check_status ;;
  *) echo -e "${RED}Invalid option. Run again and choose 1, 2, or 3.${NC}"; exit 1 ;;
esac
