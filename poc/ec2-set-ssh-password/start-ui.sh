#!/bin/bash

echo "=========================================="
echo "  EC2 Password Setup - Web UI Launcher"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo ""
    echo "Please install Node.js from:"
    echo "  - https://nodejs.org/"
    echo "  - Or use: brew install node (on macOS)"
    echo ""
    exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo "✓ npm version: $(npm --version)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

echo "🚀 Starting server..."
echo ""

# Set environment variable to auto-open browser
export AUTO_OPEN_BROWSER=true

# Start the server
npm start
