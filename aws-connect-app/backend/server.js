const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const fs = require('fs/promises');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for decoupled architecture
        methods: ["GET", "POST"]
    }
});

const PORT = 8099;

// Middleware
app.use(cors()); // Allow all origins for REST API
app.use(express.json());

// API: Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', host: os.hostname(), uptime: process.uptime() });
});

// API: File Explorer
app.get('/api/files', async (req, res) => {
    const queryPath = req.query.path || process.env.HOME || '/';
    
    try {
        const entries = await fs.readdir(queryPath, { withFileTypes: true });
        const result = entries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'folder' : 'file',
            path: path.join(queryPath, entry.name)
        }));
        
        // Sort folders first
        result.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // 1. Terminal PTY
    let ptyProcess = null;

    socket.on('spawn-terminal', () => {
        if (ptyProcess) return;
        
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: process.env.HOME,
            env: process.env
        });

        ptyProcess.onData((data) => {
            socket.emit('terminal-output', data);
        });
        
        socket.on('terminal-input', (data) => {
            if (ptyProcess) ptyProcess.write(data);
        });

        socket.on('terminal-resize', (size) => {
            if (ptyProcess && size.cols && size.rows) {
                ptyProcess.resize(size.cols, size.rows);
            }
        });
    });

    // 2. Docker Logs Simulation
    let logInterval = null;

    socket.on('start-logs', () => {
        if (logInterval) clearInterval(logInterval);
        logInterval = setInterval(() => {
            const timestamp = new Date().toISOString();
            const logType = Math.random() > 0.9 ? 'ERROR' : 'INFO';
            const msg = `[${timestamp}] [${logType}] Container health check: OK - Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`;
            socket.emit('logs-output', msg + '\r\n');
        }, 2000);
    });

    socket.on('stop-logs', () => {
        if (logInterval) clearInterval(logInterval);
    });

    // Cleanup
    socket.on('disconnect', () => {
        if (ptyProcess) ptyProcess.kill();
        if (logInterval) clearInterval(logInterval);
        console.log('Client disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
