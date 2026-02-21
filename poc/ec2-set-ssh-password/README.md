# EC2 Root Password Authentication Setup

Automated scripts and web UI to enable root user password authentication on EC2 Linux instances.

## Overview

This repository provides **two ways** to configure EC2 instances:

### 🖥️ Web UI (Recommended)
- Modern web interface with real-time logs
- Drag-and-drop PEM key upload
- Live connection testing
- Visual progress tracking
- See [WEB-UI-README.md](WEB-UI-README.md) for details

### 📝 Command Line Scripts
- **user-data.sh** - EC2 user data script for automated setup during instance launch
- **create-password.sh** - Post-launch automation script for existing instances

## Features

- ✓ Supports all major Linux distributions (Ubuntu, Debian, RHEL, CentOS, Amazon Linux, Fedora)
- ✓ Automatic OS detection and appropriate SSH service handling
- ✓ Enables password authentication on port 22
- ✓ Configures root login with password
- ✓ Backup of original SSH configuration
- ✓ Comprehensive logging and error handling
- ✓ Color-coded output for better visibility

## Security Warning

⚠️ **Important Security Considerations:**
- Root password login exposes your server to brute-force attacks
- Always use strong passwords
- Restrict SSH access via security groups to known IP addresses
- Consider using this only for development/testing environments
- For production, prefer key-based authentication

## Quick Start

### Option 1: Web UI (Easiest) 🌟

**One-Command Launch (Recommended):**
```bash
./run.sh
# Automatically installs dependencies, starts server, and opens browser!
```

**Alternative launch methods:**
```bash
# Using the launcher script
./launch.sh

# Using the start script
./start-ui.sh

# Or manually
npm install
npm run start:open

# Without auto-opening browser
npm start
```

The browser will automatically open to `http://localhost:3000`

See [WEB-UI-README.md](WEB-UI-README.md) for complete web UI documentation.

### Option 2: Command Line

## Usage

### Method 1: Post-Launch Configuration (Existing Instance)

For an already running EC2 instance:

```bash
./create-password.sh <password> [username] [pem-key-path]
```

**Parameters:**
- `password` - Root password to set (required)
- `username` - SSH username for initial connection (default: ec2-user)
- `pem-key-path` - Path to PEM key file (default: ./key.pem)

**Examples:**

```bash
# Basic usage (will prompt for EC2 IP)
./create-password.sh MySecurePass123

# With custom username
./create-password.sh MySecurePass123 ubuntu

# With all parameters
./create-password.sh MySecurePass123 ubuntu /path/to/my-key.pem

# Using environment variable for host
EC2_HOST=54.123.45.67 ./create-password.sh MySecurePass123 ec2-user ./my-key.pem
```

**Common usernames by AMI:**
- Amazon Linux: `ec2-user`
- Ubuntu: `ubuntu`
- RHEL: `ec2-user` or `root`
- Debian: `admin`
- CentOS: `centos`

### Method 2: Launch-Time Configuration (New Instance)

Use the user data script when launching a new EC2 instance:

**Option A: Via AWS Console**

1. Launch EC2 instance
2. In "Advanced details" section, expand "User data"
3. Paste the contents of `user-data.sh`
4. Modify the `ROOT_PASSWORD` variable at the top of the script or set it as an environment variable
5. Launch the instance

**Option B: Via AWS CLI**

```bash
# Set password via environment variable in user data
aws ec2 run-instances \
    --image-id ami-xxxxxxxxx \
    --instance-type t2.micro \
    --key-name my-key \
    --security-groups my-sg \
    --user-data file://user-data.sh \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=my-instance}]'
```

To set a custom password, modify the user data script before launching:

```bash
# Create a custom user data script with your password
sed 's/ROOT_PASSWORD="${ROOT_PASSWORD:-ChangeMe123!}"/ROOT_PASSWORD="YourSecurePassword"/' user-data.sh > custom-user-data.sh

# Launch with custom user data
aws ec2 run-instances \
    --user-data file://custom-user-data.sh \
    ...
```

**Option C: Via Terraform**

