#!/bin/bash
set -e

echo "=== Certificate Processor ==="
echo "This script converts raw .crt/.key files into AWS-ready PEM files."
echo ""

# 1. Setup Defaults
DEFAULT_FOLDER="garden"
BASE_INPUT_DIR="./raw-certs"
BASE_OUTPUT_DIR="./certs"

# 2. Prompt for Input Folder
read -p "Enter Input Folder Name (inside $BASE_INPUT_DIR/) [default: $DEFAULT_FOLDER]: " INPUT_NAME
INPUT_NAME=${INPUT_NAME:-$DEFAULT_FOLDER}
INPUT_PATH="$BASE_INPUT_DIR/$INPUT_NAME"

# 3. Prompt for Output Folder
read -p "Enter Output Folder Name (inside $BASE_OUTPUT_DIR/) [default: $INPUT_NAME]: " OUTPUT_NAME
OUTPUT_NAME=${OUTPUT_NAME:-$INPUT_NAME}
OUTPUT_PATH="$BASE_OUTPUT_DIR/$OUTPUT_NAME"

echo ""
echo "📍 Source:      $INPUT_PATH"
echo "📍 Destination: $OUTPUT_PATH"
echo ""

# 4. Validation
if [ ! -d "$INPUT_PATH" ]; then
    echo "❌ Error: Input directory '$INPUT_PATH' does not exist."
    echo "   Please create it and place your .crt and .key files there."
    exit 1
fi

# 5. Find Files
CRT_FILE=$(find "$INPUT_PATH" -maxdepth 1 -name "*.crt" | head -n 1)
KEY_FILE=$(find "$INPUT_PATH" -maxdepth 1 -name "*.key" | head -n 1)

if [ -z "$CRT_FILE" ]; then
    echo "❌ Error: No .crt file found in $INPUT_PATH"
    exit 1
fi

if [ -z "$KEY_FILE" ]; then
    echo "❌ Error: No .key file found in $INPUT_PATH"
    exit 1
fi

echo "✅ Found Certificate: $(basename "$CRT_FILE")"
echo "✅ Found Private Key: $(basename "$KEY_FILE")"

# 6. Prepare Output Directory
mkdir -p "$OUTPUT_PATH"

# 7. Process Files
echo "⚙️  Processing..."

# Copy Key
cp "$KEY_FILE" "$OUTPUT_PATH/tls.key"
echo "   -> Copied Key to $OUTPUT_PATH/tls.key"

# Split Certificate
# Split logic: awk writes to temporary files in the output directory
cd "$OUTPUT_PATH"
awk 'BEGIN {c=0} /BEGIN CERTIFICATE/ {c++} { out="cert" c ".pem"; print > out }' "$CRT_FILE"

# Rename cert1.pem to body.pem
if [ -f "cert1.pem" ]; then
    mv cert1.pem body.pem
    echo "   -> Created body.pem"
else
    echo "❌ Error: Failed to generate certificate body."
    exit 1
fi

# Combine remaining certs into chain.pem
if [ -f "cert2.pem" ]; then
    > chain.pem
    for i in {2..20}; do
        if [ -f "cert$i.pem" ]; then
            cat "cert$i.pem" >> chain.pem
            rm "cert$i.pem"
        fi
    done
    echo "   -> Created chain.pem (Intermediate Chain)"
else
    echo "⚠️  Warning: No intermediate certificates found. 'chain.pem' will be empty or not created."
    touch chain.pem
fi

# 8. Final Message
echo ""
echo "✅ Success! Certificates are ready in: $OUTPUT_PATH"
echo "   - body.pem"
echo "   - chain.pem"
echo "   - tls.key"
echo ""
echo "Update your terraform.tfvars to use folder: \"$OUTPUT_NAME\""
