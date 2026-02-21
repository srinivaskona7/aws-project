'use strict';
const WebSocket = require('ws');
const { Client: SSHClient } = require('ssh2');

/**
 * Setup WebSocket SSH terminal handler
 * Clients connect to ws://host/ws
 * Then send: { type: 'ssh_connect', host, port, username, privateKey|password }
 * Bidirectional: { type: 'data', data: '...' } for stdin/stdout
 */
module.exports = function setupTerminalWS(wss) {
  wss.on('connection', (ws, req) => {
    let sshClient = null;
    let sshStream = null;
    let isSSHSession = false;

    ws.on('message', (rawMsg) => {
      let msg;
      try {
        msg = JSON.parse(rawMsg.toString());
      } catch (e) {
        // Binary/raw data - pipe to SSH if connected
        if (sshStream && isSSHSession) {
          sshStream.write(rawMsg);
        }
        return;
      }

      if (msg.type === 'ssh_connect') {
        // Start SSH connection
        if (sshClient) {
          sshClient.destroy();
          sshClient = null;
        }

        sshClient = new SSHClient();

        sshClient.on('ready', () => {
          isSSHSession = true;
          ws.send(JSON.stringify({ type: 'connected', message: `Connected to ${msg.host}` }));

          sshClient.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
              return;
            }

            sshStream = stream;

            // SSH -> WebSocket
            stream.on('data', (data) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: data.toString('utf8') }));
              }
            });

            stream.stderr.on('data', (data) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: data.toString('utf8') }));
              }
            });

            stream.on('close', () => {
              isSSHSession = false;
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'closed', message: 'SSH session closed' }));
              }
              sshClient.end();
            });

            stream.on('error', (err) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
              }
            });
          });
        });

        sshClient.on('error', (err) => {
          isSSHSession = false;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: `SSH error: ${err.message}` }));
          }
        });

        sshClient.on('close', () => {
          isSSHSession = false;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'closed', message: 'Connection closed' }));
          }
        });

        // Build connection config
        const connConfig = {
          host: msg.host,
          port: parseInt(msg.port) || 22,
          username: msg.username || 'ec2-user',
          readyTimeout: 15000,
          keepaliveInterval: 10000
        };

        if (msg.privateKey) {
          connConfig.privateKey = Buffer.from(msg.privateKey);
        } else if (msg.password) {
          connConfig.password = msg.password;
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'No authentication method provided' }));
          return;
        }

        try {
          sshClient.connect(connConfig);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }

      } else if (msg.type === 'data' && isSSHSession && sshStream) {
        // WebSocket -> SSH stdin
        sshStream.write(msg.data);

      } else if (msg.type === 'resize' && sshStream) {
        // Terminal resize
        sshStream.setWindow(msg.rows || 24, msg.cols || 80);

      } else if (msg.type === 'disconnect') {
        // Clean disconnect
        if (sshStream) { sshStream.close(); sshStream = null; }
        if (sshClient) { sshClient.destroy(); sshClient = null; }
        isSSHSession = false;
        ws.send(JSON.stringify({ type: 'closed', message: 'Disconnected' }));
      }
      // Other message types (like 'connected', 'log') are ignored for SSH routing
    });

    ws.on('close', () => {
      if (sshStream) { try { sshStream.close(); } catch(e) {} sshStream = null; }
      if (sshClient) { try { sshClient.destroy(); } catch(e) {} sshClient = null; }
      isSSHSession = false;
    });

    ws.on('error', (err) => {
      if (sshStream) { try { sshStream.close(); } catch(e) {} sshStream = null; }
      if (sshClient) { try { sshClient.destroy(); } catch(e) {} sshClient = null; }
      isSSHSession = false;
    });
  });
};
