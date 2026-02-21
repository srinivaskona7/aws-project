#!/bin/bash
#
# EC2 User Data Script - Enable Root Password Authentication
# This script detects the Linux distribution and configures SSH for root password login
#

set -e

LOG_FILE="/var/log/root-password-setup.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=========================================="
log "Starting Root Password Setup"
log "=========================================="

# Get the password from parameter (will be injected during EC2 launch)
ROOT_PASSWORD="${ROOT_PASSWORD:-ChangeMe123!}"

# Detect Linux Distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        VERSION=$VERSION_ID
        log "Detected OS: $NAME $VERSION"
    elif [ -f /etc/redhat-release ]; then
        DISTRO="rhel"
        log "Detected OS: RHEL-based system"
    elif [ -f /etc/debian_version ]; then
        DISTRO="debian"
        log "Detected OS: Debian-based system"
    else
        DISTRO="unknown"
        log "WARNING: Unknown distribution"
    fi
    echo "$DISTRO"
}

# Set root password
set_root_password() {
    log "Setting root password..."
    echo "root:$ROOT_PASSWORD" | chpasswd
    if [ $? -eq 0 ]; then
        log "✓ Root password set successfully"
    else
        log "✗ Failed to set root password"
        exit 1
    fi
}

# Configure SSH for password authentication
configure_ssh() {
    log "Configuring SSH for password authentication..."

    SSHD_CONFIG="/etc/ssh/sshd_config"
    BACKUP_CONFIG="${SSHD_CONFIG}.backup.$(date +%s)"

    # Backup original config
    cp "$SSHD_CONFIG" "$BACKUP_CONFIG"
    log "Backed up SSH config to $BACKUP_CONFIG"

    # Enable password authentication
    if grep -q "^PasswordAuthentication" "$SSHD_CONFIG"; then
        sed -i 's/^PasswordAuthentication.*/PasswordAuthentication yes/' "$SSHD_CONFIG"
    else
        echo "PasswordAuthentication yes" >> "$SSHD_CONFIG"
    fi

    # Enable root login with password
    if grep -q "^PermitRootLogin" "$SSHD_CONFIG"; then
        sed -i 's/^PermitRootLogin.*/PermitRootLogin yes/' "$SSHD_CONFIG"
    else
        echo "PermitRootLogin yes" >> "$SSHD_CONFIG"
    fi

    # Ensure ChallengeResponseAuthentication is enabled (for some systems)
    if grep -q "^ChallengeResponseAuthentication" "$SSHD_CONFIG"; then
        sed -i 's/^ChallengeResponseAuthentication.*/ChallengeResponseAuthentication yes/' "$SSHD_CONFIG"
    fi

    # For newer SSH versions, ensure KbdInteractiveAuthentication is enabled
    if grep -q "^KbdInteractiveAuthentication" "$SSHD_CONFIG"; then
        sed -i 's/^KbdInteractiveAuthentication.*/KbdInteractiveAuthentication yes/' "$SSHD_CONFIG"
    fi

    log "✓ SSH configuration updated"
}

# Restart SSH service based on distribution
restart_ssh() {
    log "Restarting SSH service..."

    local DISTRO=$1

    case "$DISTRO" in
        ubuntu|debian)
            systemctl restart ssh || service ssh restart
            ;;
        rhel|centos|fedora|amzn|amazon)
            systemctl restart sshd || service sshd restart
            ;;
        *)
            # Try both common service names
            systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || \
            service sshd restart 2>/dev/null || service ssh restart 2>/dev/null
            ;;
    esac

    if [ $? -eq 0 ]; then
        log "✓ SSH service restarted successfully"
    else
        log "✗ Failed to restart SSH service"
        exit 1
    fi
}

# Verify SSH is listening on port 22
verify_ssh() {
    log "Verifying SSH is listening on port 22..."

    sleep 2

    if ss -tlnp | grep -q ":22 " || netstat -tlnp 2>/dev/null | grep -q ":22 "; then
        log "✓ SSH is listening on port 22"
    else
        log "⚠ Warning: Could not verify SSH is listening on port 22"
    fi
}

# Main execution
main() {
    log "System Information:"
    log "Hostname: $(hostname)"
    log "IP Address: $(hostname -I | awk '{print $1}')"
    log "Kernel: $(uname -r)"
    log ""

    DISTRO=$(detect_distro)

    set_root_password
    configure_ssh
    restart_ssh "$DISTRO"
    verify_ssh

    log ""
    log "=========================================="
    log "✓ Root Password Setup Complete!"
    log "=========================================="
    log "Root login with password is now enabled on port 22"
    log "You can now login using: ssh root@<ip-address>"
    log ""
}

main
