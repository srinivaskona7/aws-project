// Initialize Xterm.js
document.addEventListener('DOMContentLoaded', () => {
    // === 1. Main Terminal (Shell) ===
    const terminalContainer = document.getElementById('terminal');
    const term = new Terminal({
        cursorBlink: true,
        fontFamily: "'Fira Code', monospace",
        fontSize: 14,
        lineHeight: 1.2,
        theme: {
            background: '#1e1e1e00',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            selectionBackground: '#264f78'
        }
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainer);
    fitAddon.fit();

    // === 2. Docker Logs Terminal ===
    const logsContainer = document.getElementById('terminal-logs');
    const termLogs = new Terminal({
        cursorBlink: false,
        disableStdin: true, // Read-only
        fontFamily: "'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        theme: {
            background: '#1e1e1e00',
            foreground: '#a9b7c6',
            cursor: 'transparent',
            selectionBackground: '#264f78'
        }
    });
    const fitAddonLogs = new FitAddon.FitAddon();
    termLogs.loadAddon(fitAddonLogs);
    termLogs.open(logsContainer);
    // Note: fit() needs to be called when container is visible

    // === Connection Logic ===
    let socket;
    let API_BASE = '';
    
    // Check LocalStorage
    const savedHost = localStorage.getItem('term_host');
    const savedPort = localStorage.getItem('term_port');
    
    if (savedHost) document.getElementById('server-host').value = savedHost;
    if (savedPort) document.getElementById('server-port').value = savedPort;

    document.getElementById('connectBtn').addEventListener('click', () => {
        const host = document.getElementById('server-host').value.replace(/\/$/, '');
        const port = document.getElementById('server-port').value;
        
        if (!host || !port) {
            showError('Please enter host and port');
            return;
        }
        
        // Construct API URL (Handle Protocol)
        const protocol = location.protocol === 'https:' ? 'https:' : 'http:';
        // If host includes http/https, use it, else prepend
        let fullUrl = host;
        if (!host.startsWith('http')) {
            fullUrl = `${protocol}//${host}:${port}`;
        }

        API_BASE = fullUrl;
        connectToServer(fullUrl);
    });

    function showError(msg) {
        document.getElementById('connectionError').textContent = msg;
    }

    function connectToServer(url) {
        document.getElementById('connectBtn').textContent = 'Connecting...';
        document.getElementById('connectionError').textContent = '';

        try {
            socket = io(url, {
                reconnectionAttempts: 3,
                timeout: 5000
            });

            socket.on('connect', () => {
                console.log('Connected to ' + url);
                
                // Save success
                localStorage.setItem('term_host', document.getElementById('server-host').value);
                localStorage.setItem('term_port', document.getElementById('server-port').value);

                // Hide Overlay
                document.getElementById('connection-overlay').style.display = 'none';
                
                // Init Logic
                initializeTerminalLogic();
            });

            socket.on('connect_error', (err) => {
                console.error('Connection Failed', err);
                showError(`Connection Failed: ${err.message}. Check CORS or IP.`);
                document.getElementById('connectBtn').textContent = 'Connect';
                socket.disconnect();
            });

        } catch (e) {
            showError(e.message);
        }
    }

    function initializeTerminalLogic() {
        // A. Shell Events
        socket.emit('spawn-terminal'); // Request spawn
        socket.on('terminal-output', (data) => term.write(data));
        term.onData((data) => socket.emit('terminal-input', data));

        // B. Logs Events
        socket.on('logs-output', (data) => termLogs.write(data));
        
        // Initial Resize & Focus
        setTimeout(() => {
            fitAddon.fit();
            socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
            term.focus();
        }, 100);

        // Load Files
        loadFileTree('/', document.getElementById('fileTree'));
        checkEnvironment();
    }

    // Handle Resize (Global)
    window.addEventListener('resize', () => {
        fitAddon.fit();
        if (logsContainer.style.display !== 'none') fitAddonLogs.fit();
        if (socket && socket.connected) {
            socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
        }
    });
    
    // ... Rest of UI logic (Tabs, File Tree etc) uses socket/API_BASE ...

    // === Tab Switching Logic ===
    const tabTerminal = document.getElementById('tab-terminal');
    const tabLogs = document.getElementById('tab-logs');

    tabTerminal.addEventListener('click', () => {
        activateTab('terminal');
    });

    tabLogs.addEventListener('click', () => {
        activateTab('logs');
    });

    function activateTab(tabName) {
        if (tabName === 'terminal') {
            tabTerminal.classList.add('active');
            tabLogs.classList.remove('active');
            terminalContainer.style.display = 'block';
            logsContainer.style.display = 'none';
            fitAddon.fit();
            term.focus();
            socket.emit('stop-logs');
        } else {
            tabLogs.classList.add('active');
            tabTerminal.classList.remove('active');
            terminalContainer.style.display = 'none';
            logsContainer.style.display = 'block';
            fitAddonLogs.fit();
            socket.emit('start-logs');
        }
    }

    // === File Explorer (Real) ===
    const fileTree = document.getElementById('fileTree');
    
    // Initial Load - MOVED to initializeTerminalLogic
    // loadFileTree('/', fileTree);

    async function loadFileTree(path, container) {
        container.innerHTML = ''; // Clear loading/existing
        try {
            // Use API_BASE for fetch
            const res = await fetch(`${API_BASE}/api/files?path=${encodeURIComponent(path)}`);
            const files = await res.json();

            if (files.error) throw new Error(files.error);

            files.forEach(file => {
                const item = document.createElement('div');
                item.className = `tree-item ${file.type}`;
                item.dataset.path = file.path;
                
                const icon = file.type === 'folder' ? '📁' : '📄';
                const arrow = file.type === 'folder' ? '<span class="arrow">▶</span> ' : '<span class="indent"></span> ';
                
                item.innerHTML = `${arrow}<span class="icon">${icon}</span> <span class="label">${file.name}</span>`;
                container.appendChild(item);

                if (file.type === 'folder') {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'tree-children';
                    childrenContainer.style.display = 'none';
                    childrenContainer.id = `children-${file.path.replace(/[^a-z0-9]/gi, '-')}`;
                    container.appendChild(childrenContainer);

                    item.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        item.classList.toggle('collapsed'); // Visual toggle
                        const isExpanded = item.classList.contains('expanded');
                        
                        // Toggle logic
                        if (childrenContainer.style.display === 'none') {
                            childrenContainer.style.display = 'block';
                            item.querySelector('.arrow').innerHTML = '▼';
                            item.classList.add('expanded');
                            // Load children if empty
                            if (childrenContainer.children.length === 0) {
                                loadFileTree(file.path, childrenContainer);
                            }
                        } else {
                            childrenContainer.style.display = 'none';
                            item.querySelector('.arrow').innerHTML = '▶';
                            item.classList.remove('expanded');
                        }
                    });
                } else {
                    // File Click -> Open in Terminal (cat)
                    item.addEventListener('click', () => {
                        // Switch to terminal and cat the file
                        activateTab('terminal');
                        socket.emit('terminal-input', `cat "${file.path}"\r`);
                    });
                }
            });
        } catch (err) {
            console.error('Failed to load files', err);
            container.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
        }
    }

    // === Environment Check ===
    // checkEnvironment(); - MOVED to initializeTerminalLogic

    async function checkEnvironment() {
        const indicator = document.getElementById('envIndicator');
        const text = indicator.querySelector('.env-text');

        try {
            const res = await fetch(`${API_BASE}/api/health`);
            const data = await res.json();
            
            indicator.classList.add('connected');
            if (data.host.includes('ec2') || data.host.includes('aws')) {
                indicator.classList.add('aws');
                text.textContent = 'AWS Connected';
            } else {
                text.textContent = 'Local Environment';
            }
        } catch (e) {
            text.textContent = 'Offline';
            term.write(`\r\n\x1b[31m✖ Backend connection failed.\x1b[0m\r\n`);
        }
    }
});
