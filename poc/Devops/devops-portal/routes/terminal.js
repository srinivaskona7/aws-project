'use strict';
const express = require('express');
const router = express.Router();
const { Client: SSHClient } = require('ssh2');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const WORK_DIR = path.join(os.tmpdir(), 'devops-portal');

// POST /api/terminal/test-connection - Test SSH before opening terminal
router.post('/terminal/test-connection', async (req, res) => {
  const { host, port = 22, username, privateKey, password } = req.body;
  if (!host || !username) return res.status(400).json({ error: 'host and username required' });

  const conn = new SSHClient();
  const timeout = setTimeout(() => {
    conn.destroy();
    res.status(504).json({ error: 'Connection timed out after 10 seconds' });
  }, 10000);

  conn.on('ready', () => {
    clearTimeout(timeout);
    conn.end();
    res.json({ success: true, message: `SSH connection to ${host} successful`, host, username });
  });

  conn.on('error', (err) => {
    clearTimeout(timeout);
    res.status(400).json({ error: `SSH error: ${err.message}` });
  });

  try {
    const connConfig = { host, port: parseInt(port), username, readyTimeout: 10000 };
    if (privateKey) {
      connConfig.privateKey = Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey);
    } else if (password) {
      connConfig.password = password;
    } else {
      return res.status(400).json({ error: 'Either privateKey or password required' });
    }
    conn.connect(connConfig);
  } catch (err) {
    clearTimeout(timeout);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/terminal/exec - Execute single command over SSH
router.post('/terminal/exec', async (req, res) => {
  const { host, port = 22, username, privateKey, password, command } = req.body;
  if (!host || !username || !command) return res.status(400).json({ error: 'host, username, command required' });

  const conn = new SSHClient();
  let output = '';
  let stderr = '';

  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        conn.end();
        return res.status(400).json({ error: err.message });
      }
      stream.on('data', d => { output += d.toString(); });
      stream.stderr.on('data', d => { stderr += d.toString(); });
      stream.on('close', (code) => {
        conn.end();
        res.json({ success: true, output, stderr, exitCode: code, host, command });
      });
    });
  });

  conn.on('error', err => res.status(400).json({ error: err.message }));

  const connConfig = { host, port: parseInt(port), username, readyTimeout: 10000 };
  if (privateKey) connConfig.privateKey = Buffer.from(privateKey);
  else if (password) connConfig.password = password;
  else return res.status(400).json({ error: 'privateKey or password required' });
  conn.connect(connConfig);
});

// Store SSH sessions in memory (for WebSocket reference)
const sshSessions = new Map();

// POST /api/terminal/sessions - list active sessions
router.get('/terminal/sessions', (req, res) => {
  const sessions = Array.from(sshSessions.entries()).map(([id, s]) => ({
    id,
    host: s.host,
    username: s.username,
    connectedAt: s.connectedAt
  }));
  res.json({ sessions });
});

module.exports = router;
module.exports.sshSessions = sshSessions;
