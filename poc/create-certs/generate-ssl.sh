#!/bin/bash

# =============================================================================
# SSL Certificate Generator using Let's Encrypt (Certbot)
# =============================================================================
# This script:
# - Prompts for domain name
# - Supports wildcard certificates for parent domain (*.domain.com)
# - Shows TXT record to add to DNS
# - Generates SSL certificates
# - Validates generated certificates (supports RSA and ECDSA)
# - Shows certificate validity period
# - Saves certs in a folder named after the domain
# - Cleans up Docker container after completion
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Print banner
echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           SSL Certificate Generator (Let's Encrypt)           ║"
echo "║                    DNS-01 Challenge Mode                       ║"
echo "║              With Wildcard & DNS Verification                  ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to extract parent domain (e.g., sri.srinivaskona.life -> srinivaskona.life)
get_parent_domain() {
    local domain="$1"
    # Count the number of dots
    local dot_count=$(echo "$domain" | tr -cd '.' | wc -c | tr -d ' ')
    
    if [[ $dot_count -ge 2 ]]; then
        # Has subdomain, extract parent (remove first part)
        echo "$domain" | cut -d'.' -f2-
    else
        # Already a root domain (e.g., example.com)
        echo "$domain"
    fi
}

# Function to validate certificate
validate_certificate() {
    local cert_path="$1"
    local domain="$2"
    local is_wildcard="$3"
    local wildcard_domain="$4"
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}                  CERTIFICATE VALIDATION                        ${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    local validation_passed=true
    
    # 1. Check certificate exists and is readable
    echo -e "${BLUE}[1/6] Checking certificate file...${NC}"
    if [[ -f "${cert_path}/cert.pem" ]]; then
        echo -e "      ${GREEN}✓ Certificate file exists${NC}"
    else
        echo -e "      ${RED}✗ Certificate file not found${NC}"
        validation_passed=false
        return 1
    fi
    
    # 2. Get certificate subject and verify domain
    echo -e "${BLUE}[2/6] Validating certificate domain...${NC}"
    local cert_subject=""
    local cert_san=""
    
    if command_exists openssl; then
        cert_subject=$(openssl x509 -in "${cert_path}/cert.pem" -noout -subject 2>/dev/null | sed 's/subject=//')
        cert_san=$(openssl x509 -in "${cert_path}/cert.pem" -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" | tail -1 | sed 's/^[[:space:]]*//')
    else
        cert_subject=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl x509 -in "/certs/cert.pem" -noout -subject 2>/dev/null | sed 's/subject=//')
        cert_san=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl x509 -in "/certs/cert.pem" -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" | tail -1 | sed 's/^[[:space:]]*//')
    fi
    
    echo -e "      ${CYAN}Subject:${NC} ${cert_subject}"
    echo -e "      ${CYAN}SANs:${NC} ${cert_san}"
    
    if echo "$cert_san" | grep -q "$domain"; then
        echo -e "      ${GREEN}✓ Domain '${domain}' found in certificate${NC}"
    else
        echo -e "      ${RED}✗ Domain '${domain}' NOT found in certificate${NC}"
        validation_passed=false
    fi
    
    if [[ "$is_wildcard" =~ ^[Yy]$ ]] && [[ -n "$wildcard_domain" ]]; then
        if echo "$cert_san" | grep -q "\*\.${wildcard_domain}"; then
            echo -e "      ${GREEN}✓ Wildcard '*.${wildcard_domain}' found in certificate${NC}"
        else
            echo -e "      ${RED}✗ Wildcard '*.${wildcard_domain}' NOT found in certificate${NC}"
            validation_passed=false
        fi
    fi
    
    # 3. Check validity dates
    echo -e "${BLUE}[3/6] Checking certificate validity period...${NC}"
    local not_before=""
    local not_after=""
    local days_valid=""
    
    if command_exists openssl; then
        not_before=$(openssl x509 -in "${cert_path}/cert.pem" -noout -startdate 2>/dev/null | cut -d= -f2)
        not_after=$(openssl x509 -in "${cert_path}/cert.pem" -noout -enddate 2>/dev/null | cut -d= -f2)
        # Calculate days until expiry - handle both macOS and Linux date formats
        local end_epoch
        end_epoch=$(date -j -f "%b %d %T %Y %Z" "$not_after" "+%s" 2>/dev/null || date -d "$not_after" "+%s" 2>/dev/null || echo "0")
        local now_epoch=$(date "+%s")
        if [[ "$end_epoch" -gt 0 ]]; then
            days_valid=$(( (end_epoch - now_epoch) / 86400 ))
        else
            days_valid="~90"
        fi
    else
        not_before=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl x509 -in "/certs/cert.pem" -noout -startdate 2>/dev/null | cut -d= -f2)
        not_after=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl x509 -in "/certs/cert.pem" -noout -enddate 2>/dev/null | cut -d= -f2)
        days_valid="~90"
    fi
    
    echo -e "      ${CYAN}Valid From:${NC}  ${not_before}"
    echo -e "      ${CYAN}Valid Until:${NC} ${not_after}"
    echo -e "      ${CYAN}Days Valid:${NC}  ${days_valid} days"
    
    if [[ "$days_valid" =~ ^[0-9]+$ ]] && [[ "$days_valid" -gt 0 ]]; then
        echo -e "      ${GREEN}✓ Certificate is currently valid${NC}"
    elif [[ "$days_valid" == "~90" ]]; then
        echo -e "      ${GREEN}✓ Certificate is valid (new certificate)${NC}"
    else
        echo -e "      ${RED}✗ Certificate has expired!${NC}"
        validation_passed=false
    fi
    
    # 4. Check certificate chain
    echo -e "${BLUE}[4/6] Validating certificate chain...${NC}"
    local chain_valid=false
    
    if command_exists openssl; then
        if openssl verify -CAfile "${cert_path}/chain.pem" "${cert_path}/cert.pem" >/dev/null 2>&1; then
            chain_valid=true
        fi
    else
        if docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl verify -CAfile "/certs/chain.pem" "/certs/cert.pem" >/dev/null 2>&1; then
            chain_valid=true
        fi
    fi
    
    if [[ "$chain_valid" == true ]]; then
        echo -e "      ${GREEN}✓ Certificate chain is valid${NC}"
    else
        echo -e "      ${YELLOW}⚠ Certificate chain verification skipped (staging or self-signed)${NC}"
    fi
    
    # 5. Check private key matches certificate (supports both RSA and ECDSA)
    echo -e "${BLUE}[5/6] Verifying private key matches certificate...${NC}"
    
    # Detect key type
    local key_type=""
    if command_exists openssl; then
        key_type=$(openssl x509 -in "${cert_path}/cert.pem" -noout -text 2>/dev/null | grep "Public Key Algorithm" | awk '{print $NF}')
    fi
    echo -e "      ${CYAN}Key Type:${NC} ${key_type:-Unknown}"
    
    # Use generic method that works for both RSA and ECDSA
    local cert_pubkey=""
    local key_pubkey=""
    local keys_match=false
    
    if command_exists openssl; then
        # Extract public key from certificate
        cert_pubkey=$(openssl x509 -in "${cert_path}/cert.pem" -pubkey -noout 2>/dev/null)
        # Extract public key from private key (works for RSA, ECDSA, Ed25519, etc.)
        key_pubkey=$(openssl pkey -in "${cert_path}/privkey.pem" -pubout 2>/dev/null)
        
        if [[ -n "$cert_pubkey" ]] && [[ -n "$key_pubkey" ]] && [[ "$cert_pubkey" == "$key_pubkey" ]]; then
            keys_match=true
        fi
    else
        # Fallback using docker
        cert_pubkey=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl x509 -in "/certs/cert.pem" -pubkey -noout 2>/dev/null)
        key_pubkey=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl pkey -in "/certs/privkey.pem" -pubout 2>/dev/null)
        
        if [[ -n "$cert_pubkey" ]] && [[ -n "$key_pubkey" ]] && [[ "$cert_pubkey" == "$key_pubkey" ]]; then
            keys_match=true
        fi
    fi
    
    if [[ "$keys_match" == true ]]; then
        echo -e "      ${GREEN}✓ Private key matches certificate${NC}"
    else
        echo -e "      ${RED}✗ Private key does NOT match certificate${NC}"
        validation_passed=false
    fi
    
    # 6. Check issuer (Let's Encrypt or Staging)
    echo -e "${BLUE}[6/6] Checking certificate issuer...${NC}"
    local issuer=""
    
    if command_exists openssl; then
        issuer=$(openssl x509 -in "${cert_path}/cert.pem" -noout -issuer 2>/dev/null | sed 's/issuer=//')
    else
        issuer=$(docker run --rm -v "${cert_path}:/certs:ro" alpine/openssl x509 -in "/certs/cert.pem" -noout -issuer 2>/dev/null | sed 's/issuer=//')
    fi
    
    echo -e "      ${CYAN}Issuer:${NC} ${issuer}"
    
    if echo "$issuer" | grep -qi "Let's Encrypt"; then
        echo -e "      ${GREEN}✓ Issued by Let's Encrypt (Production)${NC}"
        echo -e "      ${GREEN}✓ Certificate will be trusted by browsers${NC}"
    elif echo "$issuer" | grep -qi "STAGING\|Fake\|Test"; then
        echo -e "      ${YELLOW}⚠ Issued by Let's Encrypt STAGING${NC}"
        echo -e "      ${YELLOW}⚠ Certificate will NOT be trusted by browsers${NC}"
    else
        echo -e "      ${BLUE}ℹ Issuer: ${issuer}${NC}"
    fi
    
    # Final validation result
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    if [[ "$validation_passed" == true ]]; then
        echo -e "${GREEN}              ✓ CERTIFICATE VALIDATION PASSED ✓                ${NC}"
    else
        echo -e "${RED}              ✗ CERTIFICATE VALIDATION FAILED ✗                ${NC}"
    fi
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Return validation status
    if [[ "$validation_passed" == true ]]; then
        return 0
    else
        return 1
    fi
}

