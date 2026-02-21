# EC2 Root Password Setup - Web UI

A modern, user-friendly web interface for automating SSH password authentication setup on EC2 instances.

## Features

✨ **Modern Web Interface**
- Clean, dark-themed UI with real-time updates
- Drag-and-drop PEM key upload
- Live log streaming via WebSocket
- Password strength indicator
- Progress tracking with visual feedback

🔧 **Dual Setup Modes**
1. **Existing Instance** - Configure running EC2 via SSH
2. **User Data** - Generate script for new instance launch

🚀 **Key Capabilities**
- Real-time SSH connection testing
- Automatic OS detection
- Color-coded log output
- Download logs and generated scripts
- Secure file handling (auto-cleanup)
- Support for all major Linux distributions

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

Or use the launcher script:

```bash
./start-ui.sh
```

### 2. Start the Server

```bash
npm start
```

The web interface will be available at: **http://localhost:3000**

### 3. Configure Your EC2 Instance

**Method A: Existing Instance**
1. Select "Existing Instance" mode
2. Enter your root password
3. Enter EC2 IP address or DNS
4. Select the appropriate username (ec2-user, ubuntu, etc.)
5. Upload your PEM key file
6. Click "Test Connection" (optional)
7. Click "Setup Password"
8. Watch the real-time logs
9. Login with: `ssh root@<your-ec2-ip>`

**Method B: New Instance (User Data)**
1. Select "New Instance (User Data)" mode
2. Enter your root password
3. Click "Generate User Data Script"
4. Download the generated script
5. Use it as user data when launching EC2
6. Instance will auto-configure on first boot

## Screenshots

### Main Interface
```
+--------------------------------------------------+
|            🔐 EC2 Root Password Setup            |
|    Automated SSH Password Authentication Config  |
|              ● Connected                          |
+--------------------------------------------------+
| Configuration          |    Execution Logs       |
|                       |                          |
| [Setup Mode]          | [00:00:01] Starting...  |
| ● Existing Instance   | [00:00:02] Connecting.. |
| ○ User Data           | [00:00:03] ✓ Success    |
|                       |                          |
| Password: ********    | [Download] [Clear]      |
| EC2 Host: 54.x.x.x    |                          |
| Username: ec2-user    |                          |
| PEM Key: [Upload]     | ━━━━━━━━━━ 100%         |
|                       |                          |
| [Test] [Setup]        | ✅ Setup Complete!      |
+--------------------------------------------------+
```

## API Endpoints

### Health Check
```
GET /api/health
```

### Upload PEM Key
```
POST /api/upload-key
Content-Type: multipart/form-data

FormData: pemKey (file)
```

### Setup Password
```
POST /api/setup-password
Content-Type: application/json

{
  "password": "YourPassword123",
  "ec2Host": "54.123.45.67",
  "username": "ec2-user",
  "pemKeyPath": "/path/to/uploaded.pem",
  "clientId": "websocket-client-id",
  "useUserData": false
}
```

### Test Connection
```
POST /api/test-connection
Content-Type: application/json

{
  "ec2Host": "54.123.45.67",
  "username": "ec2-user",
  "pemKeyPath": "/path/to/uploaded.pem",
  "clientId": "websocket-client-id"
}
```

### Download Generated Script
```
GET /api/download/:filename
```

### Get Execution Logs
```
GET /api/logs/:executionId
```

### List All Executions
```
GET /api/executions
```

## WebSocket Events

### Client → Server
No direct client messages (uses HTTP API)

### Server → Client

**Connection**
```json
{
  "type": "connected",
  "clientId": "uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Log Entry**
```json
{
  "type": "log",
  "level": "info|success|warning|error",
  "message": "Log message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Completion**
```json
{
  "type": "complete",
  "success": true,
  "exitCode": 0,
  "message": "Setup completed successfully!",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "executionId": "uuid"
}
```

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Browser   │◄───────►│   Express   │◄───────►│  Shell      │
│  (HTML/JS)  │ WebSocket│   Server    │  spawn  │  Scripts    │
└─────────────┘         └─────────────┘         └─────────────┘
       │                       │                       │
       │                       │                       │
       ▼                       ▼                       ▼
  User Input              File Upload            create-password.sh
  Real-time UI            Log Storage            user-data.sh
```

**Tech Stack:**
- **Backend:** Node.js + Express
- **WebSocket:** ws library
- **Frontend:** Vanilla JavaScript (no framework)
- **File Upload:** Multer
- **Styling:** Custom CSS with CSS Grid

## Configuration

### Environment Variables

```bash
# Server port (default: 3000)
PORT=3000
```

### Directory Structure

```
ec2-set-ssh-password/
├── server.js              # Express server
├── package.json           # Dependencies
├── start-ui.sh           # Launcher script
├── create-password.sh    # Main automation script
├── user-data.sh          # EC2 user data template
├── public/               # Static files
│   ├── index.html       # Web UI
│   ├── css/
│   │   └── style.css    # Styling
│   └── js/
│       └── app.js       # Frontend logic
├── uploads/             # Temporary PEM keys (auto-cleanup)
└── logs/                # Execution logs (auto-cleanup)
```

## Security Features

### File Security
- PEM keys automatically deleted after 5 seconds
- Files set to 400 permissions on upload
- Old files cleaned up after 24 hours
- No permanent storage of credentials

### Input Validation
- Password strength checking
- File type validation
- Size limits on uploads (10KB max)
- SQL injection prevention (no database)

### Network Security
- CORS headers (configurable)
- WebSocket authentication via client ID
- No password storage or logging
- HTTPS ready (use reverse proxy)

## Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start server
pm2 start server.js --name ec2-password-ui

# Enable auto-restart on system boot
pm2 startup
pm2 save
```

### Using Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t ec2-password-ui .
docker run -p 3000:3000 ec2-password-ui
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

## Troubleshooting

### WebSocket Connection Failed

**Issue:** "Disconnected" status in UI

**Solutions:**
- Check if server is running
- Verify firewall allows WebSocket connections
- Check browser console for errors
- Try different port: `PORT=8080 npm start`

### File Upload Failed

**Issue:** "Upload failed" error

**Solutions:**
- Ensure `uploads/` directory exists and is writable
- Check file is actually a PEM key
- Verify file size < 10KB
- Check disk space

### Script Execution Failed

**Issue:** Setup fails with exit code

**Solutions:**
- Check EC2 security group allows SSH (port 22)
- Verify PEM key matches the instance
- Ensure correct username for AMI type
- Check EC2 instance is running
- View logs in UI for detailed error

### Connection Timeout

**Issue:** "Connection test failed"

**Solutions:**
```bash
# Test manually
ssh -i your-key.pem ec2-user@your-instance-ip

# Check security group
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Verify instance status
aws ec2 describe-instances --instance-ids i-xxxxx
```

## Development

### Run in Development Mode

```bash
# Install nodemon
npm install

# Start with auto-reload
npm run dev
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm start
```

### Testing

```bash
# Test API endpoints
curl http://localhost:3000/api/health

# Test WebSocket
wscat -c ws://localhost:3000
```

## Browser Support

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and questions:
- GitHub Issues: [Report Bug](https://github.com/...)
- Documentation: See main README.md
