#!/bin/bash
#
# Quick Start Guide - Interactive Demo
#

cat << 'EOF'

╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║         🔐 EC2 ROOT PASSWORD SETUP - QUICK START            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

This tool provides TWO options to configure your EC2 instance:

┌──────────────────────────────────────────────────────────────┐
│  OPTION 1: WEB UI (Recommended for beginners) 🌟             │
└──────────────────────────────────────────────────────────────┘

  Step 1: Start the Web Server
  ───────────────────────────────────────────────────────────
  $ ./start-ui.sh

  or

  $ npm install
  $ npm start


  Step 2: Open Your Browser
  ───────────────────────────────────────────────────────────
  Navigate to: http://localhost:3000


  Step 3: Configure via Web Interface
  ───────────────────────────────────────────────────────────

  ┌─────────────────────────────────────────────┐
  │  🔐 EC2 Root Password Setup                 │
  ├─────────────────────────────────────────────┤
  │                                             │
  │  Setup Mode:                                │
  │  ● Existing Instance                        │
  │  ○ New Instance (User Data)                 │
  │                                             │
  │  Root Password: ************                │
  │  EC2 Host: 54.123.45.67                    │
  │  Username: [ec2-user ▼]                    │
  │  PEM Key: [📁 Choose file...]              │
  │                                             │
  │  [🔌 Test Connection] [🚀 Setup Password]   │
  │                                             │
  └─────────────────────────────────────────────┘

  Features:
  ✓ Real-time log streaming
  ✓ Connection testing before setup
  ✓ Password strength indicator
  ✓ Drag-and-drop file upload
  ✓ Download generated scripts


┌──────────────────────────────────────────────────────────────┐
│  OPTION 2: COMMAND LINE (For automation/scripts) 💻          │
└──────────────────────────────────────────────────────────────┘

  For Existing EC2 Instance:
  ───────────────────────────────────────────────────────────
  $ ./create-password.sh <password> <username> <pem-key>

  Example:
  $ ./create-password.sh MyPass123 ubuntu ./my-key.pem

  When prompted, enter your EC2 IP address:
  Enter EC2 instance IP address or hostname: 54.123.45.67


  For New EC2 Instance (User Data):
  ───────────────────────────────────────────────────────────

  1. Edit user-data.sh and set your password:
     ROOT_PASSWORD="YourSecurePassword"

  2. Launch EC2 with this user data script:

     AWS Console:
     - Advanced Details → User Data
     - Paste the contents of user-data.sh

     AWS CLI:
     $ aws ec2 run-instances \
         --user-data file://user-data.sh \
         ...other parameters...


┌──────────────────────────────────────────────────────────────┐
│  COMMON USERNAME BY AMI TYPE                                 │
└──────────────────────────────────────────────────────────────┘

  Amazon Linux:    ec2-user
  Ubuntu:          ubuntu
  RHEL:            ec2-user
  CentOS:          centos
  Debian:          admin


┌──────────────────────────────────────────────────────────────┐
│  AFTER SETUP COMPLETE                                        │
└──────────────────────────────────────────────────────────────┘

  Login to your EC2 instance:
  ───────────────────────────────────────────────────────────
  $ ssh root@<your-ec2-ip>

  Enter the password you configured when prompted.


┌──────────────────────────────────────────────────────────────┐
│  ⚠️  SECURITY WARNINGS                                        │
└──────────────────────────────────────────────────────────────┘

  • Use strong passwords (12+ characters, mixed case, numbers)
  • Restrict SSH access in security groups to your IP only
  • This is recommended for DEV/TEST environments only
  • For production, use key-based authentication
  • Change passwords regularly
  • Enable 2FA when possible


┌──────────────────────────────────────────────────────────────┐
│  TROUBLESHOOTING                                             │
└──────────────────────────────────────────────────────────────┘

  Connection Failed?
  • Check security group allows SSH (port 22) from your IP
  • Verify instance is running
  • Confirm PEM key matches the instance
  • Try correct username for your AMI type

  Script Failed?
  • Check the logs displayed in console/web UI
  • Verify you have sudo/root access
  • Ensure SSH service is running on target

  Web UI Won't Start?
  • Install Node.js: https://nodejs.org/
  • Run: npm install
  • Check port 3000 is not in use


┌──────────────────────────────────────────────────────────────┐
│  DOCUMENTATION                                               │
└──────────────────────────────────────────────────────────────┘

  README.md          - Main documentation
  WEB-UI-README.md   - Web interface guide
  EXAMPLES.sh        - More examples


┌──────────────────────────────────────────────────────────────┐
│  NEED HELP?                                                  │
└──────────────────────────────────────────────────────────────┘

  • Check README.md for detailed documentation
  • See EXAMPLES.sh for more usage examples
  • Review logs in the web UI or terminal
  • GitHub Issues: [repository URL]


Press Ctrl+C to exit this guide.

EOF

# Ask user which method they want to use
echo ""
read -p "Would you like to start the Web UI now? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Starting Web UI..."
    echo ""
    ./start-ui.sh
else
    echo ""
    echo "To start the Web UI later, run:"
    echo "  ./start-ui.sh"
    echo ""
    echo "To use command line, run:"
    echo "  ./create-password.sh <password> <username> <pem-key>"
    echo ""
fi