# Prompt for domain name
echo -e "${YELLOW}Enter the domain name (e.g., sri.srinivaskona.life):${NC}"
read -p "> " DOMAIN

# Validate domain input
if [[ -z "$DOMAIN" ]]; then
    echo -e "${RED}Error: Domain name cannot be empty!${NC}"
    exit 1
fi

# Remove wildcard prefix if user entered it (we'll ask separately)
DOMAIN="${DOMAIN#\*.}"

# Validate domain format (basic check)
if ! [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
    echo -e "${RED}Error: Invalid domain format!${NC}"
    exit 1
fi

# Extract parent domain for wildcard
PARENT_DOMAIN=$(get_parent_domain "$DOMAIN")

# Ask for wildcard certificate
echo ""
echo -e "${YELLOW}Do you want a wildcard certificate?${NC}"
echo -e "  ${CYAN}[y]${NC} Yes - Include wildcard ${MAGENTA}*.${PARENT_DOMAIN}${NC} (covers all subdomains of ${PARENT_DOMAIN})"
echo -e "  ${CYAN}[n]${NC} No  - Single domain only (${DOMAIN})"
read -p "> " INCLUDE_WILDCARD

DOMAIN_FLAGS="-d $DOMAIN"
WILDCARD_DOMAIN=""

if [[ "$INCLUDE_WILDCARD" =~ ^[Yy]$ ]]; then
    WILDCARD_DOMAIN="$PARENT_DOMAIN"
    DOMAIN_FLAGS="-d $DOMAIN -d *.${PARENT_DOMAIN}"
    echo ""
    echo -e "${GREEN}Will generate certificate for:${NC}"
    echo -e "  ${CYAN}•${NC} ${DOMAIN} (specific subdomain)"
    echo -e "  ${CYAN}•${NC} *.${PARENT_DOMAIN} (wildcard for all subdomains)"
    echo ""
    echo -e "${MAGENTA}NOTE: The wildcard *.${PARENT_DOMAIN} will cover:${NC}"
    echo -e "  ${CYAN}•${NC} api.${PARENT_DOMAIN}"
    echo -e "  ${CYAN}•${NC} www.${PARENT_DOMAIN}"
    echo -e "  ${CYAN}•${NC} app.${PARENT_DOMAIN}"
    echo -e "  ${CYAN}•${NC} any-subdomain.${PARENT_DOMAIN}"
else
    echo -e "${GREEN}Will generate certificate for: ${DOMAIN}${NC}"
fi

# Ask for staging or production
echo ""
echo -e "${YELLOW}Use staging environment? (recommended for testing to avoid rate limits)${NC}"
echo -e "  ${CYAN}[y]${NC} Yes - Staging (test certificates, not trusted by browsers)"
echo -e "  ${CYAN}[n]${NC} No  - Production (real certificates, trusted by browsers)"
read -p "> " USE_STAGING

STAGING_FLAG=""
STAGING_NOTE=""
if [[ "$USE_STAGING" =~ ^[Yy]$ ]]; then
    STAGING_FLAG="--staging"
    STAGING_NOTE=" (STAGING)"
    echo -e "${BLUE}Using staging environment...${NC}"
else
    echo -e "${BLUE}Using production environment...${NC}"
fi

# Ask for email (optional but recommended)
echo ""
echo -e "${YELLOW}Enter your email for renewal notifications (press Enter to skip):${NC}"
read -p "> " EMAIL

EMAIL_FLAG="--register-unsafely-without-email"
if [[ -n "$EMAIL" ]]; then
    EMAIL_FLAG="-m $EMAIL --no-eff-email"
fi

# Create certificate directory based on domain name
CERT_DIR="$(pwd)/${DOMAIN}"
mkdir -p "${CERT_DIR}/etc-letsencrypt"
mkdir -p "${CERT_DIR}/var-lib-letsencrypt"
mkdir -p "${CERT_DIR}/var-log-letsencrypt"

echo ""
echo -e "${GREEN}Certificate directory created: ${CERT_DIR}${NC}"
echo ""

# Container name for cleanup tracking
CONTAINER_NAME="certbot-${DOMAIN//\./-}-$$"

# Cleanup function
cleanup() {
    echo ""
    echo -e "${BLUE}Cleaning up...${NC}"
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Starting certificate generation process...${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}INSTRUCTIONS:${NC}"
echo -e "1. Certbot will display a TXT record value"
echo -e "2. Add TXT record to your DNS provider:"
if [[ "$INCLUDE_WILDCARD" =~ ^[Yy]$ ]]; then
    echo -e "   ${CYAN}Name/Host:${NC} _acme-challenge.${PARENT_DOMAIN}"
    echo -e "   ${MAGENTA}(You may need to add TWO TXT records with same name for wildcard)${NC}"
else
    echo -e "   ${CYAN}Name/Host:${NC} _acme-challenge.${DOMAIN}"
fi
echo -e "   ${CYAN}Type:${NC} TXT"
echo -e "   ${CYAN}Value:${NC} (will be shown by certbot)"
echo -e "3. Wait for DNS propagation (1-5 minutes)"
echo -e "4. Press Enter in certbot to continue"
echo ""
echo -e "${YELLOW}Press Enter to start certbot...${NC}"
read

# Run certbot in interactive mode
echo -e "${GREEN}Running Certbot...${NC}"
echo ""

docker run -it --rm \
    --name "$CONTAINER_NAME" \
    -v "${CERT_DIR}/etc-letsencrypt:/etc/letsencrypt" \
    -v "${CERT_DIR}/var-lib-letsencrypt:/var/lib/letsencrypt" \
    -v "${CERT_DIR}/var-log-letsencrypt:/var/log/letsencrypt" \
    certbot/certbot certonly \
    --manual \
    --preferred-challenges dns \
    --agree-tos \
    $EMAIL_FLAG \
    $STAGING_FLAG \
    $DOMAIN_FLAGS

CERTBOT_EXIT_CODE=$?

# Check if certificates were generated successfully
if [[ $CERTBOT_EXIT_CODE -eq 0 ]] && [[ -d "${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}" ]]; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         CERTIFICATES GENERATED SUCCESSFULLY!${STAGING_NOTE}            ${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Run certificate validation
    CERT_LIVE_PATH="${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}"
    validate_certificate "$CERT_LIVE_PATH" "$DOMAIN" "$INCLUDE_WILDCARD" "$WILDCARD_DOMAIN"
    VALIDATION_RESULT=$?
    
    echo ""
    echo -e "${CYAN}Certificate Location:${NC}"
    echo -e "  ${YELLOW}${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/${NC}"
    echo ""
    echo -e "${CYAN}Generated Files:${NC}"
    echo -e "  ${GREEN}├── fullchain.pem${NC}  - Full certificate chain (use this for most servers)"
    echo -e "  ${GREEN}├── privkey.pem${NC}    - Private key (keep this secure!)"
    echo -e "  ${GREEN}├── cert.pem${NC}       - Domain certificate only"
    echo -e "  ${GREEN}└── chain.pem${NC}      - Intermediate certificates"
    echo ""
    
    # List actual files
    echo -e "${CYAN}Actual certificate files:${NC}"
    ls -la "${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/" 2>/dev/null || echo "  (symlinks to archive)"
    echo ""
    
    if [[ "$INCLUDE_WILDCARD" =~ ^[Yy]$ ]]; then
        echo -e "${MAGENTA}Covered Domains:${NC}"
        echo -e "  - ${DOMAIN}"
        echo -e "  - *.${PARENT_DOMAIN} (all subdomains of ${PARENT_DOMAIN})"
        echo ""
    fi
    
    echo -e "${CYAN}Usage Examples:${NC}"
    echo ""
    echo -e "  ${YELLOW}Nginx:${NC}"
    echo -e "    ssl_certificate     ${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/fullchain.pem;"
    echo -e "    ssl_certificate_key ${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/privkey.pem;"
    echo ""
    echo -e "  ${YELLOW}Apache:${NC}"
    echo -e "    SSLCertificateFile      ${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/cert.pem"
    echo -e "    SSLCertificateKeyFile   ${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/privkey.pem"
    echo -e "    SSLCertificateChainFile ${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}/chain.pem"
    echo ""
    echo -e "  ${YELLOW}Docker/Node.js:${NC}"
    echo -e "    Mount: -v ${CERT_DIR}/etc-letsencrypt/live/${DOMAIN}:/certs:ro"
    echo ""
    
    if [[ -n "$STAGING_FLAG" ]]; then
        echo -e "${YELLOW}⚠ NOTE: This is a STAGING certificate (not trusted by browsers).${NC}"
        echo -e "${YELLOW}  Run again without staging for production certificates.${NC}"
        echo ""
    fi
    
    echo -e "${GREEN}Certificate renewal command:${NC}"
    echo -e "  docker run -it --rm -v ${CERT_DIR}/etc-letsencrypt:/etc/letsencrypt certbot/certbot renew --manual"
    echo ""
    
    # Final summary
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}                      SUMMARY                                   ${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "  ${CYAN}Domain:${NC}          ${DOMAIN}"
    if [[ "$INCLUDE_WILDCARD" =~ ^[Yy]$ ]]; then
        echo -e "  ${CYAN}Wildcard:${NC}        *.${PARENT_DOMAIN}"
    fi
    echo -e "  ${CYAN}Environment:${NC}     $(if [[ -n "$STAGING_FLAG" ]]; then echo "Staging (Test)"; else echo "Production"; fi)"
    echo -e "  ${CYAN}Cert Directory:${NC}  ${CERT_DIR}"
    if [[ $VALIDATION_RESULT -eq 0 ]]; then
        echo -e "  ${CYAN}Validation:${NC}      ${GREEN}PASSED ✓${NC}"
    else
        echo -e "  ${CYAN}Validation:${NC}      ${RED}FAILED ✗${NC}"
    fi
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
else
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║              CERTIFICATE GENERATION FAILED!                    ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Common issues:${NC}"
    echo -e "  - DNS TXT record not propagated yet (wait longer and retry)"
    echo -e "  - Incorrect TXT record value (copy exactly as shown)"
    echo -e "  - TXT record added to wrong host name"
    echo -e "  - Rate limit exceeded (use staging for testing)"
    echo -e "  - For wildcards: May need TWO TXT records with same name"
    echo ""
    echo -e "${CYAN}How to verify your DNS record:${NC}"
    if [[ "$INCLUDE_WILDCARD" =~ ^[Yy]$ ]]; then
        echo -e "  ${YELLOW}dig TXT _acme-challenge.${PARENT_DOMAIN} @8.8.8.8${NC}"
    else
        echo -e "  ${YELLOW}dig TXT _acme-challenge.${DOMAIN} @8.8.8.8${NC}"
    fi
    echo ""
    echo -e "${CYAN}Online verification tools:${NC}"
    echo -e "  https://dnschecker.org/#TXT/_acme-challenge.${PARENT_DOMAIN:-$DOMAIN}"
    echo ""
    echo -e "${CYAN}View certbot logs:${NC}"
    echo -e "  cat ${CERT_DIR}/var-log-letsencrypt/letsencrypt.log"
    echo ""
    exit 1
fi
