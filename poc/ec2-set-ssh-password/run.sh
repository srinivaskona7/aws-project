#!/bin/bash
# One-command launcher - installs, starts, and opens browser automatically
command -v node >/dev/null 2>&1 || { echo "Install Node.js from https://nodejs.org/"; exit 1; }
[ ! -d "node_modules" ] && npm install --silent
AUTO_OPEN_BROWSER=true node server.js
