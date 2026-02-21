#!/bin/bash

# EC2 Password Setup - Quick Launch
# This script starts the server and automatically opens your browser

echo ""
echo "🚀 EC2 Password Setup - Quick Launch"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found!"
    echo "   Install from: https://nodejs.org/"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install --silent
    echo "✓ Dependencies installed"
    echo ""
fi

# Start server with auto-open
echo "🌐 Starting server and opening browser..."
echo ""

npm run start:open
