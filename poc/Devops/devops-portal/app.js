'use strict';
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, loginHandler, logoutHandler } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use('/api/', limiter);

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'devops-portal-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket for log streaming
const logClients = new Map();
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  logClients.set(clientId, ws);
  ws.send(JSON.stringify({ type: 'connected', clientId }));
  ws.on('close', () => logClients.delete(clientId));
  ws.on('error', () => logClients.delete(clientId));
});

// Broadcast log line to all connected clients
app.locals.broadcast = (jobId, data) => {
  const msg = JSON.stringify({ type: 'log', jobId, data, ts: Date.now() });
  logClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
};

// Auth routes (no auth required)
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', requireAuth, logoutHandler);
app.get('/api/auth/me', (req, res) => {
  if (req.session.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not logged in' });
});

// Store IAM credentials in session
app.post('/api/credentials', requireAuth, (req, res) => {
  const { accessKeyId, secretAccessKey, region, sessionToken } = req.body;
  if (!accessKeyId || !secretAccessKey) {
    return res.status(400).json({ error: 'accessKeyId and secretAccessKey are required' });
  }
  req.session.awsCreds = { accessKeyId, secretAccessKey, region: region || 'us-east-1', sessionToken };
  res.json({ success: true, message: 'AWS credentials stored for this session', region: region || 'us-east-1' });
});

app.get('/api/credentials/status', requireAuth, (req, res) => {
  if (req.session.awsCreds) {
    const { accessKeyId, region } = req.session.awsCreds;
    res.json({ configured: true, accessKeyId: accessKeyId.substring(0, 8) + '****', region });
  } else {
    res.json({ configured: false });
  }
});

app.delete('/api/credentials', requireAuth, (req, res) => {
  delete req.session.awsCreds;
  res.json({ success: true, message: 'AWS credentials cleared' });
});

// Mount all routes (all require auth)
const awsCore = require('./routes/aws-core');
const infrastructure = require('./routes/infrastructure');
const containers = require('./routes/containers');
const services = require('./routes/services');
const terminal = require('./routes/terminal');
const advanced = require('./routes/advanced');
const newServices = require('./routes/new-services');
const moreServices = require('./routes/more-services');

app.use('/api', requireAuth, awsCore);
app.use('/api', requireAuth, infrastructure);
app.use('/api', requireAuth, containers);
app.use('/api', requireAuth, services);
app.use('/api', requireAuth, terminal);
app.use('/api', requireAuth, advanced);
app.use('/api', requireAuth, newServices);
app.use('/api', requireAuth, moreServices);

// SSH terminal WebSocket (separate path)
const terminalHandler = require('./routes/terminal-ws');
terminalHandler(wss, server);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), ts: new Date() }));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  DevOps Portal running on port ${PORT}  ║`);
  console.log(`║  Login: admin / password              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

module.exports = { app, server };