```hcl
resource "aws_instance" "example" {
  ami           = "ami-xxxxxxxxx"
  instance_type = "t2.micro"

  user_data = templatefile("${path.module}/user-data.sh", {
    ROOT_PASSWORD = "YourSecurePassword"
  })

  tags = {
    Name = "my-instance"
  }
}
```

## How It Works

### create-password.sh

1. Validates input parameters and PEM key
2. Tests SSH connectivity to EC2 instance
3. Detects Linux distribution on remote server
4. Backs up original SSH configuration
5. Modifies SSH config to enable password authentication
6. Enables root login with password
7. Sets the root password
8. Restarts SSH service
9. Displays success message and login instructions

### user-data.sh

1. Runs automatically during EC2 instance launch
2. Detects Linux distribution
3. Sets root password from environment variable or default
4. Configures SSH for password authentication
5. Enables root login
6. Restarts SSH service
7. Logs all actions to `/var/log/root-password-setup.log`

## Requirements

### For create-password.sh:
- Bash shell
- SSH client
- Valid PEM key file for EC2 instance
- Network connectivity to EC2 instance
- Security group allowing SSH (port 22) access

### For user-data.sh:
- EC2 instance with user data support
- Root/sudo privileges during boot

## Troubleshooting

### Connection Issues

```bash
# Verify security group allows SSH from your IP
aws ec2 describe-security-groups --group-ids sg-xxxxxxxx

# Test connectivity
ssh -i your-key.pem ec2-user@your-instance-ip
```

### Check Logs

After running the script, check the logs on the EC2 instance:

```bash
# View user-data.sh execution log
ssh -i your-key.pem ec2-user@your-instance-ip "sudo cat /var/log/root-password-setup.log"

# View cloud-init logs
ssh -i your-key.pem ec2-user@your-instance-ip "sudo cat /var/log/cloud-init-output.log"
```

### SSH Service Not Restarting

If SSH service fails to restart, manually check:

```bash
# Check SSH service status
sudo systemctl status sshd   # or 'ssh' on Debian/Ubuntu

# Validate SSH config syntax
sudo sshd -t

# View SSH config
sudo cat /etc/ssh/sshd_config | grep -E "PasswordAuthentication|PermitRootLogin"
```

### Wrong Username

Different AMIs use different default usernames:

```bash
# Try common usernames
ssh -i key.pem ec2-user@instance-ip
ssh -i key.pem ubuntu@instance-ip
ssh -i key.pem admin@instance-ip
ssh -i key.pem centos@instance-ip
```

## File Structure

```
.
├── README.md              # This file
├── WEB-UI-README.md       # Web UI documentation
├── create-password.sh     # CLI automation script
├── user-data.sh           # EC2 user data script
├── EXAMPLES.sh            # Usage examples
├── server.js              # Web server
├── package.json           # Node.js dependencies
├── start-ui.sh            # Web UI launcher
└── public/                # Web UI files
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Example Workflow

```bash
# 1. Clone/download the scripts
git clone <repo-url>
cd ec2-set-ssh-password

# 2. Make scripts executable (already done)
chmod +x *.sh

# 3. Configure an existing EC2 instance
./create-password.sh MySecurePass123 ubuntu ./my-key.pem

# 4. Login with password
ssh root@<ec2-ip>
# Enter password when prompted
```

## Security Best Practices

1. **Use Strong Passwords**
   - Minimum 12 characters
   - Mix of uppercase, lowercase, numbers, and special characters

2. **Restrict Access**
   ```bash
   # Allow SSH only from your IP
   aws ec2 authorize-security-group-ingress \
       --group-id sg-xxxxxxxx \
       --protocol tcp \
       --port 22 \
       --cidr your.ip.address/32
   ```

3. **Monitor Access**
   ```bash
   # View SSH login attempts
   sudo tail -f /var/log/auth.log      # Ubuntu/Debian
   sudo tail -f /var/log/secure        # RHEL/CentOS
   ```

4. **Disable When Not Needed**
   ```bash
   # Disable password authentication
   sudo sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart sshd
   ```

## License

This project is provided as-is for educational and development purposes.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
