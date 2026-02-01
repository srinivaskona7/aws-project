#!/bin/bash
set -e

# Configuration
DOMAIN="garden.srinivaskona.life"
export AWS_DEFAULT_REGION="ap-south-1"
export AWS_PAGER=""
# Credentials removed for security. Ensure you have AWS credentials exported in your shell.
# export AWS_ACCESS_KEY_ID="..."
# export AWS_SECRET_ACCESS_KEY="..."

echo "=== Deployment for $DOMAIN ==="
echo "=== Region: $AWS_DEFAULT_REGION ==="

echo "[1/6] Checking AWS Identity..."
aws sts get-caller-identity || { echo "❌ AWS Credentials not configured or invalid."; exit 1; }

# --- Auto-Detect and Split Certificates ---
# We look for files in the current directory or 'certs/' subdirectory
POSSIBLE_LOCATIONS=("$PWD" "$PWD/certs")
CERT_FILE=""
KEY_FILE=""

# 1. Find the main CRT and KEY
for loc in "${POSSIBLE_LOCATIONS[@]}"; do
    if [ -f "$loc/tls.crt" ]; then CERT_FILE="$loc/tls.crt"; fi
    if [ -f "$loc/tls.key" ]; then KEY_FILE="$loc/tls.key"; fi
done

if [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
    echo "❌ Error: tls.crt and tls.key not found in current directory or certs/ folder."
    exit 1
fi

echo "✅ Found Certificate: $CERT_FILE"
echo "✅ Found Private Key: $KEY_FILE"

# 2. Check for Split Files (Body & Chain)
# If they don't exist, we create them from tls.crt
BODY_FILE="body.pem"
CHAIN_FILE="chain.pem"

# We use awk to split the bundle.
# Check if body.pem exists locally first
if [ ! -f "$BODY_FILE" ]; then
    echo "[Cert] Splitting tls.crt into body and chain..."
    # Safe awk split
    awk 'BEGIN {c=0} /BEGIN CERTIFICATE/ {c++} { out="cert" c ".pem"; print > out }' "$CERT_FILE"
    
    if [ -f "cert1.pem" ]; then
        mv cert1.pem "$BODY_FILE"
    else
         echo "❌ Error: Failed to extract certificate body from $CERT_FILE"
         exit 1
    fi

    # Combine all remaining certs into chain (if any)
    if [ -f "cert2.pem" ]; then
        > "$CHAIN_FILE" # Create/Clear chain file
        for i in {2..10}; do
            if [ -f "cert$i.pem" ]; then
                cat "cert$i.pem" >> "$CHAIN_FILE"
                rm "cert$i.pem"
            fi
        done
        echo "✅ Created $BODY_FILE and $CHAIN_FILE"
    else
        echo "⚠️ Warning: Only one certificate found in tls.crt. Assuming it's a self-signed or single-cert setup (No Chain)."
        rm -f "$CHAIN_FILE" # Ensure no stale chain file exists
    fi
else
    echo "✅ Using existing $BODY_FILE and $CHAIN_FILE"
fi

# 3. Import to ACM
echo "[2/6] Importing Certificate to ACM..."
# If chain exists and is not empty, include it. If not, don't.
if [ -f "$CHAIN_FILE" ] && [ -s "$CHAIN_FILE" ]; then
    echo "Importing with Chain..."
    ARN=$(aws acm import-certificate \
        --certificate fileb://"$BODY_FILE" \
        --private-key fileb://"$KEY_FILE" \
        --certificate-chain fileb://"$CHAIN_FILE" \
        --output text \
        --query CertificateArn)
else
    echo "Importing without Chain..."
    ARN=$(aws acm import-certificate \
        --certificate fileb://"$BODY_FILE" \
        --private-key fileb://"$KEY_FILE" \
        --output text \
        --query CertificateArn)
fi

echo "Certificate Imported successfully."
echo "ARN: $ARN"

# Clean up temp split files (optional, keeping them for debugging or re-use is fine)
# rm -f body.pem chain.pem

echo "[3/6] Generating terraform.tfvars..."
cat > terraform.tfvars <<EOF
domain_name = "$DOMAIN"
ssl_certificate_arn = "$ARN"
EOF

echo "[4/6] Initializing Terraform..."
terraform init -reconfigure

echo "[5/6] Applying Terraform Configuration..."
# Applying changes (Auto-approve for automation)
terraform apply -auto-approve

echo "[6/6] Retrieving Nameservers..."
echo "=========================================================="
echo "SUCCESS! Setup Complete."
echo "PLEASE UPDATE YOUR GODADDY NAMESERVERS TO THE FOLLOWING:"
echo "=========================================================="
terraform output nameservers
echo "=========================================================="
