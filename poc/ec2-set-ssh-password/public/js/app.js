/* ── EC2 OPS CONSOLE ── app.js ── */

// ─── STATE ───
let ws = null;
let clientId = null;
let autoScroll = true;
let uploadedPemPath = null;
let originalPemFilename = null;
let uploadedPemContent = null;
let logCount = 0;
let setupComplete = false;
let currentFontSize = 16;
let currentFont = "'JetBrains Mono', monospace";
let appInitialized = false;

// Terminal state
let term = null;
let fitAddon = null;
let termConnected = false;

// Resource dashboard state
let resourceData = null;
let resourceHistory = [];
let liveMonitoring = false;
let liveInterval = null;

// Audit state
let auditPage = 1;
let auditFilter = '';
let auditSearch = '';
let auditSearchTimer = null;
let auditCount = 0;

// Process manager state
let processData = null;
let processSortBy = 'cpu';
let processSortDesc = true;
let processFilter = '';
let processLive = false;
let processInterval = null;

// Service status state
let serviceData = null;

// SFTP state
let currentRemotePath = '/home';
let sftpFiles = [];
let directoryTree = {};
let selectedTreePath = '/home';
let editorOpen = false;
let editorPath = '';
let editorOriginal = '';
let editorModified = false;

// File clipboard state
let fileClipboard = null;

// File search state
let fileSearchQuery = '';
let fileSearchResults = [];
let fileSearchActive = false;
let fileSearchContent = false;

// Permissions dialog state
let permDialogOpen = false;
let permDialogPath = '';
let permDialogPerms = '0644';

// Command snippets state
let snippets = [];
let snippetsPanelOpen = false;

// Terminal recording state
let isRecording = false;
let recordingData = [];
let recordingStartTime = 0;
let recordings = [];
let playbackTerm = null;
let playbackActive = false;

// Network monitoring state
let networkData = null;
let networkLive = false;
let networkInterval = null;

// Notification state
let notificationThresholds = JSON.parse(localStorage.getItem('ec2ops-thresholds') || '{"cpuWarn":70,"cpuCrit":90,"memWarn":70,"memCrit":90,"diskWarn":80,"diskCrit":95}');
let notificationsEnabled = localStorage.getItem('ec2ops-notifications') === 'true';
let lastNotificationTime = {};

// User management state
let userData = null;
let addUserDialogOpen = false;

// SSH keys state
let sshKeysData = null;
let addKeyDialogOpen = false;

// Docker state
let dockerAvailable = null;
let dockerVersion = '';
let dockerComposeVersion = '';
let dockerHasCompose = false;
let dockerActiveSubTab = 'containers';
let dockerContainers = null;
let dockerContainerFilter = '';
let dockerContainerSortBy = 'name';
let dockerContainerSortDesc = false;
let dockerStatsHistory = {};
let dockerLive = false;
let dockerLiveInterval = null;
let dockerImages = null;
let dockerComposeData = null;
let dockerComposeFiles = null;
let dockerSelectedComposePath = '';
let dockerVolumes = null;
let dockerNetworks = null;
let dockerPruneDialogOpen = false;
let dockerPullDialogOpen = false;
let dockerDiskUsage = '';
let dockerInspectData = null;
let dockerInspectContainerId = null;
let dockerLogsContainerId = null;
let dockerLogsContainerName = '';
let dockerLogsContent = '';
let dockerLogsFollow = false;
let dockerLogsFilter = '';
let dockerLogsStreaming = false;
let dockerShellContainerId = null;
let dockerShellContainerName = '';
let dockerShellTerm = null;
let dockerShellFitAddon = null;
let dockerShellActive = false;
let dockerVolumeInspect = null;
let dockerNetworkInspect = null;
let dockerCreateVolumeOpen = false;
let dockerCreateNetworkOpen = false;

// Package management state
let packageData = null;
let packageInstalling = false;
let packageSearchResults = null;
let packageFilter = '';

// System info state
let systemInfoData = null;
let hostnameTimezoneData = null;
let swapData = null;
let swapCreating = false;

// Security state
let securityData = null;
let securityInstalling = false;

// Cloud-init state
let cloudInitContent = '';
let cloudInitStreaming = false;
let cloudInitVisible = false;

// Batch state
let batchData = null;
let batchRunning = false;
let batchId = null;
let batchResults = {};

// Check if connected to a host
function isConnected() {
    return termConnected && ws && ws.readyState === WebSocket.OPEN && clientId;
}

// Check if a deploy/connect process is actively running
function isProcessRunning() {
    const setupBtn = document.getElementById('setupBtn');
    return setupBtn && setupBtn.classList.contains('running');
}

// Theme definitions (for xterm theme matching)
const XTERM_THEMES = {
    phosphor: {
        background: '#0a0c12', foreground: '#c8ccd8', cursor: '#22d47e',
        cursorAccent: '#0a0c12', selectionBackground: 'rgba(34,212,126,.2)',
        black: '#1a1d28', red: '#e54545', green: '#22d47e', yellow: '#e8a735',
        blue: '#4ea4f6', magenta: '#c678dd', cyan: '#56b6c2', white: '#c8ccd8',
        brightBlack: '#5c6178', brightRed: '#f07178', brightGreen: '#3de88e',
        brightYellow: '#f0c674', brightBlue: '#6cb6ff', brightMagenta: '#d19af0',
        brightCyan: '#73d0d8', brightWhite: '#ffffff',
    },
    amber: {
        background: '#0a0c12', foreground: '#c8ccd8', cursor: '#e8a735',
        cursorAccent: '#0a0c12', selectionBackground: 'rgba(232,167,53,.2)',
        black: '#1a1d28', red: '#e54545', green: '#22d47e', yellow: '#e8a735',
        blue: '#4ea4f6', magenta: '#c678dd', cyan: '#56b6c2', white: '#c8ccd8',
        brightBlack: '#5c6178', brightRed: '#f07178', brightGreen: '#3de88e',
        brightYellow: '#f0c674', brightBlue: '#6cb6ff', brightMagenta: '#d19af0',
        brightCyan: '#73d0d8', brightWhite: '#ffffff',
    },
    frost: {
        background: '#0a0c12', foreground: '#c8ccd8', cursor: '#4ea4f6',
        cursorAccent: '#0a0c12', selectionBackground: 'rgba(78,164,246,.2)',
        black: '#1a1d28', red: '#e54545', green: '#22d47e', yellow: '#e8a735',
        blue: '#4ea4f6', magenta: '#c678dd', cyan: '#56b6c2', white: '#c8ccd8',
        brightBlack: '#5c6178', brightRed: '#f07178', brightGreen: '#3de88e',
        brightYellow: '#f0c674', brightBlue: '#6cb6ff', brightMagenta: '#d19af0',
        brightCyan: '#73d0d8', brightWhite: '#ffffff',
    },
    crimson: {
        background: '#0a0c12', foreground: '#c8ccd8', cursor: '#e54545',
        cursorAccent: '#0a0c12', selectionBackground: 'rgba(229,69,69,.2)',
        black: '#1a1d28', red: '#e54545', green: '#22d47e', yellow: '#e8a735',
        blue: '#4ea4f6', magenta: '#c678dd', cyan: '#56b6c2', white: '#c8ccd8',
        brightBlack: '#5c6178', brightRed: '#f07178', brightGreen: '#3de88e',
        brightYellow: '#f0c674', brightBlue: '#6cb6ff', brightMagenta: '#d19af0',
        brightCyan: '#73d0d8', brightWhite: '#ffffff',
    },
    daylight: {
        background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#059669',
        cursorAccent: '#1e1e1e', selectionBackground: 'rgba(5,150,105,.25)',
        black: '#1e1e1e', red: '#dc2626', green: '#059669', yellow: '#d97706',
        blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#d4d4d4',
        brightBlack: '#6b7280', brightRed: '#ef4444', brightGreen: '#10b981',
        brightYellow: '#f59e0b', brightBlue: '#3b82f6', brightMagenta: '#8b5cf6',
        brightCyan: '#06b6d4', brightWhite: '#ffffff',
    }
};

// ─── CLOCK ───
function tickClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}:${s}`;
}
setInterval(tickClock, 1000);
tickClock();

// ─── WEBSOCKET ───
function initWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus(true);
    };

    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        switch (data.type) {
            case 'connected':
                clientId = data.clientId;
                console.log('Client ID assigned:', clientId);
                break;
            case 'log':
                addLog(data.message, data.level, isProcessRunning());
                break;
            case 'complete':
                handleCompletion(data);
                break;
            case 'terminal-output':
                if (term) term.write(data.data);
                if (isRecording) recordingData.push({ t: Date.now() - recordingStartTime, d: data.data });
                break;
            case 'terminal-exit':
                handleTerminalExit();
                break;
            case 'health-update':
                // Health updates are handled by the chooser page
                break;
            case 'audit-entry':
                auditCount++;
                document.getElementById('auditCount').textContent = auditCount;
                // Re-render if audit tab active
                if (document.querySelector('[data-tab="audit"]').classList.contains('active')) {
                    fetchAuditLog();
                }
                break;
            case 'sftp-progress':
                updateSftpProgress(data);
                break;
            case 'docker-log-output':
                if (dockerLogsContainerId === data.containerId) {
                    dockerLogsContent += data.data;
                    renderDockerLogsContent();
                }
                break;
            case 'docker-shell-output':
                if (dockerShellTerm) dockerShellTerm.write(data.data);
                break;
            case 'docker-shell-exit':
                handleDockerShellExit();
                break;
            case 'package-install-progress':
                handlePackageInstallProgress(data);
                break;
            case 'docker-install-progress':
                addLog(data.data || 'Installing...', 'info');
                break;
            case 'docker-install-complete':
                addLog('Docker installation ' + (data.success ? 'completed' : 'failed'), data.success ? 'success' : 'error');
                if (data.success) { dockerAvailable = null; fetchDockerCheck(); }
                break;
            case 'swap-progress':
                addLog(data.message || '', data.error ? 'error' : 'info');
                break;
            case 'swap-complete':
                swapCreating = false;
                addLog('Swap ' + (data.success ? 'created successfully' : 'creation failed'), data.success ? 'success' : 'error');
                if (data.success) fetchSwapStatus();
                break;
            case 'cloud-init-output':
                cloudInitContent += data.data;
                if (cloudInitVisible) renderCloudInitViewer();
                break;
            case 'security-install-progress':
                if (data.data) addLog(data.data, 'info');
                if (data.done) {
                    securityInstalling = false;
                    addLog('Security operation ' + (data.success ? 'completed' : 'failed'), data.success ? 'success' : 'error');
                    fetchSecurityStatus();
                }
                break;
            case 'batch-host-progress':
                handleBatchHostProgress(data);
                break;
            case 'batch-complete':
                handleBatchComplete(data);
                break;
        }
    };

    ws.onclose = () => {
        updateConnectionStatus(false);
        if (appInitialized) {
            setTimeout(initWebSocket, 3000);
        }
    };

    ws.onerror = () => updateConnectionStatus(false);
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('connectionStatus');
    const txt = document.getElementById('statusText');
    if (connected) {
        dot.classList.add('connected');
        txt.textContent = 'ONLINE';
    } else {
        dot.classList.remove('connected');
        txt.textContent = 'OFFLINE';
    }
}

// ─── LOGGING ───
function addLog(message, level = 'info', spinning = false) {
    const container = document.getElementById('logsContainer');

    // Stop any previous spinning flower
    const prevSpinner = container.querySelector('.flower-pointer.spinning');
    if (prevSpinner) prevSpinner.classList.remove('spinning');

    const line = document.createElement('div');
    line.className = `log-line log-${level}`;

    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    line.innerHTML = `<span class="ts">${ts}</span><span class="flower-pointer${spinning ? ' spinning' : ''}">✻</span><span class="msg">${escapeHtml(message)}</span>`;
    container.appendChild(line);

    logCount++;
    document.getElementById('logCount').textContent = logCount;

    if (autoScroll) {
        container.scrollTop = container.scrollHeight;
    }
}

function clearLogs() {
    const container = document.getElementById('logsContainer');
    container.innerHTML = '';
    logCount = 0;
    document.getElementById('logCount').textContent = '0';
    addLog('Logs cleared', 'system');
}

function downloadLogs() {
    const container = document.getElementById('logsContainer');
    const text = container.innerText;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ec2-ops-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ─── MODE SWITCHING ───
function switchMode(mode) {
    // Show/hide fields based on data-modes attribute
    document.querySelectorAll('[data-modes]').forEach(el => {
        const modes = el.dataset.modes.split(' ');
        el.classList.toggle('field-hidden', !modes.includes(mode));
    });

    // Update password label and placeholder
    const passLabel = document.getElementById('passwordLabel');
    const passInput = document.getElementById('password');
    if (passLabel) {
        passLabel.textContent = mode === 'root-login' ? 'PASSWORD' : 'ROOT PASSWORD';
    }
    if (passInput) {
        passInput.placeholder = mode === 'root-login' ? 'root password' : 'set root password';
    }
}

// ─── TAB SWITCHING ───
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update panels
    document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
    const panelMap = {
        logs: 'panelLogs', terminal: 'panelTerminal', resources: 'panelResources',
        files: 'panelFiles', audit: 'panelAudit', processes: 'panelProcesses',
        services: 'panelServices', network: 'panelNetwork', users: 'panelUsers',
        docker: 'panelDocker', packages: 'panelPackages', security: 'panelSecurity',
        batch: 'panelBatch'
    };
    const panel = document.getElementById(panelMap[tabName]);
    if (panel) panel.classList.add('active');

    // Fit terminal if switching to it
    if (tabName === 'terminal' && term && fitAddon) {
        setTimeout(() => {
            fitAddon.fit();
            term.focus();
        }, 50);
    }

    // Auto-fetch on first visit when connected
    if (tabName === 'resources' && isConnected() && !resourceData) {
        fetchResources();
    }
    if (tabName === 'processes' && isConnected() && !processData) {
        fetchProcesses();
    }
    if (tabName === 'services' && isConnected() && !serviceData) {
        fetchServices();
    }
    if (tabName === 'files' && isConnected() && sftpFiles.length === 0) {
        fetchRemoteFiles(currentRemotePath);
    }
    if (tabName === 'audit' && auditCount === 0) {
        fetchAuditLog();
    }
    if (tabName === 'network' && isConnected() && !networkData) {
        fetchNetwork();
    }
    if (tabName === 'users' && isConnected() && !userData) {
        fetchUsers();
    }
    if (tabName === 'terminal' && isConnected() && snippets.length === 0) {
        fetchSnippets();
    }
    if (tabName === 'docker' && isConnected() && dockerAvailable === null) {
        fetchDockerCheck();
    }
    if (tabName === 'packages' && isConnected() && !packageData) {
        fetchPackageList();
    }
    if (tabName === 'security' && isConnected() && !securityData) {
        fetchSecurityStatus();
    }

    // Resume/pause live monitoring
    if (tabName === 'resources' && liveMonitoring && !liveInterval && isConnected()) {
        liveInterval = setInterval(fetchResourcesLive, 15000);
    }
    if (tabName !== 'resources' && liveInterval) {
        clearInterval(liveInterval);
        liveInterval = null;
    }

    // Resume/pause process live
    if (tabName === 'processes' && processLive && !processInterval && isConnected()) {
        processInterval = setInterval(fetchProcesses, 10000);
    }
    if (tabName !== 'processes' && processInterval) {
        clearInterval(processInterval);
        processInterval = null;
    }

    // Resume/pause network live
    if (tabName === 'network' && networkLive && !networkInterval && isConnected()) {
        networkInterval = setInterval(fetchNetwork, 10000);
    }
    if (tabName !== 'network' && networkInterval) {
        clearInterval(networkInterval);
        networkInterval = null;
    }

    // Resume/pause docker live
    if (tabName === 'docker' && dockerLive && !dockerLiveInterval && isConnected()) {
        dockerLiveInterval = setInterval(fetchDockerContainers, 10000);
    }
    if (tabName !== 'docker' && dockerLiveInterval) {
        clearInterval(dockerLiveInterval);
        dockerLiveInterval = null;
    }
}

// ─── PEM KEY UPLOAD ───
async function handlePemUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    originalPemFilename = file.name;
    // Read PEM content for session saving
    const reader = new FileReader();
    reader.onload = () => { uploadedPemContent = reader.result; };
    reader.readAsText(file);
    const pemBtn = document.getElementById('pemBtn');
    const pemLabel = document.getElementById('pemLabel');
    const formData = new FormData();
    formData.append('pemKey', file);

    addLog(`Uploading PEM key: ${file.name}`, 'info');

    try {
        const res = await fetch('/api/upload-key', { method: 'POST', body: formData });
        const result = await res.json();

        if (result.success) {
            uploadedPemPath = result.path;
            pemBtn.classList.add('uploaded');
            // Truncate filename if too long
            const name = file.name.length > 12 ? file.name.slice(0, 10) + '..' : file.name;
            pemLabel.textContent = name;
            addLog(`PEM key uploaded`, 'success');
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (err) {
        addLog(`PEM upload failed: ${err.message}`, 'error');
        pemBtn.classList.remove('uploaded');
        pemLabel.textContent = 'PEM KEY';
    }
}

// ─── DEPLOY (SETUP PASSWORD) ───
async function handleDeploy(e) {
    e.preventDefault();

    const mode = document.getElementById('opMode').value;

    // Only process deploy in set-root-password mode
    if (mode !== 'set-root-password') return;

    const ec2Host = document.getElementById('ec2Host').value.trim();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!ec2Host) { addLog('Host address required', 'warning'); return; }
    if (!password) { addLog('Root password required', 'warning'); return; }
    if (!uploadedPemPath) { addLog('PEM key required — click PEM KEY to upload', 'warning'); return; }

    const setupBtn = document.getElementById('setupBtn');
    const progressStrip = document.getElementById('progressStrip');
    const progressFill = document.getElementById('progressFill');

    setupBtn.disabled = true;
    setupBtn.classList.add('running');
    progressStrip.style.display = 'block';
    progressFill.style.width = '20%';

    clearLogs();
    addLog('Initiating deployment sequence...', 'info', true);
    switchTab('logs');

    try {
        progressFill.style.width = '40%';

        const res = await fetch('/api/setup-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password,
                username,
                pemKeyPath: uploadedPemPath,
                ec2Host,
                clientId,
                useUserData: false
            })
        });

        const result = await res.json();

        if (!result.success) {
            throw new Error(result.error || 'Deployment failed');
        }

        progressFill.style.width = '70%';

    } catch (err) {
        addLog(`DEPLOY ERROR: ${err.message}`, 'error');
        progressStrip.style.display = 'none';
        setupBtn.disabled = false;
        setupBtn.classList.remove('running');
    }
}

function handleCompletion(data) {
    const progressFill = document.getElementById('progressFill');
    const progressStrip = document.getElementById('progressStrip');
    const setupBtn = document.getElementById('setupBtn');

    // Stop any spinning flower pointers
    document.querySelectorAll('.flower-pointer.spinning').forEach(el => el.classList.remove('spinning'));

    progressFill.style.width = '100%';

    setTimeout(() => {
        progressStrip.style.display = 'none';
        setupBtn.disabled = false;
        setupBtn.classList.remove('running');
    }, 600);

    if (data.success) {
        addLog('DEPLOYMENT COMPLETE — root password configured', 'success');
        addLog(`You can now SSH in as root@${document.getElementById('ec2Host').value}`, 'success');
        setupComplete = true;
    } else {
        addLog(`DEPLOYMENT FAILED: ${data.message}`, 'error');
    }

    // Save deploy session to history
    saveSession({
        host: document.getElementById('ec2Host').value.trim(),
        username: document.getElementById('username').value,
        mode: 'set-root-password',
        timestamp: new Date().toISOString(),
        status: data.success ? 'success' : 'failure'
    });
}

// ─── SSH TERMINAL ───
function initTerminal() {
    if (term) return; // Already initialized

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'daylight';
    const xtermTheme = XTERM_THEMES[currentTheme] || XTERM_THEMES.daylight;

    term = new Terminal({
        fontFamily: currentFont,
        fontSize: currentFontSize,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'block',
        theme: xtermTheme
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    const container = document.getElementById('terminalContainer');
    term.open(container);
    fitAddon.fit();

    // Forward keystrokes to backend
    term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN && termConnected) {
            ws.send(JSON.stringify({
                type: 'terminal-input',
                data: data,
                clientId: clientId
            }));
        }
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN && termConnected) {
            ws.send(JSON.stringify({
                type: 'terminal-resize',
                cols,
                rows,
                clientId: clientId
            }));
        }
    });

    // Window resize → refit
    window.addEventListener('resize', () => {
        if (fitAddon && document.getElementById('panelTerminal').classList.contains('active')) {
            fitAddon.fit();
        }
    });
}

async function loginToEC2() {
    const mode = document.getElementById('opMode').value;
    const ec2Host = document.getElementById('ec2Host').value.trim();

    if (!ec2Host) { addLog('Host address required for SSH', 'warning'); return; }

    if (!clientId || !ws || ws.readyState !== WebSocket.OPEN) {
        addLog('WebSocket not connected — waiting for reconnect...', 'warning');
        return;
    }

    // Build mode-specific params
    let username, password, pemKeyPath;

    if (mode === 'ssh-login') {
        username = document.getElementById('username').value;
        pemKeyPath = uploadedPemPath;
        password = null;
        if (!pemKeyPath) { addLog('PEM key required for SSH login', 'warning'); return; }
    } else if (mode === 'root-login') {
        username = 'root';
        password = document.getElementById('password').value;
        pemKeyPath = null;
        if (!password) { addLog('Password required for root login', 'warning'); return; }
    }

    const loginBtn = document.getElementById('loginBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const termContainer = document.getElementById('terminalContainer');
    const termPlaceholder = document.getElementById('termPlaceholder');
    const termStatus = document.getElementById('termStatus');

    // Switch to terminal tab
    switchTab('terminal');

    // Initialize terminal if needed
    initTerminal();

    // Animate the placeholder flower while connecting
    const placeholderFlower = document.querySelector('#termPlaceholder .flower-icon');
    if (placeholderFlower) {
        placeholderFlower.classList.remove('idle');
        placeholderFlower.classList.add('connecting');
    }

    // Show terminal, hide placeholder
    termContainer.style.display = 'flex';
    termPlaceholder.style.display = 'none';

    term.clear();

    // Fit after showing
    setTimeout(() => fitAddon.fit(), 100);

    // Request SSH connection
    try {
        const res = await fetch('/api/ssh-connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ec2Host,
                password: password || null,
                username,
                pemKeyPath: pemKeyPath || null,
                clientId
            })
        });

        const result = await res.json();

        // Save session to history
        saveSession({
            host: ec2Host,
            username: username || 'root',
            mode: mode,
            timestamp: new Date().toISOString(),
            status: result.success ? 'success' : 'failure'
        });

        if (result.success) {
            termConnected = true;
            loginBtn.classList.add('active-session');
            disconnectBtn.style.display = 'flex';
            termStatus.classList.add('live');
            addLog(`SSH session opened to ${username}@${ec2Host}`, 'success');

            // Clear terminal for a clean full-screen session
            setTimeout(() => {
                term.clear();
                term.focus();
                if (fitAddon) fitAddon.fit();
            }, 500);

            // Fetch resources after connection
            setTimeout(() => fetchResources(), 1000);
        } else {
            term.writeln(`\x1b[31mConnection failed: ${result.error}\x1b[0m`);
            addLog(`SSH failed: ${result.error}`, 'error');
        }
    } catch (err) {
        term.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
        addLog(`SSH error: ${err.message}`, 'error');
    }
}

function disconnectSSH() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'terminal-disconnect',
            clientId: clientId
        }));
    }
    handleTerminalExit();
}

function handleTerminalExit() {
    termConnected = false;

    const loginBtn = document.getElementById('loginBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const termStatus = document.getElementById('termStatus');

    loginBtn.classList.remove('active-session');
    disconnectBtn.style.display = 'none';
    termStatus.classList.remove('live');

    // Reset placeholder flower to idle
    const placeholderFlower = document.querySelector('#termPlaceholder .flower-icon');
    if (placeholderFlower) {
        placeholderFlower.classList.remove('connecting');
        placeholderFlower.classList.add('idle');
    }

    if (term) {
        term.writeln('\r\n\x1b[2m── Session closed ──\x1b[0m');
    }

    // Reset resources dashboard
    resourceData = null;
    resourceHistory = [];
    if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
    liveMonitoring = false;
    const statusEl = document.getElementById('resourceStatus');
    if (statusEl) statusEl.classList.remove('loaded');
    const dashboard = document.getElementById('resourcesDashboard');
    if (dashboard) {
        dashboard.innerHTML = '<div class="resources-placeholder" id="resourcesPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to view system resources</p></div>';
    }

    // Reset process manager
    processData = null;
    if (processInterval) { clearInterval(processInterval); processInterval = null; }
    processLive = false;
    const processStatus = document.getElementById('processStatus');
    if (processStatus) processStatus.classList.remove('loaded');
    const processDash = document.getElementById('processDashboard');
    if (processDash) {
        processDash.innerHTML = '<div class="resources-placeholder" id="processPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to view processes</p></div>';
    }

    // Reset services
    serviceData = null;
    const serviceStatus = document.getElementById('serviceStatus');
    if (serviceStatus) serviceStatus.classList.remove('loaded');
    const serviceDash = document.getElementById('serviceDashboard');
    if (serviceDash) {
        serviceDash.innerHTML = '<div class="resources-placeholder" id="servicesPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to view services</p></div>';
    }

    // Reset SFTP
    sftpFiles = [];
    currentRemotePath = '/home';
    directoryTree = {};
    selectedTreePath = '/home';
    editorOpen = false;
    editorPath = '';
    editorOriginal = '';
    editorModified = false;
    const filesStatus = document.getElementById('filesStatus');
    if (filesStatus) filesStatus.classList.remove('loaded');
    const sftpDash = document.getElementById('sftpDashboard');
    if (sftpDash) {
        sftpDash.innerHTML = '<div class="resources-placeholder" id="filesPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to browse files</p></div>';
    }

    // Reset header resource indicators
    const headerRes = document.getElementById('headerResources');
    if (headerRes) headerRes.style.display = 'none';
    const headerCpu = document.getElementById('headerCpu');
    const headerMem = document.getElementById('headerMem');
    const headerDisk = document.getElementById('headerDisk');
    if (headerCpu) headerCpu.textContent = '--%';
    if (headerMem) headerMem.textContent = '--%';
    if (headerDisk) headerDisk.textContent = '--%';
    ['headerStatCpu', 'headerStatMem', 'headerStatDisk'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'header-stat';
    });

    // Reset file clipboard and search
    fileClipboard = null;
    fileSearchQuery = '';
    fileSearchResults = [];
    fileSearchActive = false;
    permDialogOpen = false;

    // Reset snippets
    snippetsPanelOpen = false;
    const snippetsBar = document.getElementById('snippetsBar');
    if (snippetsBar) snippetsBar.style.display = 'none';

    // Reset recording
    if (isRecording) { isRecording = false; recordingData = []; }

    // Reset network
    networkData = null;
    if (networkInterval) { clearInterval(networkInterval); networkInterval = null; }
    networkLive = false;
    const networkStatus = document.getElementById('networkStatus');
    if (networkStatus) networkStatus.classList.remove('loaded');
    const networkDash = document.getElementById('networkDashboard');
    if (networkDash) {
        networkDash.innerHTML = '<div class="resources-placeholder" id="networkPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to view network</p></div>';
    }

    // Reset users
    userData = null;
    sshKeysData = null;
    addUserDialogOpen = false;
    addKeyDialogOpen = false;
    const userStatus = document.getElementById('userStatus');
    if (userStatus) userStatus.classList.remove('loaded');
    const userDash = document.getElementById('userDashboard');
    if (userDash) {
        userDash.innerHTML = '<div class="resources-placeholder" id="usersPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to manage users</p></div>';
    }

    // Reset Docker
    dockerAvailable = null;
    dockerContainers = null;
    dockerImages = null;
    dockerComposeData = null;
    dockerComposeFiles = null;
    dockerVolumes = null;
    dockerNetworks = null;
    dockerStatsHistory = {};
    dockerInspectData = null;
    dockerInspectContainerId = null;
    dockerPruneDialogOpen = false;
    dockerPullDialogOpen = false;
    if (dockerLiveInterval) { clearInterval(dockerLiveInterval); dockerLiveInterval = null; }
    dockerLive = false;
    if (dockerLogsStreaming && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'docker-logs-stop', clientId, containerId: dockerLogsContainerId }));
    }
    dockerLogsContainerId = null;
    dockerLogsContent = '';
    dockerLogsStreaming = false;
    if (dockerShellActive && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'docker-shell-stop', clientId }));
    }
    if (dockerShellTerm) { dockerShellTerm.dispose(); dockerShellTerm = null; }
    dockerShellActive = false;
    dockerShellContainerId = null;
    dockerVolumeInspect = null;
    dockerNetworkInspect = null;
    dockerCreateVolumeOpen = false;
    dockerCreateNetworkOpen = false;
    const dockerStatus = document.getElementById('dockerStatus');
    if (dockerStatus) dockerStatus.classList.remove('loaded');
    const dockerDash = document.getElementById('dockerDashboard');
    if (dockerDash) {
        dockerDash.innerHTML = '<div class="resources-placeholder" id="dockerPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to manage Docker</p></div>';
    }

    // Reset packages
    packageData = null;
    packageInstalling = false;
    packageSearchResults = null;
    packageFilter = '';
    const packageStatus = document.getElementById('packageStatus');
    if (packageStatus) packageStatus.classList.remove('loaded');
    const packageDash = document.getElementById('packageDashboard');
    if (packageDash) {
        packageDash.innerHTML = '<div class="resources-placeholder" id="packagePlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to manage packages</p></div>';
    }

    // Reset system info
    systemInfoData = null;
    hostnameTimezoneData = null;
    swapData = null;
    swapCreating = false;

    // Reset security
    securityData = null;
    securityInstalling = false;
    const securityStatusEl = document.getElementById('securityStatus');
    if (securityStatusEl) securityStatusEl.classList.remove('loaded');
    const securityDash = document.getElementById('securityDashboard');
    if (securityDash) {
        securityDash.innerHTML = '<div class="resources-placeholder" id="securityPlaceholder"><div class="flower-icon idle">✻</div><p>Connect to a host to view security status</p></div>';
    }

    // Reset cloud-init
    cloudInitContent = '';
    cloudInitStreaming = false;
    cloudInitVisible = false;

    // Reset batch (keep if actively running)
    if (!batchRunning) {
        batchData = null;
        batchId = null;
        batchResults = {};
    }

    addLog('SSH session disconnected', 'warning');
}

// ─── RESOURCE DASHBOARD ───
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

async function fetchResources() {
    const ec2Host = document.getElementById('ec2Host').value.trim();
    if (!ec2Host) return;

    const mode = document.getElementById('opMode').value;
    const username = mode === 'root-login' ? 'root' : document.getElementById('username').value;
    const password = mode === 'root-login' ? document.getElementById('password').value : null;
    const pemKeyPath = uploadedPemPath || null;

    // Show loading state
    const dashboard = document.getElementById('resourcesDashboard');
    dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Gathering system resources...</div></div>';

    // Show status indicator on tab
    const statusEl = document.getElementById('resourceStatus');

    try {
        const res = await fetch('/api/resources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ec2Host, username, pemKeyPath, password, clientId })
        });
        const data = await res.json();

        if (data.success && data.resources) {
            resourceData = data.resources;
            pushResourceHistory(data.resources);
            updateHeaderResources(data.resources);
            renderResources();
            if (statusEl) statusEl.classList.add('loaded');
            addLog(`Resources loaded for ${ec2Host}`, 'success');
            // Also fetch extended info
            if (!systemInfoData) fetchSystemInfo();
            if (!hostnameTimezoneData) fetchHostnameTimezone();
            if (!swapData) fetchSwapStatus();
        } else {
            dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Failed to load resources: ' + escapeHtml(data.error || 'Unknown error') + '</p></div>';
            addLog(`Resource fetch failed: ${data.error}`, 'error');
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Resource fetch error: ' + escapeHtml(err.message) + '</p></div>';
        addLog(`Resource fetch error: ${err.message}`, 'error');
    }
}

async function fetchResourcesLive() {
    const ec2Host = document.getElementById('ec2Host').value.trim();
    if (!ec2Host || !isConnected()) return;

    try {
        const res = await fetch('/api/resources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ec2Host, clientId })
        });
        const data = await res.json();
        if (data.success && data.resources) {
            resourceData = data.resources;
            pushResourceHistory(data.resources);
            updateHeaderResources(data.resources);
            renderResources();
        }
    } catch (_) {}
}

function pushResourceHistory(r) {
    const memPercent = r.memory.total > 0 ? Math.round((r.memory.used / r.memory.total) * 100) : 0;
    const diskPercent = r.disk.usePercent || 0;
    const loadPercent = r.cpu.cores > 0 ? Math.min(100, Math.round((r.loadAvg[0] / r.cpu.cores) * 100)) : 0;
    resourceHistory.push({ cpu: loadPercent, mem: memPercent, disk: diskPercent, ts: Date.now() });
    if (resourceHistory.length > 20) resourceHistory.shift();
}

function updateHeaderResources(r) {
    const headerRes = document.getElementById('headerResources');
    if (!headerRes) return;

    const cpuPercent = r.cpu.cores > 0 ? Math.min(100, Math.round((r.loadAvg[0] / r.cpu.cores) * 100)) : 0;
    const memPercent = r.memory.total > 0 ? Math.round((r.memory.used / r.memory.total) * 100) : 0;
    const diskPercent = r.disk.usePercent || 0;

    document.getElementById('headerCpu').textContent = cpuPercent + '%';
    document.getElementById('headerMem').textContent = memPercent + '%';
    document.getElementById('headerDisk').textContent = diskPercent + '%';

    // Color thresholds
    function applyStatClass(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = 'header-stat' + (val >= 90 ? ' header-stat-crit' : val >= 70 ? ' header-stat-warn' : '');
    }
    applyStatClass('headerStatCpu', cpuPercent);
    applyStatClass('headerStatMem', memPercent);
    applyStatClass('headerStatDisk', diskPercent);

    // Check notification thresholds
    checkThresholds(cpuPercent, memPercent, diskPercent);

    headerRes.style.display = 'flex';
}

function generateSparklineSVG(dataPoints, colorClass) {
    if (dataPoints.length < 2) return '';
    const w = 200, h = 24;
    const max = 100;
    const step = w / (dataPoints.length - 1);
    let pathD = '';
    let areaD = `M0,${h}`;
    for (let i = 0; i < dataPoints.length; i++) {
        const x = i * step;
        const y = h - (dataPoints[i] / max) * h;
        if (i === 0) pathD += `M${x},${y}`;
        else pathD += ` L${x},${y}`;
        areaD += ` L${x},${y}`;
    }
    areaD += ` L${w},${h} Z`;
    const color = colorClass === 'critical' ? 'var(--c-red)' : colorClass === 'warning' ? 'var(--c-amber)' : 'var(--c-accent)';
    return `<svg class="sparkline-container" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <path d="${areaD}" fill="${color}" opacity="0.08"/>
        <path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.5"/>
    </svg>`;
}

function toggleLiveMonitoring() {
    liveMonitoring = !liveMonitoring;
    if (liveMonitoring) {
        liveInterval = setInterval(fetchResourcesLive, 15000);
        fetchResourcesLive();
    } else {
        if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
    }
    renderResources();
}

async function refreshResources() {
    const btn = document.querySelector('.btn-refresh-resources');
    if (btn) btn.classList.add('loading');
    await fetchResources();
    if (btn) btn.classList.remove('loading');
}

function renderResources() {
    if (!resourceData) return;

    const r = resourceData;
    const dashboard = document.getElementById('resourcesDashboard');

    // Calculate percentages
    const memPercent = r.memory.total > 0 ? Math.round((r.memory.used / r.memory.total) * 100) : 0;
    const diskPercent = r.disk.usePercent || (r.disk.total > 0 ? Math.round((r.disk.used / r.disk.total) * 100) : 0);
    const loadPercent = r.cpu.cores > 0 ? Math.min(100, Math.round((r.loadAvg[0] / r.cpu.cores) * 100)) : 0;

    // Severity classes
    function severity(pct) {
        if (pct >= 90) return 'critical';
        if (pct >= 70) return 'warning';
        return '';
    }

    const host = document.getElementById('ec2Host').value.trim();

    let html = '';

    // Header
    html += '<div class="resources-header">';
    html += '<div class="resources-header-info">';
    html += '<div class="resources-hostname">' + escapeHtml(host) + '</div>';
    html += '<div class="resources-meta">';
    if (r.kernel) html += '<span>' + escapeHtml(r.kernel) + '</span>';
    if (r.arch) html += '<span>' + escapeHtml(r.arch) + '</span>';
    if (r.uptime) html += '<span>up ' + escapeHtml(r.uptime) + '</span>';
    html += '</div>';
    html += '</div>';
    html += '<button class="btn-refresh-resources" onclick="refreshResources()">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
    html += 'REFRESH';
    html += '</button>';
    if (isConnected()) {
        html += '<button class="btn-live-toggle' + (liveMonitoring ? ' active' : '') + '" onclick="toggleLiveMonitoring()">';
        html += '<span class="live-dot"></span>';
        html += 'LIVE';
        html += '</button>';
    }
    html += '</div>';

    // Resource cards
    html += '<div class="resources-grid">';

    // CPU Load card
    html += '<div class="resource-card">';
    html += '<div class="resource-card-title">CPU LOAD</div>';
    html += '<div class="resource-value ' + severity(loadPercent) + '">' + loadPercent + '%</div>';
    if (resourceHistory.length >= 2) html += generateSparklineSVG(resourceHistory.map(h => h.cpu), loadPercent >= 90 ? 'critical' : loadPercent >= 70 ? 'warning' : 'normal');
    html += '<div class="resource-bar"><div class="resource-bar-fill ' + severity(loadPercent) + '" style="width:' + loadPercent + '%"></div></div>';
    html += '<div class="resource-detail"><span>' + (r.cpu.model.length > 30 ? r.cpu.model.slice(0, 28) + '..' : r.cpu.model) + '</span><span>' + r.cpu.cores + ' cores</span></div>';
    html += '</div>';

    // Memory card
    html += '<div class="resource-card">';
    html += '<div class="resource-card-title">MEMORY</div>';
    html += '<div class="resource-value ' + severity(memPercent) + '">' + memPercent + '%</div>';
    if (resourceHistory.length >= 2) html += generateSparklineSVG(resourceHistory.map(h => h.mem), memPercent >= 90 ? 'critical' : memPercent >= 70 ? 'warning' : 'normal');
    html += '<div class="resource-bar"><div class="resource-bar-fill ' + severity(memPercent) + '" style="width:' + memPercent + '%"></div></div>';
    html += '<div class="resource-detail"><span>' + formatBytes(r.memory.used) + ' / ' + formatBytes(r.memory.total) + '</span><span>' + formatBytes(r.memory.available) + ' avail</span></div>';
    html += '</div>';

    // Disk card
    html += '<div class="resource-card">';
    html += '<div class="resource-card-title">DISK ( / )</div>';
    html += '<div class="resource-value ' + severity(diskPercent) + '">' + diskPercent + '%</div>';
    if (resourceHistory.length >= 2) html += generateSparklineSVG(resourceHistory.map(h => h.disk), diskPercent >= 90 ? 'critical' : diskPercent >= 70 ? 'warning' : 'normal');
    html += '<div class="resource-bar"><div class="resource-bar-fill ' + severity(diskPercent) + '" style="width:' + diskPercent + '%"></div></div>';
    html += '<div class="resource-detail"><span>' + formatBytes(r.disk.used) + ' / ' + formatBytes(r.disk.total) + '</span><span>' + formatBytes(r.disk.available) + ' free</span></div>';
    html += '</div>';

    html += '</div>';

    // Load averages strip
    if (r.loadAvg && r.loadAvg.length === 3) {
        html += '<div class="resources-load">';
        html += '<div class="load-item"><div class="load-label">1 MIN AVG</div><div class="load-value">' + r.loadAvg[0].toFixed(2) + '</div></div>';
        html += '<div class="load-item"><div class="load-label">5 MIN AVG</div><div class="load-value">' + r.loadAvg[1].toFixed(2) + '</div></div>';
        html += '<div class="load-item"><div class="load-label">15 MIN AVG</div><div class="load-value">' + r.loadAvg[2].toFixed(2) + '</div></div>';
        html += '</div>';
    }

    // System info section
    if (systemInfoData) {
        html += renderSystemInfoSection();
    }

    // Hostname & timezone section
    if (hostnameTimezoneData) {
        html += renderHostnameTimezoneSection();
    }

    // Swap section
    html += renderSwapSection();

    dashboard.innerHTML = html;
}

// ─── SYSTEM INFO ───
async function fetchSystemInfo() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/system-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            systemInfoData = data.systemInfo;
            renderResources();
        }
    } catch (err) {
        console.error('System info fetch error:', err);
    }
}

function renderSystemInfoSection() {
    const si = systemInfoData;
    let html = '<div class="system-info-section">';
    html += '<div class="resource-section-title">SYSTEM INFO</div>';
    html += '<div class="system-info-grid">';

    // OS info
    if (si.os && si.os.PRETTY_NAME) {
        html += '<div class="system-info-card"><div class="system-info-label">OS</div><div class="system-info-value">' + escapeHtml(si.os.PRETTY_NAME) + '</div></div>';
    }
    if (si.publicIp && si.publicIp !== 'N/A') {
        html += '<div class="system-info-card"><div class="system-info-label">PUBLIC IP</div><div class="system-info-value">' + escapeHtml(si.publicIp) + '</div></div>';
    }
    html += '<div class="system-info-card"><div class="system-info-label">RUNNING SERVICES</div><div class="system-info-value">' + si.serviceCount + '</div></div>';

    // Runtimes
    if (si.runtimes && Object.keys(si.runtimes).length > 0) {
        html += '<div class="system-info-card system-info-wide"><div class="system-info-label">INSTALLED RUNTIMES</div><div class="system-info-runtimes">';
        for (const [key, val] of Object.entries(si.runtimes)) {
            html += '<span class="runtime-badge">' + escapeHtml(val) + '</span>';
        }
        html += '</div></div>';
    }

    // Network interfaces
    if (si.interfaces && si.interfaces.length > 0) {
        html += '<div class="system-info-card system-info-wide"><div class="system-info-label">NETWORK INTERFACES</div><div class="system-info-interfaces">';
        for (const iface of si.interfaces) {
            html += '<div class="interface-line">' + escapeHtml(iface) + '</div>';
        }
        html += '</div></div>';
    }

    html += '</div></div>';
    return html;
}

// ─── HOSTNAME & TIMEZONE ───
async function fetchHostnameTimezone() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/system/hostname-timezone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            hostnameTimezoneData = data;
            renderResources();
        }
    } catch (err) {
        console.error('Hostname/timezone fetch error:', err);
    }
}

function renderHostnameTimezoneSection() {
    const ht = hostnameTimezoneData;
    let html = '<div class="system-settings-section">';
    html += '<div class="resource-section-title">SYSTEM SETTINGS</div>';
    html += '<div class="system-settings-grid">';

    html += '<div class="system-setting-card">';
    html += '<div class="system-info-label">HOSTNAME</div>';
    html += '<div class="system-setting-row">';
    html += '<input type="text" id="newHostname" class="system-setting-input" value="' + escapeHtml(ht.hostname) + '" spellcheck="false">';
    html += '<button class="btn-small" onclick="applyHostname()">SET</button>';
    html += '</div></div>';

    html += '<div class="system-setting-card">';
    html += '<div class="system-info-label">TIMEZONE</div>';
    html += '<div class="system-setting-row">';
    html += '<select id="newTimezone" class="system-setting-input">';
    const tzList = ['UTC','US/Eastern','US/Central','US/Mountain','US/Pacific','US/Alaska','US/Hawaii','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Toronto','America/Vancouver','America/Sao_Paulo','America/Mexico_City','Europe/London','Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Rome','Europe/Amsterdam','Europe/Moscow','Europe/Istanbul','Asia/Kolkata','Asia/Mumbai','Asia/Tokyo','Asia/Shanghai','Asia/Hong_Kong','Asia/Singapore','Asia/Seoul','Asia/Dubai','Asia/Bangkok','Australia/Sydney','Australia/Melbourne','Pacific/Auckland','Africa/Cairo','Africa/Lagos','Africa/Johannesburg'];
    for (const tz of tzList) {
        html += '<option value="' + tz + '"' + (tz === ht.timezone ? ' selected' : '') + '>' + tz + '</option>';
    }
    html += '</select>';
    html += '<button class="btn-small" onclick="applyTimezone()">SET</button>';
    html += '</div></div>';

    if (ht.localTime) {
        html += '<div class="system-setting-card"><div class="system-info-label">LOCAL TIME</div><div class="system-info-value">' + escapeHtml(ht.localTime) + '</div></div>';
    }

    html += '</div></div>';
    return html;
}

async function applyHostname() {
    const hostname = document.getElementById('newHostname').value.trim();
    if (!hostname) return;
    try {
        const res = await fetch('/api/system/set-hostname', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, hostname })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Hostname set to: ' + hostname, 'success');
            fetchHostnameTimezone();
        } else {
            addLog('Failed to set hostname: ' + (data.error || ''), 'error');
        }
    } catch (err) {
        addLog('Error: ' + err.message, 'error');
    }
}

async function applyTimezone() {
    const timezone = document.getElementById('newTimezone').value;
    if (!timezone) return;
    try {
        const res = await fetch('/api/system/set-timezone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, timezone })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Timezone set to: ' + timezone, 'success');
            fetchHostnameTimezone();
        } else {
            addLog('Failed to set timezone: ' + (data.error || ''), 'error');
        }
    } catch (err) {
        addLog('Error: ' + err.message, 'error');
    }
}

// ─── SWAP MANAGEMENT ───
async function fetchSwapStatus() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/system/swap-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            swapData = data;
            renderResources();
        }
    } catch (err) {
        console.error('Swap status fetch error:', err);
    }
}

function renderSwapSection() {
    let html = '<div class="swap-section">';
    html += '<div class="resource-section-title">SWAP</div>';

    if (swapData && swapData.hasSwap) {
        const swapPercent = swapData.swapTotal > 0 ? Math.round((swapData.swapUsed / swapData.swapTotal) * 100) : 0;
        html += '<div class="swap-info">';
        html += '<div class="resource-card" style="max-width:300px">';
        html += '<div class="resource-card-title">SWAP USAGE</div>';
        html += '<div class="resource-value">' + swapPercent + '%</div>';
        html += '<div class="resource-bar"><div class="resource-bar-fill" style="width:' + swapPercent + '%"></div></div>';
        html += '<div class="resource-detail"><span>' + formatBytes(swapData.swapUsed) + ' / ' + formatBytes(swapData.swapTotal) + '</span></div>';
        html += '</div></div>';
    } else if (swapData && !swapData.hasSwap) {
        html += '<div class="swap-create">';
        html += '<p style="color:var(--c-text-dim);font-size:11px;margin:0 0 8px">No swap configured.</p>';
        html += '<div class="system-setting-row">';
        html += '<select id="swapSize" class="system-setting-input">';
        html += '<option value="256">256 MB</option><option value="512">512 MB</option>';
        html += '<option value="1024" selected>1 GB</option><option value="2048">2 GB</option><option value="4096">4 GB</option>';
        html += '</select>';
        html += '<button class="btn-small" onclick="createSwapFile()" ' + (swapCreating ? 'disabled' : '') + '>' + (swapCreating ? 'CREATING...' : 'CREATE SWAP') + '</button>';
        html += '</div></div>';
    } else {
        html += '<p style="color:var(--c-text-dim);font-size:11px">Connect and load resources to check swap status</p>';
    }

    html += '</div>';
    return html;
}

async function createSwapFile() {
    const sizeMB = parseInt(document.getElementById('swapSize').value);
    if (!sizeMB) return;
    swapCreating = true;
    renderResources();
    addLog('Creating ' + sizeMB + 'MB swap file...', 'info');
    try {
        await fetch('/api/system/swap-create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, sizeMB })
        });
    } catch (err) {
        addLog('Swap creation error: ' + err.message, 'error');
        swapCreating = false;
    }
}
function timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(dateStr).toLocaleDateString();
}

async function fetchAuditLog() {
    try {
        const params = new URLSearchParams({
            page: auditPage, limit: 50,
            action: auditFilter, search: auditSearch
        });
        const res = await fetch('/api/audit-log?' + params);
        const data = await res.json();
        renderAuditLog(data);
    } catch (err) {
        console.error('Audit fetch error:', err);
    }
}

function renderAuditLog(data) {
    const list = document.getElementById('auditList');
    const pagination = document.getElementById('auditPagination');

    if (!data.entries || data.entries.length === 0) {
        list.innerHTML = '<div class="session-empty">No audit entries</div>';
        pagination.innerHTML = '';
        return;
    }

    const badgeColors = {
        login: 'badge-blue', logout: 'badge-dim',
        ssh_connect: 'badge-green', ssh_disconnect: 'badge-amber',
        session_save: 'badge-green', session_delete: 'badge-red',
        password_deploy: 'badge-red', process_kill: 'badge-red',
        file_upload: 'badge-blue', file_download: 'badge-blue', file_delete: 'badge-red',
        health_check: 'badge-dim'
    };

    let html = '';
    for (const e of data.entries) {
        const badge = badgeColors[e.action] || 'badge-dim';
        html += '<div class="audit-entry">';
        html += '<span class="audit-ts">' + escapeHtml(e.timestamp.replace('T', ' ').slice(0, 19)) + '</span>';
        html += '<span class="audit-badge ' + badge + '">' + escapeHtml(e.action.replace(/_/g, ' ')) + '</span>';
        html += '<span class="audit-details">' + escapeHtml(e.details || '') + '</span>';
        if (e.host) html += '<span class="audit-host">' + escapeHtml(e.host) + '</span>';
        html += '<span class="audit-ago">' + timeAgo(e.timestamp) + '</span>';
        html += '</div>';
    }
    list.innerHTML = html;

    // Pagination
    if (data.pages > 1) {
        let pHtml = '<button class="btn-page" onclick="auditPage=Math.max(1,auditPage-1);fetchAuditLog()" ' + (data.page <= 1 ? 'disabled' : '') + '>&laquo; PREV</button>';
        pHtml += '<span class="page-info">' + data.page + ' / ' + data.pages + '</span>';
        pHtml += '<button class="btn-page" onclick="auditPage=Math.min(' + data.pages + ',auditPage+1);fetchAuditLog()" ' + (data.page >= data.pages ? 'disabled' : '') + '>NEXT &raquo;</button>';
        pagination.innerHTML = pHtml;
    } else {
        pagination.innerHTML = '';
    }
}

function filterAuditLog() {
    auditFilter = document.getElementById('auditFilter').value;
    auditPage = 1;
    fetchAuditLog();
}

function debounceAuditSearch() {
    clearTimeout(auditSearchTimer);
    auditSearchTimer = setTimeout(() => {
        auditSearch = document.getElementById('auditSearch').value;
        auditPage = 1;
        fetchAuditLog();
    }, 300);
}

async function clearAuditLog() {
    if (!confirm('Clear all audit entries?')) return;
    try {
        await fetch('/api/audit-log', { method: 'DELETE' });
        auditCount = 0;
        document.getElementById('auditCount').textContent = '0';
        fetchAuditLog();
    } catch (err) {
        addLog('Failed to clear audit log', 'error');
    }
}

function exportAuditLog() {
    window.open('/api/audit-log/export', '_blank');
}

// ─── PROCESS MANAGER ───
async function fetchProcesses() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('processDashboard');

    if (!processData) {
        dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading processes...</div></div>';
    }

    try {
        const res = await fetch('/api/processes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            processData = data.processes;
            renderProcesses();
            const statusEl = document.getElementById('processStatus');
            if (statusEl) statusEl.classList.add('loaded');
        } else {
            dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Failed to load processes: ' + escapeHtml(data.error) + '</p></div>';
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Process fetch error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function renderProcesses() {
    if (!processData) return;
    const dashboard = document.getElementById('processDashboard');

    let filtered = processData;
    if (processFilter) {
        const q = processFilter.toLowerCase();
        filtered = processData.filter(p => p.command.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) || String(p.pid).includes(q));
    }

    // Sort
    filtered.sort((a, b) => {
        const va = a[processSortBy], vb = b[processSortBy];
        if (typeof va === 'number') return processSortDesc ? vb - va : va - vb;
        return processSortDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
    });

    let html = '<div class="process-toolbar">';
    html += '<input type="text" class="process-search" placeholder="Filter processes..." value="' + escapeHtml(processFilter) + '" oninput="processFilter=this.value;renderProcesses()" spellcheck="false">';
    html += '<span class="process-count">' + filtered.length + ' processes</span>';
    html += '<button class="btn-live-toggle' + (processLive ? ' active' : '') + '" onclick="toggleProcessLive()"><span class="live-dot"></span>LIVE</button>';
    html += '<button class="btn-refresh-resources" onclick="fetchProcesses()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>REFRESH</button>';
    html += '</div>';

    html += '<div class="process-table-wrap"><table class="process-table">';
    html += '<thead><tr>';
    html += '<th onclick="sortProcesses(\'pid\')" class="sortable">PID' + (processSortBy === 'pid' ? (processSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th onclick="sortProcesses(\'user\')" class="sortable">USER' + (processSortBy === 'user' ? (processSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th onclick="sortProcesses(\'cpu\')" class="sortable">CPU%' + (processSortBy === 'cpu' ? (processSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th onclick="sortProcesses(\'mem\')" class="sortable">MEM%' + (processSortBy === 'mem' ? (processSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th>STAT</th>';
    html += '<th>COMMAND</th>';
    html += '<th></th>';
    html += '</tr></thead><tbody>';

    for (const p of filtered) {
        const cpuClass = p.cpu >= 80 ? 'process-cpu-crit' : p.cpu >= 50 ? 'process-cpu-high' : '';
        const memClass = p.mem >= 80 ? 'process-cpu-crit' : p.mem >= 50 ? 'process-cpu-high' : '';
        html += '<tr>';
        html += '<td>' + p.pid + '</td>';
        html += '<td>' + escapeHtml(p.user) + '</td>';
        html += '<td class="' + cpuClass + '">' + p.cpu.toFixed(1) + '</td>';
        html += '<td class="' + memClass + '">' + p.mem.toFixed(1) + '</td>';
        html += '<td>' + escapeHtml(p.stat) + '</td>';
        html += '<td class="process-cmd" title="' + escapeHtml(p.command) + '">' + escapeHtml(p.command) + '</td>';
        html += '<td><button class="btn-kill" onclick="killProcess(' + p.pid + ')" title="Kill">✕</button></td>';
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    dashboard.innerHTML = html;
}

function sortProcesses(key) {
    if (processSortBy === key) processSortDesc = !processSortDesc;
    else { processSortBy = key; processSortDesc = true; }
    renderProcesses();
}

async function killProcess(pid) {
    if (!confirm('Kill process ' + pid + '?')) return;
    try {
        await fetch('/api/processes/kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, pid })
        });
        addLog('Process ' + pid + ' killed', 'success');
        setTimeout(fetchProcesses, 500);
    } catch (err) {
        addLog('Kill failed: ' + err.message, 'error');
    }
}

function toggleProcessLive() {
    processLive = !processLive;
    if (processLive) {
        processInterval = setInterval(fetchProcesses, 10000);
    } else {
        if (processInterval) { clearInterval(processInterval); processInterval = null; }
    }
    renderProcesses();
}

// ─── PORT & SERVICE STATUS ───
async function fetchServices() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('serviceDashboard');
    dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading services...</div></div>';

    try {
        const res = await fetch('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            serviceData = data;
            renderServices();
            const statusEl = document.getElementById('serviceStatus');
            if (statusEl) statusEl.classList.add('loaded');
        } else {
            dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Failed to load services: ' + escapeHtml(data.error) + '</p></div>';
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Service fetch error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function renderServices() {
    if (!serviceData) return;
    const dashboard = document.getElementById('serviceDashboard');
    let html = '';

    // Header
    html += '<div class="service-header">';
    html += '<span class="service-header-title">HOST SERVICES & PORTS</span>';
    html += '<button class="btn-refresh-resources" onclick="fetchServices()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>REFRESH</button>';
    html += '</div>';

    // Listening ports
    if (serviceData.ports && serviceData.ports.length > 0) {
        html += '<div class="service-section">';
        html += '<div class="service-section-header">LISTENING PORTS (' + serviceData.ports.length + ')</div>';
        html += '<table class="port-table"><thead><tr><th>PORT</th><th>SERVICE</th><th>ADDRESS</th><th>PROGRAM</th></tr></thead><tbody>';
        for (const p of serviceData.ports) {
            html += '<tr>';
            html += '<td><strong>' + p.port + '</strong></td>';
            html += '<td>' + (p.label ? '<span class="port-label">' + escapeHtml(p.label) + '</span>' : '-') + '</td>';
            html += '<td>' + escapeHtml(p.address || '*') + '</td>';
            html += '<td class="process-cmd">' + escapeHtml(p.program || '-') + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }

    // System services
    if (serviceData.services && serviceData.services.length > 0) {
        html += '<div class="service-section">';
        html += '<div class="service-section-header">SYSTEM SERVICES (' + serviceData.services.length + ')</div>';
        html += '<div class="service-cards">';
        for (const s of serviceData.services) {
            const dotClass = s.status === 'running' ? 'svc-running' : 'svc-failed';
            html += '<div class="service-card">';
            html += '<span class="svc-dot ' + dotClass + '"></span>';
            html += '<span class="svc-name">' + escapeHtml(s.name) + '</span>';
            if (s.description) html += '<span class="svc-desc">' + escapeHtml(s.description) + '</span>';
            html += '</div>';
        }
        html += '</div></div>';
    }

    if ((!serviceData.ports || serviceData.ports.length === 0) && (!serviceData.services || serviceData.services.length === 0)) {
        html += '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>No ports or services detected</p></div>';
    }

    dashboard.innerHTML = html;
}

// ─── SFTP FILE TRANSFER ───
async function fetchRemoteFiles(remotePath) {
    if (!isConnected()) return;
    remotePath = remotePath || '/home';
    currentRemotePath = remotePath;
    selectedTreePath = remotePath;

    // Show loading only if tree is empty (first load)
    const dashboard = document.getElementById('sftpDashboard');
    if (!directoryTree[remotePath] || !directoryTree[remotePath].loaded) {
        if (Object.keys(directoryTree).length === 0) {
            dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading files...</div></div>';
        }
    }

    try {
        const res = await fetch('/api/sftp/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath: currentRemotePath })
        });
        const data = await res.json();
        if (data.success) {
            sftpFiles = data.files;
            currentRemotePath = data.path;

            // Cache in tree
            directoryTree[currentRemotePath] = {
                loaded: true,
                expanded: true,
                children: data.files
            };

            renderFileExplorer();
            const statusEl = document.getElementById('filesStatus');
            if (statusEl) statusEl.classList.add('loaded');
        } else {
            dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Failed to list: ' + escapeHtml(data.error) + '</p></div>';
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>SFTP error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function parentPath(p) {
    if (p === '/') return '/';
    const parts = p.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
}

function navigateSftp(path) {
    selectedTreePath = path;
    // Expand tree node
    if (directoryTree[path]) {
        directoryTree[path].expanded = true;
    }
    fetchRemoteFiles(path);
}

function toggleTreeNode(path) {
    if (directoryTree[path] && directoryTree[path].loaded) {
        directoryTree[path].expanded = !directoryTree[path].expanded;
        renderFileExplorer();
    } else {
        // Load this directory
        directoryTree[path] = { loaded: false, expanded: true, children: [] };
        fetch('/api/sftp/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath: path })
        }).then(r => r.json()).then(data => {
            if (data.success) {
                directoryTree[path] = { loaded: true, expanded: true, children: data.files };
                renderFileExplorer();
            }
        }).catch(() => {});
    }
}

function selectTreeNode(path) {
    selectedTreePath = path;
    currentRemotePath = path;
    // Load files if not cached
    if (directoryTree[path] && directoryTree[path].loaded) {
        sftpFiles = directoryTree[path].children;
        directoryTree[path].expanded = true;
        renderFileExplorer();
    } else {
        fetchRemoteFiles(path);
    }
}

function renderTree() {
    let html = '';
    // Start from root
    function renderNode(path, name, depth) {
        const node = directoryTree[path];
        const isActive = path === selectedTreePath;
        const isExpanded = node && node.expanded;
        const isLoaded = node && node.loaded;
        const indent = '<span class="tree-indent"></span>'.repeat(depth);
        const toggleIcon = isExpanded ? '▼' : '▶';

        html += '<div class="tree-item' + (isActive ? ' active' : '') + '" onclick="selectTreeNode(\'' + escapeHtml(path).replace(/'/g, "\\'") + '\')">';
        html += indent;
        html += '<span class="tree-toggle" onclick="event.stopPropagation(); toggleTreeNode(\'' + escapeHtml(path).replace(/'/g, "\\'") + '\')">' + toggleIcon + '</span>';
        html += '<span class="tree-icon">📁</span>';
        html += '<span class="tree-label">' + escapeHtml(name) + '</span>';
        html += '</div>';

        // Render children if expanded
        if (isExpanded && isLoaded && node.children) {
            const dirs = node.children.filter(f => f.isDirectory && f.name !== '.' && f.name !== '..');
            dirs.sort((a, b) => a.name.localeCompare(b.name));
            for (const dir of dirs) {
                const childPath = path === '/' ? '/' + dir.name : path + '/' + dir.name;
                renderNode(childPath, dir.name, depth + 1);
            }
        }
    }

    // Always start from root
    renderNode('/', '/', 0);

    // If current path's parent hierarchy isn't in tree, also render the home tree
    const knownRoots = Object.keys(directoryTree).filter(p => p !== '/');
    for (const rootPath of knownRoots) {
        // Skip if already under / tree
        if (directoryTree['/'] && directoryTree['/'].loaded) continue;
        const parts = rootPath.split('/').filter(Boolean);
        if (parts.length > 0 && !directoryTree['/']) {
            renderNode(rootPath, parts[parts.length - 1], 0);
        }
    }

    return html;
}

function renderFileExplorer() {
    const dashboard = document.getElementById('sftpDashboard');

    let html = '<div class="sftp-split">';

    // Left: Tree panel
    html += '<div class="sftp-tree-panel" id="sftpTree">';
    html += renderTree();
    html += '</div>';

    // Right: Files panel
    html += '<div class="sftp-files-panel">';

    // Breadcrumb
    const segments = currentRemotePath.split('/').filter(Boolean);
    html += '<div class="sftp-breadcrumb">';
    html += '<span class="sftp-crumb" onclick="navigateSftp(\'/\')">/</span>';
    let built = '';
    for (const seg of segments) {
        built += '/' + seg;
        const p = built;
        html += '<span class="sftp-crumb" onclick="navigateSftp(\'' + escapeHtml(p) + '\')">' + escapeHtml(seg) + '</span>';
    }
    html += '<button class="btn-refresh-resources sftp-refresh" onclick="fetchRemoteFiles(\'' + escapeHtml(currentRemotePath) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>';
    html += '<button class="btn-refresh-resources" onclick="promptMkdir()" title="New folder">+ DIR</button>';
    if (fileClipboard) {
        html += '<button class="btn-refresh-resources sftp-paste-btn" onclick="pasteFile()" title="Paste ' + escapeHtml(fileClipboard.name) + '">📋 PASTE</button>';
    }
    html += '</div>';

    // Search bar
    html += '<div class="sftp-search-bar">';
    html += '<input type="text" class="sftp-search-input" id="sftpSearchInput" placeholder="Search files..." value="' + escapeHtml(fileSearchQuery) + '" onkeydown="if(event.key===\'Enter\')searchFiles()">';
    html += '<label class="sftp-search-toggle" title="Search file contents"><input type="checkbox" id="sftpSearchContent" ' + (fileSearchContent ? 'checked' : '') + ' onchange="fileSearchContent=this.checked"> Content</label>';
    html += '<button class="btn-refresh-resources" onclick="searchFiles()">&#x1F50D;</button>';
    if (fileSearchActive) {
        html += '<button class="btn-refresh-resources" onclick="clearFileSearch()">&#x2715;</button>';
    }
    html += '</div>';

    // Search results (if active)
    if (fileSearchActive && fileSearchResults.length > 0) {
        html += '<div class="sftp-search-results">';
        html += '<div class="sftp-search-results-header">Found ' + fileSearchResults.length + ' result(s)</div>';
        for (const r of fileSearchResults) {
            html += '<div class="sftp-search-result-item" onclick="navigateSftp(\'' + escapeHtml(r.dir).replace(/'/g, "\\'") + '\')">';
            html += '<span class="sftp-file-icon file">📄</span>';
            html += '<span class="sftp-search-result-path">' + escapeHtml(r.path) + '</span>';
            html += '</div>';
        }
        html += '</div>';
    } else if (fileSearchActive && fileSearchResults.length === 0) {
        html += '<div class="sftp-search-results"><div class="sftp-search-results-header">No results found</div></div>';
    }

    // File list
    html += '<div class="sftp-file-list">';

    // Parent directory
    if (currentRemotePath !== '/') {
        html += '<div class="sftp-file-item" ondblclick="navigateSftp(\'' + escapeHtml(parentPath(currentRemotePath)) + '\')">';
        html += '<span class="sftp-file-icon dir">..</span>';
        html += '<span class="sftp-file-name dir">Parent Directory</span>';
        html += '<span class="sftp-file-size"></span>';
        html += '<span class="sftp-file-perm"></span>';
        html += '<span class="sftp-file-time"></span>';
        html += '<span class="sftp-file-actions"></span>';
        html += '</div>';
    }

    for (const f of sftpFiles) {
        if (f.name === '.' || f.name === '..') continue;
        const fullPath = currentRemotePath === '/' ? '/' + f.name : currentRemotePath + '/' + f.name;
        const escapedPath = escapeHtml(fullPath).replace(/'/g, "\\'");

        if (f.isDirectory) {
            html += '<div class="sftp-file-item" ondblclick="navigateSftp(\'' + escapedPath + '\')">';
        } else {
            html += '<div class="sftp-file-item" ondblclick="openFileEditor(\'' + escapedPath + '\')">';
        }
        html += '<span class="sftp-file-icon ' + (f.isDirectory ? 'dir' : 'file') + '">' + (f.isDirectory ? '📁' : '📄') + '</span>';
        html += '<span class="sftp-file-name ' + (f.isDirectory ? 'dir' : '') + '">' + escapeHtml(f.name) + '</span>';
        html += '<span class="sftp-file-size">' + (f.isDirectory ? '-' : formatBytes(f.size)) + '</span>';
        html += '<span class="sftp-file-perm">' + (f.permissions || '') + '</span>';
        html += '<span class="sftp-file-time">' + (f.modified ? timeAgo(f.modified) : '') + '</span>';
        html += '<span class="sftp-file-actions">';
        if (!f.isDirectory) {
            html += '<button class="btn-kill" onclick="downloadRemoteFile(\'' + escapedPath + '\')" title="Download">↓</button>';
            html += '<button class="btn-kill" onclick="openFileEditor(\'' + escapedPath + '\')" title="Edit">✎</button>';
        }
        html += '<button class="btn-kill" onclick="renameFile(\'' + escapedPath + '\',' + f.isDirectory + ')" title="Rename">✏</button>';
        html += '<button class="btn-kill" onclick="copyFile(\'' + escapedPath + '\',\'' + escapeHtml(f.name).replace(/'/g, "\\'") + '\',' + f.isDirectory + ')" title="Copy">⧉</button>';
        html += '<button class="btn-kill" onclick="cutFile(\'' + escapedPath + '\',\'' + escapeHtml(f.name).replace(/'/g, "\\'") + '\',' + f.isDirectory + ')" title="Cut">✂</button>';
        html += '<button class="btn-kill" onclick="openPermDialog(\'' + escapedPath + '\',\'' + (f.permissions || '0644') + '\')" title="Permissions">🔒</button>';
        html += '<button class="btn-kill" onclick="deleteRemoteFile(\'' + escapedPath + '\',' + f.isDirectory + ')" title="Delete">✕</button>';
        html += '</span>';
        html += '</div>';
    }
    html += '</div>';

    // Upload dropzone
    html += '<div class="sftp-dropzone" id="sftpDropzone">';
    html += '<span>Drop files here or <label class="sftp-upload-label">click to upload<input type="file" id="sftpUploadInput" onchange="handleSftpUpload(event)" hidden multiple></label></span>';
    html += '</div>';

    // Progress bar
    html += '<div class="sftp-progress" id="sftpProgress" style="display:none">';
    html += '<div class="sftp-progress-bar"><div class="sftp-progress-fill" id="sftpProgressFill"></div></div>';
    html += '<span class="sftp-progress-text" id="sftpProgressText">0%</span>';
    html += '</div>';

    html += '</div>'; // end sftp-files-panel
    html += '</div>'; // end sftp-split

    // Editor overlay (appended if open)
    if (editorOpen) {
        html += renderEditorOverlay();
    }

    // Permissions dialog overlay
    if (permDialogOpen) {
        html += renderPermDialog();
    }

    dashboard.innerHTML = html;
    setupDragDrop();

    // If editor is open, set up textarea listener
    if (editorOpen) {
        const ta = document.getElementById('editorTextarea');
        if (ta) {
            ta.addEventListener('input', () => {
                editorModified = ta.value !== editorOriginal;
                const statusEl = document.getElementById('editorStatus');
                if (statusEl) {
                    statusEl.innerHTML = editorModified
                        ? '<span class="editor-modified">MODIFIED</span>'
                        : '<span>Saved</span>';
                }
            });
            // Support Tab key in textarea
            ta.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    ta.value = ta.value.substring(0, start) + '\t' + ta.value.substring(end);
                    ta.selectionStart = ta.selectionEnd = start + 1;
                    ta.dispatchEvent(new Event('input'));
                }
                // Ctrl+S to save
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    saveFileEditor();
                }
            });
        }
    }
}

// ─── SYNTAX HIGHLIGHTING ───
function getLanguageFromPath(filePath) {
    const ext = (filePath || '').split('.').pop().toLowerCase();
    const map = {
        js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
        py: 'python', rb: 'ruby', php: 'php', java: 'java',
        c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
        cs: 'csharp', go: 'go', rs: 'rust', swift: 'swift',
        kt: 'kotlin', scala: 'scala', r: 'r',
        html: 'html', htm: 'html', xml: 'xml', svg: 'svg',
        css: 'css', scss: 'scss', sass: 'sass', less: 'less',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
        md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash',
        zsh: 'bash', fish: 'bash', ps1: 'powershell',
        dockerfile: 'docker', makefile: 'makefile',
        nginx: 'nginx', conf: 'nginx', ini: 'ini',
        lua: 'lua', perl: 'perl', pl: 'perl',
        groovy: 'groovy', gradle: 'groovy',
        tf: 'hcl', hcl: 'hcl', vim: 'vim',
        diff: 'diff', patch: 'diff', log: 'log'
    };
    return map[ext] || 'plaintext';
}

function updateHighlight() {
    const ta = document.getElementById('editorTextarea');
    const codeEl = document.getElementById('editorHighlightCode');
    if (!ta || !codeEl) return;
    codeEl.textContent = ta.value + '\n';
    if (typeof Prism !== 'undefined') {
        Prism.highlightElement(codeEl);
    }
}

function syncEditorScroll() {
    const ta = document.getElementById('editorTextarea');
    const pre = document.getElementById('editorHighlightPre');
    if (ta && pre) {
        pre.scrollTop = ta.scrollTop;
        pre.scrollLeft = ta.scrollLeft;
    }
}

function renderEditorOverlay() {
    const filename = editorPath.split('/').pop();
    const lang = getLanguageFromPath(editorPath);
    const langClass = lang === 'plaintext' ? '' : 'language-' + lang;
    let html = '<div class="sftp-editor-overlay" id="editorOverlay">';
    html += '<div class="editor-toolbar">';
    html += '<span class="editor-path" title="' + escapeHtml(editorPath) + '">✎ ' + escapeHtml(editorPath) + '</span>';
    if (lang !== 'plaintext') html += '<span class="editor-lang-badge">' + escapeHtml(lang) + '</span>';
    html += '<button class="btn btn-editor btn-editor-save" onclick="saveFileEditor()">SAVE</button>';
    html += '<button class="btn btn-editor btn-editor-close" onclick="closeFileEditor()">CLOSE</button>';
    html += '</div>';
    html += '<div class="editor-body">';
    html += '<pre class="editor-highlight" id="editorHighlightPre"><code id="editorHighlightCode" class="' + langClass + '">' + escapeHtml(editorOriginal) + '\n</code></pre>';
    html += '<textarea class="editor-textarea editor-textarea-overlay" id="editorTextarea" spellcheck="false" oninput="updateHighlight();editorModified=true;document.getElementById(\'editorStatus\').innerHTML=\'<span>Modified</span><span>' + escapeHtml(filename) + '</span>\'" onscroll="syncEditorScroll()">' + escapeHtml(editorOriginal) + '</textarea>';
    html += '</div>';
    html += '<div class="editor-status" id="editorStatus"><span>Ready</span><span>' + escapeHtml(filename) + '</span></div>';
    html += '</div>';
    return html;
}

async function openFileEditor(remotePath) {
    try {
        const res = await fetch('/api/sftp/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath })
        });
        const data = await res.json();
        if (data.success) {
            editorOpen = true;
            editorPath = remotePath;
            editorOriginal = data.content;
            editorModified = false;
            renderFileExplorer();
            setTimeout(() => updateHighlight(), 50);
            addLog('Editing: ' + remotePath, 'info');
        } else {
            addLog('Cannot open: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        addLog('Editor error: ' + err.message, 'error');
    }
}

async function saveFileEditor() {
    const ta = document.getElementById('editorTextarea');
    if (!ta) return;
    const content = ta.value;

    try {
        const res = await fetch('/api/sftp/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath: editorPath, content })
        });
        const data = await res.json();
        if (data.success) {
            editorOriginal = content;
            editorModified = false;
            const statusEl = document.getElementById('editorStatus');
            if (statusEl) statusEl.innerHTML = '<span>Saved (' + data.size + ' bytes)</span><span>' + escapeHtml(editorPath.split('/').pop()) + '</span>';
            addLog('Saved: ' + editorPath, 'success');
        } else {
            addLog('Save failed: ' + (data.error || 'Unknown'), 'error');
        }
    } catch (err) {
        addLog('Save error: ' + err.message, 'error');
    }
}

function closeFileEditor() {
    if (editorModified) {
        if (!confirm('Discard unsaved changes?')) return;
    }
    editorOpen = false;
    editorPath = '';
    editorOriginal = '';
    editorModified = false;
    renderFileExplorer();
}

async function downloadRemoteFile(remotePath) {
    try {
        const res = await fetch('/api/sftp/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath })
        });
        if (!res.ok) { addLog('Download failed', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = remotePath.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
        addLog('Downloaded: ' + remotePath, 'success');
    } catch (err) {
        addLog('Download error: ' + err.message, 'error');
    }
}

async function handleSftpUpload(event) {
    const files = event.target.files || event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const progress = document.getElementById('sftpProgress');
    if (progress) progress.style.display = 'flex';

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('clientId', clientId);
        formData.append('remotePath', currentRemotePath);

        try {
            const res = await fetch('/api/sftp/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success) {
                addLog('Uploaded: ' + file.name, 'success');
            } else {
                addLog('Upload failed: ' + (data.error || 'Unknown'), 'error');
            }
        } catch (err) {
            addLog('Upload error: ' + err.message, 'error');
        }
    }

    if (progress) progress.style.display = 'none';
    // Invalidate tree cache for current dir
    delete directoryTree[currentRemotePath];
    fetchRemoteFiles(currentRemotePath);
    const input = document.getElementById('sftpUploadInput');
    if (input) input.value = '';
}

function updateSftpProgress(data) {
    const fill = document.getElementById('sftpProgressFill');
    const text = document.getElementById('sftpProgressText');
    const bar = document.getElementById('sftpProgress');
    if (fill) fill.style.width = data.percent + '%';
    if (text) text.textContent = data.percent + '%';
    if (bar) bar.style.display = 'flex';
    if (data.percent >= 100) {
        setTimeout(() => { if (bar) bar.style.display = 'none'; }, 1000);
    }
}

async function deleteRemoteFile(remotePath, isDirectory) {
    if (!confirm('Delete ' + remotePath + '?')) return;
    try {
        const res = await fetch('/api/sftp/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath, isDirectory })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Deleted: ' + remotePath, 'success');
            // Invalidate tree cache
            delete directoryTree[currentRemotePath];
            if (isDirectory) delete directoryTree[remotePath];
            fetchRemoteFiles(currentRemotePath);
        } else {
            addLog('Delete failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Delete error: ' + err.message, 'error');
    }
}

function promptMkdir() {
    const name = prompt('New directory name:');
    if (!name) return;
    const fullPath = currentRemotePath === '/' ? '/' + name : currentRemotePath + '/' + name;
    fetch('/api/sftp/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, remotePath: fullPath })
    }).then(r => r.json()).then(d => {
        if (d.success) {
            addLog('Created directory: ' + name, 'success');
            delete directoryTree[currentRemotePath];
            fetchRemoteFiles(currentRemotePath);
        }
        else addLog('mkdir failed: ' + d.error, 'error');
    }).catch(e => addLog('mkdir error: ' + e.message, 'error'));
}

function setupDragDrop() {
    const zone = document.getElementById('sftpDropzone');
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); handleSftpUpload(e); });
}

// ─── RENAME FILES ───
async function renameFile(remotePath, isDirectory) {
    const currentName = remotePath.split('/').pop();
    const newName = prompt('Rename to:', currentName);
    if (!newName || newName === currentName) return;
    const parentDir = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
    const newPath = parentDir === '/' ? '/' + newName : parentDir + '/' + newName;
    try {
        const res = await fetch('/api/sftp/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, oldPath: remotePath, newPath })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Renamed: ' + currentName + ' → ' + newName, 'success');
            delete directoryTree[currentRemotePath];
            if (isDirectory) delete directoryTree[remotePath];
            fetchRemoteFiles(currentRemotePath);
        } else {
            addLog('Rename failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Rename error: ' + err.message, 'error');
    }
}

// ─── COPY/MOVE FILES ───
function copyFile(remotePath, name, isDirectory) {
    fileClipboard = { operation: 'copy', path: remotePath, name, isDirectory };
    addLog('Copied to clipboard: ' + name, 'info');
    renderFileExplorer();
}

function cutFile(remotePath, name, isDirectory) {
    fileClipboard = { operation: 'cut', path: remotePath, name, isDirectory };
    addLog('Cut to clipboard: ' + name, 'info');
    renderFileExplorer();
}

async function pasteFile() {
    if (!fileClipboard) return;
    const destPath = currentRemotePath === '/' ? '/' + fileClipboard.name : currentRemotePath + '/' + fileClipboard.name;
    const endpoint = fileClipboard.operation === 'copy' ? '/api/sftp/copy' : '/api/sftp/move';
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, srcPath: fileClipboard.path, destPath })
        });
        const data = await res.json();
        if (data.success) {
            addLog((fileClipboard.operation === 'copy' ? 'Copied' : 'Moved') + ': ' + fileClipboard.name, 'success');
            fileClipboard = null;
            delete directoryTree[currentRemotePath];
            fetchRemoteFiles(currentRemotePath);
        } else {
            addLog('Paste failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Paste error: ' + err.message, 'error');
    }
}

// ─── FILE SEARCH ───
async function searchFiles() {
    const input = document.getElementById('sftpSearchInput');
    if (!input) return;
    const query = input.value.trim();
    if (!query) return;
    fileSearchQuery = query;
    fileSearchContent = document.getElementById('sftpSearchContent')?.checked || false;
    fileSearchActive = true;

    try {
        const res = await fetch('/api/sftp/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, path: currentRemotePath, query, searchContent: fileSearchContent, maxResults: 50 })
        });
        const data = await res.json();
        if (data.success) {
            fileSearchResults = data.results;
            addLog('Search found ' + data.results.length + ' result(s)', 'info');
        } else {
            fileSearchResults = [];
        }
        renderFileExplorer();
    } catch (err) {
        addLog('Search error: ' + err.message, 'error');
    }
}

function clearFileSearch() {
    fileSearchQuery = '';
    fileSearchResults = [];
    fileSearchActive = false;
    fileSearchContent = false;
    renderFileExplorer();
}

// ─── FILE PERMISSIONS ───
function openPermDialog(remotePath, currentPerms) {
    permDialogOpen = true;
    permDialogPath = remotePath;
    permDialogPerms = currentPerms || '0644';
    renderFileExplorer();
}

function renderPermDialog() {
    const perms = permDialogPerms.replace(/^0/, '');
    const o = parseInt(perms[0] || '6', 10);
    const g = parseInt(perms[1] || '4', 10);
    const t = parseInt(perms[2] || '4', 10);

    function checkbox(label, val, bit) {
        const checked = (val & bit) ? 'checked' : '';
        return '<label class="perm-checkbox"><input type="checkbox" ' + checked + ' data-bit="' + bit + '"> ' + label + '</label>';
    }

    let html = '<div class="perm-dialog-overlay">';
    html += '<div class="perm-dialog">';
    html += '<div class="perm-dialog-title">Permissions: ' + escapeHtml(permDialogPath.split('/').pop()) + '</div>';
    html += '<div class="perm-grid">';
    html += '<div class="perm-row"><span class="perm-label">Owner</span>' + checkbox('R', o, 4) + checkbox('W', o, 2) + checkbox('X', o, 1) + '</div>';
    html += '<div class="perm-row"><span class="perm-label">Group</span>' + checkbox('R', g, 4) + checkbox('W', g, 2) + checkbox('X', g, 1) + '</div>';
    html += '<div class="perm-row"><span class="perm-label">Other</span>' + checkbox('R', t, 4) + checkbox('W', t, 2) + checkbox('X', t, 1) + '</div>';
    html += '</div>';
    html += '<div class="perm-octal"><label>Octal: <input type="text" id="permOctalInput" value="' + perms + '" maxlength="4" style="width:50px;font-family:var(--font-mono);text-align:center"></label></div>';
    html += '<div class="perm-actions">';
    html += '<button class="btn btn-editor btn-editor-save" onclick="savePermissions()">APPLY</button>';
    html += '<button class="btn btn-editor btn-editor-close" onclick="closePermDialog()">CANCEL</button>';
    html += '</div>';
    html += '</div></div>';
    return html;
}

async function savePermissions() {
    const input = document.getElementById('permOctalInput');
    if (!input) return;
    const perms = input.value.trim();
    if (!/^[0-7]{3,4}$/.test(perms)) {
        addLog('Invalid permissions format', 'error');
        return;
    }
    try {
        const res = await fetch('/api/sftp/chmod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, remotePath: permDialogPath, permissions: perms })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Permissions updated: ' + perms, 'success');
            closePermDialog();
            delete directoryTree[currentRemotePath];
            fetchRemoteFiles(currentRemotePath);
        } else {
            addLog('chmod failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('chmod error: ' + err.message, 'error');
    }
}

function closePermDialog() {
    permDialogOpen = false;
    permDialogPath = '';
    renderFileExplorer();
}

// ─── COMMAND SNIPPETS ───
async function fetchSnippets() {
    try {
        const res = await fetch('/api/snippets');
        const data = await res.json();
        if (data.success) {
            snippets = data.snippets;
            renderSnippetsBar();
        }
    } catch (_) {}
}

function renderSnippetsBar() {
    const bar = document.getElementById('snippetsBar');
    if (!bar) return;
    if (!isConnected() && snippets.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';

    // Group by category
    const grouped = {};
    for (const s of snippets) {
        const cat = s.category || 'general';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(s);
    }

    let html = '<button class="snippet-add-btn" onclick="addSnippet()" title="Add snippet">+</button>';
    html += '<button class="snippet-add-btn" onclick="toggleRecordingControls()" title="Recordings">⏺</button>';

    for (const cat of Object.keys(grouped)) {
        html += '<span class="snippet-category-label">' + escapeHtml(cat) + ':</span>';
        for (const s of grouped[cat]) {
            html += '<button class="snippet-btn" onclick="runSnippet(\'' + escapeHtml(s.command).replace(/'/g, "\\'") + '\')" title="' + escapeHtml(s.command) + '">' + escapeHtml(s.name);
            html += '<span class="snippet-delete" onclick="event.stopPropagation(); deleteSnippet(' + s.id + ')">&times;</span>';
            html += '</button>';
        }
    }

    // Recording controls
    html += '<span class="recording-controls" id="recordingControls">';
    if (isRecording) {
        html += '<button class="snippet-btn recording-btn active" onclick="stopRecording()">⏹ STOP</button>';
    } else {
        html += '<button class="snippet-btn recording-btn" onclick="startRecording()">⏺ REC</button>';
    }
    html += '<button class="snippet-btn" onclick="showRecordingsList()">📼 LIST</button>';
    html += '</span>';

    bar.innerHTML = html;
}

async function addSnippet() {
    const name = prompt('Snippet name:');
    if (!name) return;
    const command = prompt('Command to run:');
    if (!command) return;
    const category = prompt('Category:', 'general') || 'general';
    try {
        const res = await fetch('/api/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, command, category })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Snippet added: ' + name, 'success');
            fetchSnippets();
        }
    } catch (err) {
        addLog('Snippet error: ' + err.message, 'error');
    }
}

async function deleteSnippet(id) {
    if (!confirm('Delete this snippet?')) return;
    try {
        await fetch('/api/snippets/' + id, { method: 'DELETE' });
        fetchSnippets();
    } catch (_) {}
}

function runSnippet(command) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !clientId) {
        addLog('Not connected', 'warning');
        return;
    }
    ws.send(JSON.stringify({ type: 'terminal-input', data: command + '\n', clientId }));
    switchTab('terminal');
    addLog('Executed snippet: ' + command.substring(0, 40), 'info');
}

function toggleRecordingControls() {
    const ctrl = document.getElementById('recordingControls');
    if (ctrl) ctrl.style.display = ctrl.style.display === 'none' ? 'inline-flex' : 'none';
}

// ─── TERMINAL RECORDING ───
function startRecording() {
    isRecording = true;
    recordingData = [];
    recordingStartTime = Date.now();
    addLog('Recording started', 'info');
    renderSnippetsBar();
}

async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    const duration = Date.now() - recordingStartTime;
    const name = prompt('Recording name:', 'Recording ' + new Date().toLocaleTimeString());
    if (!name) { recordingData = []; renderSnippetsBar(); return; }

    const host = document.getElementById('ec2Host')?.value || '';
    try {
        const res = await fetch('/api/recordings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, host, data: JSON.stringify(recordingData), duration })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Recording saved: ' + name, 'success');
        }
    } catch (err) {
        addLog('Recording save error: ' + err.message, 'error');
    }
    recordingData = [];
    renderSnippetsBar();
}

async function showRecordingsList() {
    try {
        const res = await fetch('/api/recordings');
        const data = await res.json();
        if (!data.success) return;
        recordings = data.recordings;
    } catch (_) { return; }

    // Show as overlay in terminal panel
    const panel = document.getElementById('panelTerminal');
    let existing = document.getElementById('recordingsOverlay');
    if (existing) { existing.remove(); return; }

    let html = '<div class="playback-overlay" id="recordingsOverlay">';
    html += '<div class="editor-toolbar"><span class="editor-path">📼 Terminal Recordings</span>';
    html += '<button class="btn btn-editor btn-editor-close" onclick="document.getElementById(\'recordingsOverlay\').remove()">CLOSE</button></div>';
    html += '<div class="recordings-list">';
    if (recordings.length === 0) {
        html += '<div style="padding:20px;text-align:center;color:var(--c-text-dim)">No recordings yet</div>';
    }
    for (const r of recordings) {
        const dur = Math.round((r.duration || 0) / 1000);
        html += '<div class="recording-item">';
        html += '<span class="recording-name">' + escapeHtml(r.name) + '</span>';
        html += '<span class="recording-meta">' + dur + 's &middot; ' + escapeHtml(r.host || '') + ' &middot; ' + timeAgo(r.created_at) + '</span>';
        html += '<button class="btn-kill" onclick="playRecording(' + r.id + ')">▶</button>';
        html += '<button class="btn-kill" onclick="deleteRecording(' + r.id + ')">✕</button>';
        html += '</div>';
    }
    html += '</div></div>';

    const div = document.createElement('div');
    div.innerHTML = html;
    panel.appendChild(div.firstChild);
}

async function playRecording(id) {
    try {
        const res = await fetch('/api/recordings/' + id);
        const data = await res.json();
        if (!data.success) return;

        const recording = data.recording;
        const events = JSON.parse(recording.data);
        if (!events || events.length === 0) { addLog('Empty recording', 'warning'); return; }

        // Close recordings list
        const overlay = document.getElementById('recordingsOverlay');
        if (overlay) overlay.remove();

        // Create playback overlay with its own xterm
        const panel = document.getElementById('panelTerminal');
        const playDiv = document.createElement('div');
        playDiv.id = 'playbackOverlay';
        playDiv.className = 'playback-overlay';
        playDiv.innerHTML = '<div class="editor-toolbar"><span class="editor-path">▶ Playing: ' + escapeHtml(recording.name) + '</span><button class="btn btn-editor btn-editor-close" onclick="stopPlayback()">STOP</button></div><div id="playbackTerminal" style="flex:1"></div>';
        panel.appendChild(playDiv);

        playbackTerm = new Terminal({
            fontFamily: currentFont,
            fontSize: currentFontSize,
            lineHeight: 1.4,
            cursorBlink: false,
            theme: XTERM_THEMES[document.documentElement.getAttribute('data-theme') || 'daylight'] || XTERM_THEMES.daylight
        });
        const playFit = new FitAddon.FitAddon();
        playbackTerm.loadAddon(playFit);
        playbackTerm.open(document.getElementById('playbackTerminal'));
        playFit.fit();
        playbackActive = true;

        // Replay events
        for (let i = 0; i < events.length; i++) {
            if (!playbackActive) break;
            const delay = i === 0 ? 0 : Math.min(events[i].t - events[i - 1].t, 2000);
            await new Promise(r => setTimeout(r, delay));
            if (!playbackActive) break;
            playbackTerm.write(events[i].d);
        }

        if (playbackActive) {
            playbackTerm.write('\r\n\x1b[2m── Playback complete ──\x1b[0m');
        }
    } catch (err) {
        addLog('Playback error: ' + err.message, 'error');
    }
}

function stopPlayback() {
    playbackActive = false;
    if (playbackTerm) { playbackTerm.dispose(); playbackTerm = null; }
    const overlay = document.getElementById('playbackOverlay');
    if (overlay) overlay.remove();
}

async function deleteRecording(id) {
    if (!confirm('Delete this recording?')) return;
    try {
        await fetch('/api/recordings/' + id, { method: 'DELETE' });
        showRecordingsList();
    } catch (_) {}
}

// ─── NETWORK MONITORING ───
async function fetchNetwork() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('networkDashboard');
    if (!networkData) {
        dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading network data...</div></div>';
    }
    try {
        const res = await fetch('/api/network', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            networkData = data;
            renderNetwork();
            const statusEl = document.getElementById('networkStatus');
            if (statusEl) statusEl.classList.add('loaded');
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Network error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function renderNetwork() {
    const dashboard = document.getElementById('networkDashboard');
    if (!networkData) return;

    let html = '<div class="network-toolbar">';
    html += '<button class="btn-refresh-resources" onclick="fetchNetwork()"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh</button>';
    html += '<button class="live-toggle ' + (networkLive ? 'active' : '') + '" onclick="toggleNetworkLive()">' + (networkLive ? '⏸ PAUSE' : '▶ LIVE') + '</button>';
    html += '<span style="font-size:10px;color:var(--c-text-dim)">' + networkData.connections.length + ' connections &middot; ' + networkData.interfaces.length + ' interfaces</span>';
    html += '</div>';

    // Interfaces
    if (networkData.interfaces.length > 0) {
        html += '<div class="network-section"><div class="network-section-title">Network Interfaces</div>';
        html += '<table class="process-table"><thead><tr><th>Name</th><th>RX</th><th>TX</th><th>RX Pkts</th><th>TX Pkts</th></tr></thead><tbody>';
        for (const iface of networkData.interfaces) {
            html += '<tr><td>' + escapeHtml(iface.name) + '</td>';
            html += '<td>' + formatBytes(iface.rxBytes) + '</td>';
            html += '<td>' + formatBytes(iface.txBytes) + '</td>';
            html += '<td>' + iface.rxPackets.toLocaleString() + '</td>';
            html += '<td>' + iface.txPackets.toLocaleString() + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }

    // Connections
    html += '<div class="network-section"><div class="network-section-title">Active Connections</div>';
    html += '<table class="process-table"><thead><tr><th>Proto</th><th>State</th><th>Local</th><th>Remote</th><th>Process</th></tr></thead><tbody>';
    for (const c of networkData.connections.slice(0, 100)) {
        html += '<tr><td>' + escapeHtml(c.proto) + '</td>';
        html += '<td>' + escapeHtml(c.state) + '</td>';
        html += '<td>' + escapeHtml(c.localAddr + ':' + c.localPort) + '</td>';
        html += '<td>' + escapeHtml(c.remoteAddr + ':' + c.remotePort) + '</td>';
        html += '<td>' + escapeHtml(c.process || '-') + '</td></tr>';
    }
    html += '</tbody></table></div>';

    dashboard.innerHTML = html;
}

function toggleNetworkLive() {
    networkLive = !networkLive;
    if (networkLive) {
        networkInterval = setInterval(fetchNetwork, 10000);
    } else {
        if (networkInterval) { clearInterval(networkInterval); networkInterval = null; }
    }
    renderNetwork();
}

// ─── NOTIFICATION SYSTEM ───
function checkThresholds(cpu, mem, disk) {
    if (!notificationsEnabled) return;
    const now = Date.now();
    const cooldown = 60000;

    function fireAlert(metric, value, warn, crit) {
        const level = value >= crit ? 'critical' : value >= warn ? 'warning' : null;
        if (!level) return;
        if (lastNotificationTime[metric] && now - lastNotificationTime[metric] < cooldown) return;
        lastNotificationTime[metric] = now;
        const msg = metric.toUpperCase() + ' at ' + value + '% (' + level + ')';
        showToast(msg, level === 'critical' ? 'crit' : 'warn');
        if (Notification.permission === 'granted') {
            new Notification('EC2 OPS Alert', { body: msg, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">✻</text></svg>' });
        }
    }

    fireAlert('cpu', cpu, notificationThresholds.cpuWarn, notificationThresholds.cpuCrit);
    fireAlert('mem', mem, notificationThresholds.memWarn, notificationThresholds.memCrit);
    fireAlert('disk', disk, notificationThresholds.diskWarn, notificationThresholds.diskCrit);
}

function showToast(message, level) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + (level || 'info');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-exit'); setTimeout(() => toast.remove(), 300); }, 5000);
}

function openNotificationSettings() {
    const existing = document.getElementById('notifSettingsOverlay');
    if (existing) { existing.remove(); return; }

    let html = '<div class="notif-settings-overlay" id="notifSettingsOverlay">';
    html += '<div class="perm-dialog">';
    html += '<div class="perm-dialog-title">Alert Settings</div>';
    html += '<div class="notif-settings-form">';
    html += '<label class="perm-checkbox"><input type="checkbox" id="notifEnabled" ' + (notificationsEnabled ? 'checked' : '') + '> Enable notifications</label>';
    html += '<div class="notif-threshold-row"><span>CPU Warning:</span><input type="number" id="cpuWarn" value="' + notificationThresholds.cpuWarn + '" min="0" max="100">%</div>';
    html += '<div class="notif-threshold-row"><span>CPU Critical:</span><input type="number" id="cpuCrit" value="' + notificationThresholds.cpuCrit + '" min="0" max="100">%</div>';
    html += '<div class="notif-threshold-row"><span>MEM Warning:</span><input type="number" id="memWarn" value="' + notificationThresholds.memWarn + '" min="0" max="100">%</div>';
    html += '<div class="notif-threshold-row"><span>MEM Critical:</span><input type="number" id="memCrit" value="' + notificationThresholds.memCrit + '" min="0" max="100">%</div>';
    html += '<div class="notif-threshold-row"><span>DISK Warning:</span><input type="number" id="diskWarn" value="' + notificationThresholds.diskWarn + '" min="0" max="100">%</div>';
    html += '<div class="notif-threshold-row"><span>DISK Critical:</span><input type="number" id="diskCrit" value="' + notificationThresholds.diskCrit + '" min="0" max="100">%</div>';
    html += '</div>';
    html += '<div class="perm-actions">';
    html += '<button class="btn btn-editor btn-editor-save" onclick="saveNotificationSettings()">SAVE</button>';
    html += '<button class="btn btn-editor btn-editor-close" onclick="document.getElementById(\'notifSettingsOverlay\').remove()">CANCEL</button>';
    html += '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);

    // Request notification permission
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function saveNotificationSettings() {
    notificationsEnabled = document.getElementById('notifEnabled')?.checked || false;
    notificationThresholds = {
        cpuWarn: parseInt(document.getElementById('cpuWarn')?.value) || 70,
        cpuCrit: parseInt(document.getElementById('cpuCrit')?.value) || 90,
        memWarn: parseInt(document.getElementById('memWarn')?.value) || 70,
        memCrit: parseInt(document.getElementById('memCrit')?.value) || 90,
        diskWarn: parseInt(document.getElementById('diskWarn')?.value) || 80,
        diskCrit: parseInt(document.getElementById('diskCrit')?.value) || 95
    };
    localStorage.setItem('ec2ops-notifications', notificationsEnabled);
    localStorage.setItem('ec2ops-thresholds', JSON.stringify(notificationThresholds));
    document.getElementById('notifSettingsOverlay')?.remove();
    addLog('Notification settings saved', 'success');
}

// ─── USER MANAGEMENT ───
async function fetchUsers() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('userDashboard');
    dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading users...</div></div>';
    try {
        const [usersRes, keysRes] = await Promise.all([
            fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) }),
            fetch('/api/ssh-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) })
        ]);
        const usersData = await usersRes.json();
        const keysData = await keysRes.json();
        if (usersData.success) userData = usersData.users;
        if (keysData.success) sshKeysData = keysData.keys;
        renderUsers();
        const statusEl = document.getElementById('userStatus');
        if (statusEl) statusEl.classList.add('loaded');
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Users error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function renderUsers() {
    const dashboard = document.getElementById('userDashboard');
    if (!userData) return;

    let html = '<div class="user-toolbar">';
    html += '<button class="btn-refresh-resources" onclick="fetchUsers()"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh</button>';
    html += '<button class="btn-refresh-resources" onclick="openAddUserDialog()">+ ADD USER</button>';
    html += '</div>';

    // Users table
    html += '<div class="network-section"><div class="network-section-title">System Users (' + userData.length + ')</div>';
    html += '<table class="process-table"><thead><tr><th>User</th><th>UID</th><th>Home</th><th>Shell</th><th>Sudo</th><th>Actions</th></tr></thead><tbody>';
    for (const u of userData) {
        html += '<tr><td><strong>' + escapeHtml(u.username) + '</strong></td>';
        html += '<td>' + u.uid + '</td>';
        html += '<td>' + escapeHtml(u.home) + '</td>';
        html += '<td>' + escapeHtml(u.shell.split('/').pop()) + '</td>';
        html += '<td>';
        if (u.isSudo) {
            html += '<span class="user-sudo-badge" onclick="toggleSudo(\'' + escapeHtml(u.username) + '\', true)" title="Click to revoke sudo">SUDO</span>';
        } else if (u.username !== 'root') {
            html += '<button class="btn-kill" onclick="toggleSudo(\'' + escapeHtml(u.username) + '\', false)" title="Grant sudo">+sudo</button>';
        }
        html += '</td><td>';
        if (u.username !== 'root') {
            html += '<button class="btn-kill" onclick="deleteUser(\'' + escapeHtml(u.username) + '\')" title="Delete user">✕</button>';
        }
        html += '</td></tr>';
    }
    html += '</tbody></table></div>';

    // SSH Keys section
    html += renderSSHKeys();

    // Add user dialog
    if (addUserDialogOpen) {
        html += '<div class="perm-dialog-overlay"><div class="perm-dialog">';
        html += '<div class="perm-dialog-title">Add New User</div>';
        html += '<div class="notif-settings-form">';
        html += '<div class="notif-threshold-row"><span>Username:</span><input type="text" id="newUsername" placeholder="username"></div>';
        html += '<div class="notif-threshold-row"><span>Password:</span><input type="password" id="newPassword" placeholder="password"></div>';
        html += '<label class="perm-checkbox"><input type="checkbox" id="newUserSudo"> Grant sudo access</label>';
        html += '</div>';
        html += '<div class="perm-actions">';
        html += '<button class="btn btn-editor btn-editor-save" onclick="addUser()">CREATE</button>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="addUserDialogOpen=false;renderUsers()">CANCEL</button>';
        html += '</div></div></div>';
    }

    dashboard.innerHTML = html;
}

function openAddUserDialog() {
    addUserDialogOpen = true;
    renderUsers();
}

async function addUser() {
    const username = document.getElementById('newUsername')?.value?.trim();
    const password = document.getElementById('newPassword')?.value;
    const sudo = document.getElementById('newUserSudo')?.checked || false;
    if (!username || !password) { addLog('Username and password required', 'warning'); return; }
    try {
        const res = await fetch('/api/users/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, username, password, sudo })
        });
        const data = await res.json();
        if (data.success) {
            addLog('User added: ' + username, 'success');
            addUserDialogOpen = false;
            fetchUsers();
        } else {
            addLog('Add user failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Add user error: ' + err.message, 'error');
    }
}

async function deleteUser(username) {
    if (!confirm('Delete user ' + username + '? This will remove their home directory.')) return;
    try {
        const res = await fetch('/api/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, username })
        });
        const data = await res.json();
        if (data.success) {
            addLog('User deleted: ' + username, 'success');
            fetchUsers();
        } else {
            addLog('Delete user failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Delete user error: ' + err.message, 'error');
    }
}

async function toggleSudo(username, currentState) {
    const action = currentState ? 'Remove' : 'Grant';
    if (!confirm(action + ' sudo access for ' + username + '?')) return;
    try {
        const res = await fetch('/api/users/sudo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, username, enable: !currentState })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Sudo ' + (currentState ? 'revoked' : 'granted') + ': ' + username, 'success');
            fetchUsers();
        } else {
            addLog('Sudo toggle failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Sudo error: ' + err.message, 'error');
    }
}

// ─── SSH KEY MANAGEMENT ───
function renderSSHKeys() {
    let html = '<div class="network-section"><div class="network-section-title">SSH Authorized Keys (' + (sshKeysData ? sshKeysData.length : 0) + ')</div>';

    if (!sshKeysData || sshKeysData.length === 0) {
        html += '<div style="padding:12px;color:var(--c-text-dim);font-size:11px">No authorized keys found</div>';
    } else {
        html += '<table class="process-table"><thead><tr><th>Type</th><th>Key</th><th>Comment</th><th>Actions</th></tr></thead><tbody>';
        for (const k of sshKeysData) {
            html += '<tr><td>' + escapeHtml(k.type) + '</td>';
            html += '<td style="font-size:10px">' + escapeHtml(k.key) + '</td>';
            html += '<td>' + escapeHtml(k.comment || '-') + '</td>';
            html += '<td><button class="btn-kill" onclick="deleteSSHKey(' + k.lineIndex + ')">✕</button></td></tr>';
        }
        html += '</tbody></table>';
    }

    html += '<button class="btn-refresh-resources" onclick="openAddKeyDialog()" style="margin:8px 16px">+ ADD KEY</button>';

    // Add key dialog
    if (addKeyDialogOpen) {
        html += '<div class="add-key-overlay">';
        html += '<textarea class="add-key-textarea" id="newPublicKey" placeholder="Paste SSH public key (ssh-rsa AAAA... user@host)" rows="3"></textarea>';
        html += '<div class="perm-actions" style="margin-top:8px">';
        html += '<button class="btn btn-editor btn-editor-save" onclick="addSSHKey()">ADD KEY</button>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="addKeyDialogOpen=false;renderUsers()">CANCEL</button>';
        html += '</div></div>';
    }

    html += '</div>';

    // Key rotation section
    html += '<div class="key-rotation-section">';
    html += '<div class="network-section-title">SSH Key Rotation</div>';
    html += '<div style="padding:8px 16px">';
    html += '<p style="font-size:10px;color:var(--c-text-dim);margin:0 0 8px">Generate a new RSA-4096 key pair, deploy the public key, and download the private key.</p>';
    html += '<button class="btn-small" onclick="generateSSHKey()">GENERATE NEW KEY PAIR</button>';
    html += '<div id="keyRotationResult"></div>';
    html += '</div></div>';

    return html;
}

function openAddKeyDialog() {
    addKeyDialogOpen = true;
    renderUsers();
}

async function addSSHKey() {
    const key = document.getElementById('newPublicKey')?.value?.trim();
    if (!key) { addLog('Public key required', 'warning'); return; }
    try {
        const res = await fetch('/api/ssh-keys/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, publicKey: key })
        });
        const data = await res.json();
        if (data.success) {
            addLog('SSH key added', 'success');
            addKeyDialogOpen = false;
            fetchUsers();
        } else {
            addLog('Add key failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Add key error: ' + err.message, 'error');
    }
}

async function deleteSSHKey(lineIndex) {
    if (!confirm('Delete this SSH key?')) return;
    try {
        const res = await fetch('/api/ssh-keys/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, lineIndex })
        });
        const data = await res.json();
        if (data.success) {
            addLog('SSH key deleted', 'success');
            fetchUsers();
        } else {
            addLog('Delete key failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Delete key error: ' + err.message, 'error');
    }
}

// ─── DOCKER MANAGEMENT ───

async function fetchDockerCheck() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/docker/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        dockerAvailable = data.installed;
        dockerVersion = data.dockerVersion || '';
        dockerComposeVersion = data.composeVersion || '';
        dockerHasCompose = data.hasCompose;
        if (dockerAvailable) {
            fetchDockerContainers();
        } else {
            renderDocker();
        }
    } catch (err) {
        dockerAvailable = false;
        renderDocker();
    }
}

async function fetchDockerContainers() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('dockerDashboard');
    if (!dockerContainers && dashboard) {
        dashboard.innerHTML = renderDockerSubTabs() + '<div class="docker-subcontent"><div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading containers...</div></div></div>';
    }
    try {
        const res = await fetch('/api/docker/containers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            dockerContainers = data.containers;
            for (const c of dockerContainers) {
                if (!dockerStatsHistory[c.id]) dockerStatsHistory[c.id] = [];
                dockerStatsHistory[c.id].push({ cpu: c.cpu || 0, mem: c.mem || 0 });
                if (dockerStatsHistory[c.id].length > 20) dockerStatsHistory[c.id].shift();
            }
            renderDocker();
            const statusEl = document.getElementById('dockerStatus');
            if (statusEl) statusEl.classList.add('loaded');
        }
    } catch (err) {
        if (dashboard) dashboard.innerHTML = renderDockerSubTabs() + '<div class="docker-subcontent"><div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Docker error: ' + escapeHtml(err.message) + '</p></div></div>';
    }
}

function renderDockerSubTabs() {
    const subTabs = [
        { id: 'containers', label: 'CONTAINERS', icon: '▣' },
        { id: 'images', label: 'IMAGES', icon: '◧' },
        { id: 'compose', label: 'COMPOSE', icon: '⚙' },
        { id: 'volumes', label: 'VOLUMES', icon: '◫' },
        { id: 'networks', label: 'NETWORKS', icon: '⬡' }
    ];
    let html = '<div class="docker-subtabs">';
    for (const st of subTabs) {
        html += '<button class="docker-subtab' + (dockerActiveSubTab === st.id ? ' active' : '') + '" onclick="switchDockerSubTab(\'' + st.id + '\')">';
        html += st.icon + ' ' + st.label + '</button>';
    }
    html += '</div>';
    return html;
}

function switchDockerSubTab(subTab) {
    dockerActiveSubTab = subTab;
    renderDocker();
    if (subTab === 'containers' && !dockerContainers) fetchDockerContainers();
    if (subTab === 'images' && !dockerImages) fetchDockerImages();
    if (subTab === 'compose' && !dockerComposeFiles) fetchDockerCompose();
    if (subTab === 'volumes' && !dockerVolumes) fetchDockerVolumes();
    if (subTab === 'networks' && !dockerNetworks) fetchDockerNetworks();
}

function renderDocker() {
    const dashboard = document.getElementById('dockerDashboard');
    if (!dashboard) return;

    // Docker shell overlay takes priority
    if (dockerShellActive) {
        let html = '<div class="docker-shell-overlay">';
        html += '<div class="docker-shell-header">';
        html += '<span style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--c-accent)">SHELL: ' + escapeHtml(dockerShellContainerName) + '</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="closeDockerShell()">CLOSE</button>';
        html += '</div>';
        html += '<div class="docker-shell-container" id="dockerShellContainer"></div>';
        html += '</div>';
        dashboard.innerHTML = html;
        if (dockerShellTerm) {
            setTimeout(() => {
                const container = document.getElementById('dockerShellContainer');
                if (container) {
                    dockerShellTerm.open(container);
                    if (dockerShellFitAddon) dockerShellFitAddon.fit();
                    dockerShellTerm.focus();
                }
            }, 50);
        }
        return;
    }

    // Docker logs overlay takes priority
    if (dockerLogsContainerId) {
        renderDockerLogsOverlay();
        return;
    }

    // Docker inspect overlay
    if (dockerInspectData) {
        renderDockerInspectOverlay();
        return;
    }

    if (dockerAvailable === false) {
        let installHtml = '<div class="docker-install-prompt">';
        installHtml += '<div class="flower-icon idle">✻</div>';
        installHtml += '<p>Docker is not installed on this host</p>';
        installHtml += '<button class="btn btn-exec" onclick="installDocker()" id="dockerInstallBtn">INSTALL DOCKER</button>';
        installHtml += '<p class="docker-install-note">Installs Docker Engine + Compose (distro-aware)</p>';
        installHtml += '</div>';
        dashboard.innerHTML = installHtml;
        return;
    }
    if (dockerAvailable === null) {
        dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Checking Docker availability...</div></div>';
        return;
    }

    let html = renderDockerSubTabs();
    html += '<div class="docker-subcontent">';
    switch (dockerActiveSubTab) {
        case 'containers': html += renderDockerContainers(); break;
        case 'images': html += renderDockerImages(); break;
        case 'compose': html += renderDockerCompose(); break;
        case 'volumes': html += renderDockerVolumes(); break;
        case 'networks': html += renderDockerNetworks(); break;
    }
    html += '</div>';
    dashboard.innerHTML = html;
}

function renderDockerContainers() {
    if (!dockerContainers) return '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading containers...</div></div>';

    let filtered = dockerContainers;
    if (dockerContainerFilter) {
        const q = dockerContainerFilter.toLowerCase();
        filtered = dockerContainers.filter(c => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.state.includes(q));
    }
    filtered.sort((a, b) => {
        const va = a[dockerContainerSortBy], vb = b[dockerContainerSortBy];
        if (typeof va === 'number' && typeof vb === 'number') return dockerContainerSortDesc ? vb - va : va - vb;
        return dockerContainerSortDesc ? String(vb || '').localeCompare(String(va || '')) : String(va || '').localeCompare(String(vb || ''));
    });

    const running = dockerContainers.filter(c => c.state === 'running').length;
    const stopped = dockerContainers.length - running;

    let html = '<div class="docker-toolbar">';
    html += '<input type="text" class="docker-search" placeholder="Filter containers..." value="' + escapeHtml(dockerContainerFilter) + '" oninput="dockerContainerFilter=this.value;renderDocker()">';
    html += '<span class="docker-count">' + running + ' running / ' + stopped + ' stopped</span>';
    html += '<button class="btn-live-toggle' + (dockerLive ? ' active' : '') + '" onclick="toggleDockerLive()"><span class="live-dot"></span>LIVE</button>';
    html += '<button class="btn-refresh-resources" onclick="fetchDockerContainers()">REFRESH</button>';
    html += '<button class="btn-refresh-resources btn-docker-danger" onclick="openDockerPrune()">PRUNE</button>';
    html += '<span style="font-family:var(--font-mono);font-size:9px;color:var(--c-text-dim);margin-left:auto">Docker ' + escapeHtml(dockerVersion) + '</span>';
    html += '</div>';

    html += '<div class="docker-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th onclick="sortDockerContainers(\'name\')" class="sortable">Name' + (dockerContainerSortBy === 'name' ? (dockerContainerSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th>Image</th>';
    html += '<th onclick="sortDockerContainers(\'state\')" class="sortable">Status' + (dockerContainerSortBy === 'state' ? (dockerContainerSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th onclick="sortDockerContainers(\'cpu\')" class="sortable">CPU%' + (dockerContainerSortBy === 'cpu' ? (dockerContainerSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th onclick="sortDockerContainers(\'mem\')" class="sortable">MEM%' + (dockerContainerSortBy === 'mem' ? (dockerContainerSortDesc ? ' ▼' : ' ▲') : '') + '</th>';
    html += '<th>Ports</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const c of filtered) {
        const stateClass = 'docker-state-' + (c.state === 'running' ? 'running' : c.state === 'paused' ? 'paused' : c.state === 'restarting' ? 'restarting' : 'exited');
        const cpuClass = (c.cpu || 0) >= 80 ? 'process-cpu-crit' : (c.cpu || 0) >= 50 ? 'process-cpu-high' : '';
        const memClass = (c.mem || 0) >= 80 ? 'process-cpu-crit' : (c.mem || 0) >= 50 ? 'process-cpu-high' : '';
        const history = dockerStatsHistory[c.id] || [];

        html += '<tr>';
        html += '<td><strong>' + escapeHtml(c.name) + '</strong><br><span style="font-size:9px;color:var(--c-text-dim)">' + escapeHtml(c.id.substring(0, 12)) + '</span></td>';
        html += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(c.image) + '">' + escapeHtml(c.image) + '</td>';
        html += '<td><span class="docker-state-badge ' + stateClass + '">' + escapeHtml(c.state) + '</span><br><span style="font-size:9px;color:var(--c-text-dim)">' + escapeHtml(c.status) + '</span></td>';
        html += '<td class="' + cpuClass + '">';
        if (c.cpu !== undefined) {
            html += c.cpu.toFixed(1) + '%';
            if (history.length >= 2) html += generateSparklineSVG(history.map(h => h.cpu), c.cpu >= 80 ? 'critical' : c.cpu >= 50 ? 'warning' : 'normal');
        } else { html += '-'; }
        html += '</td>';
        html += '<td class="' + memClass + '">';
        if (c.mem !== undefined) {
            html += c.mem.toFixed(1) + '%';
            if (history.length >= 2) html += generateSparklineSVG(history.map(h => h.mem), c.mem >= 80 ? 'critical' : c.mem >= 50 ? 'warning' : 'normal');
        } else { html += '-'; }
        html += '</td>';
        html += '<td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(c.ports) + '">' + escapeHtml(c.ports || '-') + '</td>';
        html += '<td><div class="docker-actions">';
        if (c.state === 'running') {
            html += '<button class="btn-docker-action" onclick="dockerContainerAction(\'' + escapeHtml(c.id) + '\',\'stop\')" title="Stop">⏹</button>';
            html += '<button class="btn-docker-action" onclick="dockerContainerAction(\'' + escapeHtml(c.id) + '\',\'restart\')" title="Restart">↻</button>';
            html += '<button class="btn-docker-action" onclick="dockerContainerAction(\'' + escapeHtml(c.id) + '\',\'pause\')" title="Pause">⏸</button>';
            html += '<button class="btn-docker-action" onclick="openDockerShell(\'' + escapeHtml(c.id) + '\',\'' + escapeHtml(c.name).replace(/'/g, "\\'") + '\')" title="Shell">⌨</button>';
        } else if (c.state === 'paused') {
            html += '<button class="btn-docker-action" onclick="dockerContainerAction(\'' + escapeHtml(c.id) + '\',\'unpause\')" title="Unpause">▶</button>';
        } else {
            html += '<button class="btn-docker-action" onclick="dockerContainerAction(\'' + escapeHtml(c.id) + '\',\'start\')" title="Start">▶</button>';
        }
        html += '<button class="btn-docker-action" onclick="openDockerLogs(\'' + escapeHtml(c.id) + '\',\'' + escapeHtml(c.name).replace(/'/g, "\\'") + '\')" title="Logs">📋</button>';
        html += '<button class="btn-docker-action" onclick="fetchDockerInspect(\'' + escapeHtml(c.id) + '\')" title="Inspect">🔍</button>';
        html += '<button class="btn-docker-action btn-docker-danger" onclick="dockerContainerAction(\'' + escapeHtml(c.id) + '\',\'remove\')" title="Remove">✕</button>';
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div>';

    // Prune dialog overlay
    if (dockerPruneDialogOpen) {
        html += '<div class="docker-inspect-overlay" onclick="dockerPruneDialogOpen=false;renderDocker()">';
        html += '<div class="docker-inspect-panel" onclick="event.stopPropagation()" style="max-width:500px">';
        html += '<div class="docker-inspect-header"><span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">DOCKER SYSTEM PRUNE</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="dockerPruneDialogOpen=false;renderDocker()">✕</button></div>';
        html += '<div class="docker-inspect-body">';
        if (dockerDiskUsage) {
            html += '<pre style="font-family:var(--font-mono);font-size:10px;color:var(--c-text);margin:0 0 12px 0;white-space:pre-wrap">' + escapeHtml(dockerDiskUsage) + '</pre>';
        }
        html += '<p style="font-family:var(--font-mono);font-size:11px;color:var(--c-amber);margin:0 0 12px 0">This will remove all stopped containers, unused networks, and dangling images.</p>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end">';
        html += '<button class="btn btn-editor btn-editor-save" onclick="dockerPrune(false)">CLEAN UNUSED</button>';
        html += '<button class="btn btn-editor btn-editor-close" style="border-color:var(--c-red);color:var(--c-red)" onclick="dockerPrune(true)">CLEAN ALL</button>';
        html += '</div></div></div></div>';
    }

    return html;
}

function sortDockerContainers(key) {
    if (dockerContainerSortBy === key) dockerContainerSortDesc = !dockerContainerSortDesc;
    else { dockerContainerSortBy = key; dockerContainerSortDesc = key === 'cpu' || key === 'mem'; }
    renderDocker();
}

function toggleDockerLive() {
    dockerLive = !dockerLive;
    if (dockerLive) {
        dockerLiveInterval = setInterval(fetchDockerContainers, 10000);
    } else {
        if (dockerLiveInterval) { clearInterval(dockerLiveInterval); dockerLiveInterval = null; }
    }
    renderDocker();
}

async function dockerContainerAction(containerId, action) {
    if (action === 'remove' && !confirm('Remove container ' + containerId + '? This cannot be undone.')) return;
    if (action === 'stop' && !confirm('Stop container ' + containerId + '?')) return;
    try {
        const res = await fetch('/api/docker/container/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, containerId, action })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Docker ' + action + ': ' + containerId, 'success');
            setTimeout(fetchDockerContainers, 500);
        } else {
            addLog('Docker ' + action + ' failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Docker error: ' + err.message, 'error');
    }
}

async function openDockerPrune() {
    dockerPruneDialogOpen = true;
    dockerDiskUsage = '';
    renderDocker();
    try {
        const res = await fetch('/api/docker/system/df', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) dockerDiskUsage = data.usage;
        renderDocker();
    } catch (_) {}
}

async function dockerPrune(all) {
    try {
        const res = await fetch('/api/docker/system/prune', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, all })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Docker prune complete', 'success');
            dockerPruneDialogOpen = false;
            fetchDockerContainers();
        } else {
            addLog('Docker prune failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Docker prune error: ' + err.message, 'error');
    }
}

// ─── DOCKER INSPECT ───

async function fetchDockerInspect(containerId) {
    try {
        const res = await fetch('/api/docker/container/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, containerId })
        });
        const data = await res.json();
        if (data.success) {
            dockerInspectData = data.inspect;
            dockerInspectContainerId = containerId;
            renderDocker();
        }
    } catch (err) {
        addLog('Inspect error: ' + err.message, 'error');
    }
}

function renderDockerInspectOverlay() {
    const dashboard = document.getElementById('dockerDashboard');
    if (!dashboard || !dockerInspectData) return;
    const d = dockerInspectData;

    let html = '<div class="docker-inspect-overlay">';
    html += '<div class="docker-inspect-panel" style="max-width:750px;max-height:85%">';
    html += '<div class="docker-inspect-header">';
    html += '<span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">INSPECT: ' + escapeHtml(d.name || d.id) + '</span>';
    html += '<button class="btn btn-editor btn-editor-close" onclick="dockerInspectData=null;renderDocker()">CLOSE</button>';
    html += '</div>';
    html += '<div class="docker-inspect-body">';

    // State section
    html += '<div class="docker-inspect-section"><h4>State</h4>';
    html += '<table class="docker-kv-table">';
    html += '<tr><td>Status</td><td><span class="docker-state-badge docker-state-' + (d.state.status === 'running' ? 'running' : 'exited') + '">' + escapeHtml(d.state.status) + '</span></td></tr>';
    html += '<tr><td>Started</td><td>' + escapeHtml(d.state.startedAt || '-') + '</td></tr>';
    html += '<tr><td>PID</td><td>' + (d.state.pid || '-') + '</td></tr>';
    if (d.state.exitCode) html += '<tr><td>Exit Code</td><td>' + d.state.exitCode + '</td></tr>';
    html += '</table></div>';

    // Config section
    html += '<div class="docker-inspect-section"><h4>Config</h4>';
    html += '<table class="docker-kv-table">';
    html += '<tr><td>Image</td><td>' + escapeHtml(d.image || '-') + '</td></tr>';
    html += '<tr><td>Hostname</td><td>' + escapeHtml(d.config.hostname || '-') + '</td></tr>';
    html += '<tr><td>Working Dir</td><td>' + escapeHtml(d.config.workingDir || '-') + '</td></tr>';
    html += '<tr><td>CMD</td><td>' + escapeHtml((d.config.cmd || []).join(' ') || '-') + '</td></tr>';
    html += '<tr><td>Entrypoint</td><td>' + escapeHtml((d.config.entrypoint || []).join(' ') || '-') + '</td></tr>';
    html += '</table></div>';

    // Environment Variables
    if (d.config.env && d.config.env.length > 0) {
        html += '<div class="docker-inspect-section"><h4>Environment (' + d.config.env.length + ')</h4>';
        html += '<table class="docker-kv-table">';
        for (const e of d.config.env) {
            const [key, ...val] = e.split('=');
            html += '<tr><td class="docker-env-key">' + escapeHtml(key) + '</td><td>' + escapeHtml(val.join('=')) + '</td></tr>';
        }
        html += '</table></div>';
    }

    // Mounts
    if (d.mounts && d.mounts.length > 0) {
        html += '<div class="docker-inspect-section"><h4>Mounts (' + d.mounts.length + ')</h4>';
        html += '<table class="process-table"><thead><tr><th>Type</th><th>Source</th><th>Destination</th><th>RW</th></tr></thead><tbody>';
        for (const m of d.mounts) {
            html += '<tr><td>' + escapeHtml(m.type) + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(m.source) + '">' + escapeHtml(m.source) + '</td>';
            html += '<td>' + escapeHtml(m.destination) + '</td><td>' + (m.rw ? 'Yes' : 'No') + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }

    // Networks
    const nets = Object.keys(d.networkSettings.networks || {});
    if (nets.length > 0) {
        html += '<div class="docker-inspect-section"><h4>Networks</h4>';
        html += '<table class="docker-kv-table">';
        for (const netName of nets) {
            const net = d.networkSettings.networks[netName];
            html += '<tr><td>' + escapeHtml(netName) + '</td><td>IP: ' + escapeHtml(net.IPAddress || '-') + ' / Gateway: ' + escapeHtml(net.Gateway || '-') + '</td></tr>';
        }
        html += '</table></div>';
    }

    // Resource limits
    html += '<div class="docker-inspect-section"><h4>Resources</h4>';
    html += '<table class="docker-kv-table">';
    html += '<tr><td>Memory Limit</td><td>' + (d.hostConfig.memory ? formatBytes(d.hostConfig.memory) : 'Unlimited') + '</td></tr>';
    html += '<tr><td>CPU Shares</td><td>' + (d.hostConfig.cpuShares || 'Default') + '</td></tr>';
    if (d.hostConfig.restartPolicy) html += '<tr><td>Restart Policy</td><td>' + escapeHtml(d.hostConfig.restartPolicy.Name || '-') + '</td></tr>';
    html += '</table></div>';

    // Binds
    if (d.hostConfig.binds && d.hostConfig.binds.length > 0) {
        html += '<div class="docker-inspect-section"><h4>Bind Mounts</h4>';
        html += '<ul style="font-family:var(--font-mono);font-size:10px;color:var(--c-text);margin:0;padding-left:16px">';
        for (const b of d.hostConfig.binds) html += '<li>' + escapeHtml(b) + '</li>';
        html += '</ul></div>';
    }

    html += '</div></div></div>';
    dashboard.innerHTML = html;
}

// ─── DOCKER LOGS ───

async function openDockerLogs(containerId, containerName) {
    dockerLogsContainerId = containerId;
    dockerLogsContainerName = containerName;
    dockerLogsContent = '';
    dockerLogsFollow = false;
    dockerLogsStreaming = false;
    dockerLogsFilter = '';
    renderDocker();
    try {
        const res = await fetch('/api/docker/container/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, containerId, tail: 200 })
        });
        const data = await res.json();
        if (data.success) {
            dockerLogsContent = data.logs;
            renderDocker();
        }
    } catch (err) {
        addLog('Logs error: ' + err.message, 'error');
    }
}

function renderDockerLogsOverlay() {
    const dashboard = document.getElementById('dockerDashboard');
    if (!dashboard) return;

    let html = '<div class="docker-logs-overlay">';
    html += '<div class="docker-logs-header">';
    html += '<span style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--c-accent)">LOGS: ' + escapeHtml(dockerLogsContainerName) + '</span>';
    html += '<div style="display:flex;gap:6px">';
    html += '<button class="btn-live-toggle' + (dockerLogsFollow ? ' active' : '') + '" onclick="toggleDockerLogsFollow()"><span class="live-dot"></span>FOLLOW</button>';
    html += '<button class="btn btn-editor btn-editor-close" onclick="stopDockerLogs()">CLOSE</button>';
    html += '</div></div>';
    html += '<div class="docker-logs-toolbar">';
    html += '<input type="text" class="docker-search" placeholder="Filter logs..." value="' + escapeHtml(dockerLogsFilter) + '" oninput="dockerLogsFilter=this.value;renderDockerLogsContent()" style="width:250px">';
    html += '<span class="docker-count">' + dockerLogsContent.split('\n').length + ' lines</span>';
    html += '</div>';
    html += '<div class="docker-logs-content" id="dockerLogsContent"></div>';
    html += '</div>';
    dashboard.innerHTML = html;
    renderDockerLogsContent();
}

function renderDockerLogsContent() {
    const el = document.getElementById('dockerLogsContent');
    if (!el) return;
    let lines = dockerLogsContent;
    if (dockerLogsFilter) {
        const q = dockerLogsFilter.toLowerCase();
        lines = lines.split('\n').filter(l => l.toLowerCase().includes(q)).join('\n');
    }
    el.textContent = lines;
    if (dockerLogsFollow) el.scrollTop = el.scrollHeight;
}

function toggleDockerLogsFollow() {
    dockerLogsFollow = !dockerLogsFollow;
    if (dockerLogsFollow && !dockerLogsStreaming) {
        dockerLogsStreaming = true;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'docker-logs-start', clientId, containerId: dockerLogsContainerId }));
        }
    } else if (!dockerLogsFollow && dockerLogsStreaming) {
        dockerLogsStreaming = false;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'docker-logs-stop', clientId, containerId: dockerLogsContainerId }));
        }
    }
    renderDocker();
}

function stopDockerLogs() {
    if (dockerLogsStreaming && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'docker-logs-stop', clientId, containerId: dockerLogsContainerId }));
    }
    dockerLogsContainerId = null;
    dockerLogsContent = '';
    dockerLogsStreaming = false;
    dockerLogsFollow = false;
    renderDocker();
}

// ─── DOCKER SHELL ───

function openDockerShell(containerId, containerName) {
    dockerShellContainerId = containerId;
    dockerShellContainerName = containerName;
    dockerShellActive = true;

    dockerShellTerm = new Terminal({
        cursorBlink: true,
        fontSize: currentFontSize,
        fontFamily: currentFont,
        theme: XTERM_THEMES[document.documentElement.getAttribute('data-theme') || 'daylight'] || XTERM_THEMES.daylight
    });
    dockerShellFitAddon = new FitAddon.FitAddon();
    dockerShellTerm.loadAddon(dockerShellFitAddon);

    dockerShellTerm.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'docker-shell-input', clientId, data }));
        }
    });

    dockerShellTerm.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'docker-shell-resize', clientId, cols, rows }));
        }
    });

    renderDocker();

    setTimeout(() => {
        if (dockerShellFitAddon) dockerShellFitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
            const dims = dockerShellTerm ? { cols: dockerShellTerm.cols, rows: dockerShellTerm.rows } : { cols: 120, rows: 30 };
            ws.send(JSON.stringify({ type: 'docker-shell-start', clientId, containerId, ...dims }));
        }
    }, 100);

    addLog('Docker shell opened: ' + containerName, 'info');
}

function handleDockerShellExit() {
    if (dockerShellTerm) {
        dockerShellTerm.write('\r\n\x1b[33mShell session ended.\x1b[0m\r\n');
    }
    setTimeout(() => {
        if (dockerShellTerm) { dockerShellTerm.dispose(); dockerShellTerm = null; }
        dockerShellActive = false;
        dockerShellContainerId = null;
        renderDocker();
    }, 1500);
}

function closeDockerShell() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'docker-shell-stop', clientId }));
    }
    if (dockerShellTerm) { dockerShellTerm.dispose(); dockerShellTerm = null; }
    dockerShellActive = false;
    dockerShellContainerId = null;
    renderDocker();
    addLog('Docker shell closed', 'info');
}

// ─── DOCKER IMAGES ───

async function fetchDockerImages() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/docker/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            dockerImages = data.images;
            renderDocker();
        }
    } catch (err) {
        addLog('Images error: ' + err.message, 'error');
    }
}

function renderDockerImages() {
    if (!dockerImages) return '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading images...</div></div>';

    let html = '<div class="docker-toolbar">';
    html += '<span class="docker-count">' + dockerImages.length + ' images</span>';
    html += '<button class="btn-refresh-resources" onclick="fetchDockerImages()">REFRESH</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerPullDialogOpen=true;renderDocker()">PULL IMAGE</button>';
    html += '</div>';

    html += '<div class="docker-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th>Repository</th><th>Tag</th><th>ID</th><th>Created</th><th>Size</th><th>Actions</th>';
    html += '</tr></thead><tbody>';
    for (const img of dockerImages) {
        html += '<tr>';
        html += '<td>' + escapeHtml(img.repository) + '</td>';
        html += '<td><span class="docker-state-badge docker-state-running">' + escapeHtml(img.tag) + '</span></td>';
        html += '<td style="font-size:10px;color:var(--c-text-dim)">' + escapeHtml(img.id.substring(0, 12)) + '</td>';
        html += '<td>' + escapeHtml(img.createdSince) + '</td>';
        html += '<td>' + escapeHtml(img.size) + '</td>';
        html += '<td><div class="docker-actions">';
        html += '<button class="btn-docker-action" onclick="viewDockerImageLayers(\'' + escapeHtml(img.id) + '\')" title="Layers">◫</button>';
        html += '<button class="btn-docker-action btn-docker-danger" onclick="removeDockerImage(\'' + escapeHtml(img.id) + '\')" title="Remove">✕</button>';
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div>';

    // Pull dialog
    if (dockerPullDialogOpen) {
        html += '<div class="docker-inspect-overlay" onclick="dockerPullDialogOpen=false;renderDocker()">';
        html += '<div class="docker-inspect-panel" onclick="event.stopPropagation()" style="max-width:400px">';
        html += '<div class="docker-inspect-header"><span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">PULL IMAGE</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="dockerPullDialogOpen=false;renderDocker()">✕</button></div>';
        html += '<div class="docker-inspect-body">';
        html += '<div class="docker-create-row"><label>Image</label><input type="text" id="dockerPullInput" placeholder="nginx:latest" spellcheck="false"></div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">';
        html += '<button class="btn btn-editor btn-editor-save" onclick="pullDockerImage()">PULL</button>';
        html += '</div></div></div></div>';
    }

    return html;
}

async function pullDockerImage() {
    const input = document.getElementById('dockerPullInput');
    if (!input || !input.value.trim()) return;
    const imageName = input.value.trim();
    addLog('Pulling image: ' + imageName + '...', 'info');
    dockerPullDialogOpen = false;
    renderDocker();
    try {
        const res = await fetch('/api/docker/images/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, imageName })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Image pulled: ' + imageName, 'success');
            fetchDockerImages();
        } else {
            addLog('Pull failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Pull error: ' + err.message, 'error');
    }
}

async function removeDockerImage(imageId) {
    if (!confirm('Remove image ' + imageId + '?')) return;
    try {
        const res = await fetch('/api/docker/images/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, imageId })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Image removed: ' + imageId, 'success');
            fetchDockerImages();
        } else {
            addLog('Remove failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Remove error: ' + err.message, 'error');
    }
}

async function viewDockerImageLayers(imageId) {
    try {
        const res = await fetch('/api/docker/images/layers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, imageId })
        });
        const data = await res.json();
        if (data.success && data.layers) {
            dockerInspectData = { name: 'Image Layers: ' + imageId.substring(0, 12), isImageLayers: true, layers: data.layers };
            renderDocker();
        }
    } catch (err) {
        addLog('Layers error: ' + err.message, 'error');
    }
}

// ─── DOCKER COMPOSE ───

async function fetchDockerCompose() {
    if (!isConnected()) return;
    if (!dockerHasCompose) {
        dockerComposeFiles = [];
        renderDocker();
        return;
    }
    try {
        const res = await fetch('/api/docker/compose/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            dockerComposeFiles = data.composeFiles || [];
            if (dockerComposeFiles.length > 0 && !dockerSelectedComposePath) {
                dockerSelectedComposePath = dockerComposeFiles[0];
                fetchDockerComposeStatus();
            } else {
                renderDocker();
            }
        }
    } catch (err) {
        dockerComposeFiles = [];
        renderDocker();
    }
}

async function fetchDockerComposeStatus() {
    if (!dockerSelectedComposePath) return;
    try {
        const res = await fetch('/api/docker/compose/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, composePath: dockerSelectedComposePath })
        });
        const data = await res.json();
        if (data.success) {
            dockerComposeData = data.services;
            renderDocker();
        }
    } catch (err) {
        dockerComposeData = [];
        renderDocker();
    }
}

function renderDockerCompose() {
    if (!dockerComposeFiles) return '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Detecting compose files...</div></div>';

    if (!dockerHasCompose) return '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Docker Compose is not installed on this host</p></div>';

    if (dockerComposeFiles.length === 0) return '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>No docker-compose files found</p></div>';

    let html = '<div class="docker-toolbar">';
    html += '<select class="docker-search" style="width:auto" onchange="dockerSelectedComposePath=this.value;dockerComposeData=null;fetchDockerComposeStatus()">';
    for (const f of dockerComposeFiles) {
        html += '<option value="' + escapeHtml(f) + '"' + (f === dockerSelectedComposePath ? ' selected' : '') + '>' + escapeHtml(f) + '</option>';
    }
    html += '</select>';
    html += '<button class="btn-refresh-resources" onclick="fetchDockerComposeStatus()">REFRESH</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerComposeAction(\'up -d\')">UP</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerComposeAction(\'down\')">DOWN</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerComposeAction(\'restart\')">RESTART</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerComposeAction(\'pull\')">PULL</button>';
    html += '</div>';

    if (!dockerComposeData) return html + '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading services...</div></div>';

    html += '<div class="docker-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th>Service</th><th>Name</th><th>Status</th><th>Ports</th>';
    html += '</tr></thead><tbody>';
    for (const s of dockerComposeData) {
        const stateClass = s.state === 'running' ? 'docker-state-running' : 'docker-state-exited';
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(s.service) + '</strong></td>';
        html += '<td>' + escapeHtml(s.name) + '</td>';
        html += '<td><span class="docker-state-badge ' + stateClass + '">' + escapeHtml(s.state || s.status) + '</span></td>';
        html += '<td style="font-size:10px">' + escapeHtml(s.ports || '-') + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
}

async function dockerComposeAction(action) {
    if (action === 'down' && !confirm('Take down compose stack?')) return;
    addLog('Docker compose ' + action + '...', 'info');
    try {
        const res = await fetch('/api/docker/compose/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, composePath: dockerSelectedComposePath, action })
        });
        const data = await res.json();
        if (data.success) {
            addLog('Compose ' + action + ' complete', 'success');
            setTimeout(fetchDockerComposeStatus, 1000);
        } else {
            addLog('Compose ' + action + ' failed: ' + data.error, 'error');
        }
    } catch (err) {
        addLog('Compose error: ' + err.message, 'error');
    }
}

// ─── DOCKER VOLUMES ───

async function fetchDockerVolumes() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/docker/volumes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            dockerVolumes = data.volumes;
            renderDocker();
        }
    } catch (err) {
        addLog('Volumes error: ' + err.message, 'error');
    }
}

function renderDockerVolumes() {
    if (!dockerVolumes) return '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading volumes...</div></div>';

    let html = '<div class="docker-toolbar">';
    html += '<span class="docker-count">' + dockerVolumes.length + ' volumes</span>';
    html += '<button class="btn-refresh-resources" onclick="fetchDockerVolumes()">REFRESH</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerCreateVolumeOpen=true;renderDocker()">CREATE VOLUME</button>';
    html += '</div>';

    html += '<div class="docker-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th>Name</th><th>Driver</th><th>Scope</th><th>Mountpoint</th><th>Actions</th>';
    html += '</tr></thead><tbody>';
    for (const v of dockerVolumes) {
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(v.name) + '</strong></td>';
        html += '<td>' + escapeHtml(v.driver) + '</td>';
        html += '<td>' + escapeHtml(v.scope) + '</td>';
        html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(v.mountpoint) + '">' + escapeHtml(v.mountpoint) + '</td>';
        html += '<td><div class="docker-actions">';
        html += '<button class="btn-docker-action" onclick="inspectDockerVolume(\'' + escapeHtml(v.name).replace(/'/g, "\\'") + '\')" title="Inspect">🔍</button>';
        html += '<button class="btn-docker-action btn-docker-danger" onclick="removeDockerVolume(\'' + escapeHtml(v.name).replace(/'/g, "\\'") + '\')" title="Remove">✕</button>';
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div>';

    // Volume inspect
    if (dockerVolumeInspect) {
        html += '<div class="docker-inspect-overlay" onclick="dockerVolumeInspect=null;renderDocker()">';
        html += '<div class="docker-inspect-panel" onclick="event.stopPropagation()" style="max-width:500px">';
        html += '<div class="docker-inspect-header"><span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">VOLUME INSPECT</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="dockerVolumeInspect=null;renderDocker()">✕</button></div>';
        html += '<div class="docker-inspect-body">';
        html += '<pre style="font-family:var(--font-mono);font-size:10px;color:var(--c-text);white-space:pre-wrap;margin:0">' + escapeHtml(JSON.stringify(dockerVolumeInspect, null, 2)) + '</pre>';
        html += '</div></div></div>';
    }

    // Create dialog
    if (dockerCreateVolumeOpen) {
        html += '<div class="docker-inspect-overlay" onclick="dockerCreateVolumeOpen=false;renderDocker()">';
        html += '<div class="docker-inspect-panel" onclick="event.stopPropagation()" style="max-width:400px">';
        html += '<div class="docker-inspect-header"><span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">CREATE VOLUME</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="dockerCreateVolumeOpen=false;renderDocker()">✕</button></div>';
        html += '<div class="docker-inspect-body">';
        html += '<div class="docker-create-row"><label>Name</label><input type="text" id="dockerVolNameInput" spellcheck="false"></div>';
        html += '<div class="docker-create-row"><label>Driver</label><input type="text" id="dockerVolDriverInput" placeholder="local" spellcheck="false"></div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">';
        html += '<button class="btn btn-editor btn-editor-save" onclick="createDockerVolume()">CREATE</button>';
        html += '</div></div></div></div>';
    }

    return html;
}

async function inspectDockerVolume(volumeName) {
    try {
        const res = await fetch('/api/docker/volumes/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, volumeName })
        });
        const data = await res.json();
        if (data.success) { dockerVolumeInspect = data.inspect; renderDocker(); }
    } catch (err) { addLog('Inspect error: ' + err.message, 'error'); }
}

async function createDockerVolume() {
    const nameEl = document.getElementById('dockerVolNameInput');
    const driverEl = document.getElementById('dockerVolDriverInput');
    if (!nameEl || !nameEl.value.trim()) return;
    try {
        const res = await fetch('/api/docker/volumes/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, name: nameEl.value.trim(), driver: driverEl ? driverEl.value.trim() : '' })
        });
        const data = await res.json();
        if (data.success) { addLog('Volume created: ' + nameEl.value.trim(), 'success'); dockerCreateVolumeOpen = false; fetchDockerVolumes(); }
        else addLog('Create failed: ' + data.error, 'error');
    } catch (err) { addLog('Create error: ' + err.message, 'error'); }
}

async function removeDockerVolume(volumeName) {
    if (!confirm('Remove volume ' + volumeName + '?')) return;
    try {
        const res = await fetch('/api/docker/volumes/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, volumeName })
        });
        const data = await res.json();
        if (data.success) { addLog('Volume removed: ' + volumeName, 'success'); fetchDockerVolumes(); }
        else addLog('Remove failed: ' + data.error, 'error');
    } catch (err) { addLog('Remove error: ' + err.message, 'error'); }
}

// ─── DOCKER NETWORKS ───

async function fetchDockerNetworks() {
    if (!isConnected()) return;
    try {
        const res = await fetch('/api/docker/networks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            dockerNetworks = data.networks;
            renderDocker();
        }
    } catch (err) {
        addLog('Networks error: ' + err.message, 'error');
    }
}

function renderDockerNetworks() {
    if (!dockerNetworks) return '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading networks...</div></div>';

    let html = '<div class="docker-toolbar">';
    html += '<span class="docker-count">' + dockerNetworks.length + ' networks</span>';
    html += '<button class="btn-refresh-resources" onclick="fetchDockerNetworks()">REFRESH</button>';
    html += '<button class="btn-refresh-resources" onclick="dockerCreateNetworkOpen=true;renderDocker()">CREATE NETWORK</button>';
    html += '</div>';

    html += '<div class="docker-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th>ID</th><th>Name</th><th>Driver</th><th>Scope</th><th>Actions</th>';
    html += '</tr></thead><tbody>';
    for (const n of dockerNetworks) {
        const isDefault = ['bridge', 'host', 'none'].includes(n.name);
        html += '<tr>';
        html += '<td style="font-size:10px;color:var(--c-text-dim)">' + escapeHtml(n.id.substring(0, 12)) + '</td>';
        html += '<td><strong>' + escapeHtml(n.name) + '</strong>' + (isDefault ? ' <span style="font-size:8px;color:var(--c-text-dim)">(default)</span>' : '') + '</td>';
        html += '<td>' + escapeHtml(n.driver) + '</td>';
        html += '<td>' + escapeHtml(n.scope) + '</td>';
        html += '<td><div class="docker-actions">';
        html += '<button class="btn-docker-action" onclick="inspectDockerNetwork(\'' + escapeHtml(n.id) + '\')" title="Inspect">🔍</button>';
        if (!isDefault) {
            html += '<button class="btn-docker-action btn-docker-danger" onclick="removeDockerNetwork(\'' + escapeHtml(n.id) + '\')" title="Remove">✕</button>';
        }
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div>';

    // Network inspect
    if (dockerNetworkInspect) {
        html += '<div class="docker-inspect-overlay" onclick="dockerNetworkInspect=null;renderDocker()">';
        html += '<div class="docker-inspect-panel" onclick="event.stopPropagation()" style="max-width:600px">';
        html += '<div class="docker-inspect-header"><span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">NETWORK: ' + escapeHtml(dockerNetworkInspect.Name || '') + '</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="dockerNetworkInspect=null;renderDocker()">✕</button></div>';
        html += '<div class="docker-inspect-body">';
        html += '<table class="docker-kv-table">';
        html += '<tr><td>Driver</td><td>' + escapeHtml(dockerNetworkInspect.Driver || '') + '</td></tr>';
        html += '<tr><td>Scope</td><td>' + escapeHtml(dockerNetworkInspect.Scope || '') + '</td></tr>';
        html += '<tr><td>Internal</td><td>' + (dockerNetworkInspect.Internal ? 'Yes' : 'No') + '</td></tr>';
        if (dockerNetworkInspect.IPAM && dockerNetworkInspect.IPAM.Config) {
            for (const cfg of dockerNetworkInspect.IPAM.Config) {
                html += '<tr><td>Subnet</td><td>' + escapeHtml(cfg.Subnet || '') + '</td></tr>';
                if (cfg.Gateway) html += '<tr><td>Gateway</td><td>' + escapeHtml(cfg.Gateway) + '</td></tr>';
            }
        }
        html += '</table>';
        const containers = dockerNetworkInspect.Containers || {};
        const containerKeys = Object.keys(containers);
        if (containerKeys.length > 0) {
            html += '<h4 style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--c-accent);margin:12px 0 8px 0">CONNECTED CONTAINERS (' + containerKeys.length + ')</h4>';
            html += '<table class="process-table"><thead><tr><th>Name</th><th>IPv4</th><th>MAC</th><th>Actions</th></tr></thead><tbody>';
            for (const cid of containerKeys) {
                const c = containers[cid];
                html += '<tr><td>' + escapeHtml(c.Name) + '</td><td>' + escapeHtml(c.IPv4Address) + '</td><td style="font-size:10px">' + escapeHtml(c.MacAddress) + '</td>';
                html += '<td><button class="btn-docker-action btn-docker-danger" onclick="disconnectDockerNetwork(\'' + escapeHtml(dockerNetworkInspect.Id) + '\',\'' + escapeHtml(cid) + '\')">Disconnect</button></td></tr>';
            }
            html += '</tbody></table>';
        }
        // Connect container form
        html += '<div style="margin-top:12px;display:flex;gap:8px;align-items:center">';
        html += '<input type="text" id="dockerNetConnectInput" class="docker-search" placeholder="Container ID or name" style="width:200px">';
        html += '<button class="btn-refresh-resources" onclick="connectDockerNetwork(\'' + escapeHtml(dockerNetworkInspect.Id) + '\')">Connect</button>';
        html += '</div>';
        html += '</div></div></div>';
    }

    // Create dialog
    if (dockerCreateNetworkOpen) {
        html += '<div class="docker-inspect-overlay" onclick="dockerCreateNetworkOpen=false;renderDocker()">';
        html += '<div class="docker-inspect-panel" onclick="event.stopPropagation()" style="max-width:400px">';
        html += '<div class="docker-inspect-header"><span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--c-accent)">CREATE NETWORK</span>';
        html += '<button class="btn btn-editor btn-editor-close" onclick="dockerCreateNetworkOpen=false;renderDocker()">✕</button></div>';
        html += '<div class="docker-inspect-body">';
        html += '<div class="docker-create-row"><label>Name</label><input type="text" id="dockerNetNameInput" spellcheck="false"></div>';
        html += '<div class="docker-create-row"><label>Driver</label><select id="dockerNetDriverInput"><option value="bridge">bridge</option><option value="overlay">overlay</option><option value="macvlan">macvlan</option><option value="host">host</option></select></div>';
        html += '<div class="docker-create-row"><label>Subnet</label><input type="text" id="dockerNetSubnetInput" placeholder="172.20.0.0/16 (optional)" spellcheck="false"></div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">';
        html += '<button class="btn btn-editor btn-editor-save" onclick="createDockerNetwork()">CREATE</button>';
        html += '</div></div></div></div>';
    }

    return html;
}

async function inspectDockerNetwork(networkId) {
    try {
        const res = await fetch('/api/docker/networks/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, networkId })
        });
        const data = await res.json();
        if (data.success) { dockerNetworkInspect = data.inspect; renderDocker(); }
    } catch (err) { addLog('Inspect error: ' + err.message, 'error'); }
}

async function createDockerNetwork() {
    const nameEl = document.getElementById('dockerNetNameInput');
    const driverEl = document.getElementById('dockerNetDriverInput');
    const subnetEl = document.getElementById('dockerNetSubnetInput');
    if (!nameEl || !nameEl.value.trim()) return;
    try {
        const res = await fetch('/api/docker/networks/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, name: nameEl.value.trim(), driver: driverEl ? driverEl.value : '', subnet: subnetEl ? subnetEl.value.trim() : '' })
        });
        const data = await res.json();
        if (data.success) { addLog('Network created: ' + nameEl.value.trim(), 'success'); dockerCreateNetworkOpen = false; fetchDockerNetworks(); }
        else addLog('Create failed: ' + data.error, 'error');
    } catch (err) { addLog('Create error: ' + err.message, 'error'); }
}

async function removeDockerNetwork(networkId) {
    if (!confirm('Remove network ' + networkId + '?')) return;
    try {
        const res = await fetch('/api/docker/networks/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, networkId })
        });
        const data = await res.json();
        if (data.success) { addLog('Network removed', 'success'); fetchDockerNetworks(); }
        else addLog('Remove failed: ' + data.error, 'error');
    } catch (err) { addLog('Remove error: ' + err.message, 'error'); }
}

async function connectDockerNetwork(networkId) {
    const input = document.getElementById('dockerNetConnectInput');
    if (!input || !input.value.trim()) return;
    try {
        const res = await fetch('/api/docker/networks/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, networkId, containerId: input.value.trim() })
        });
        const data = await res.json();
        if (data.success) { addLog('Container connected to network', 'success'); inspectDockerNetwork(networkId); }
        else addLog('Connect failed: ' + data.error, 'error');
    } catch (err) { addLog('Connect error: ' + err.message, 'error'); }
}

async function disconnectDockerNetwork(networkId, containerId) {
    if (!confirm('Disconnect container from network?')) return;
    try {
        const res = await fetch('/api/docker/networks/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, networkId, containerId })
        });
        const data = await res.json();
        if (data.success) { addLog('Container disconnected', 'success'); inspectDockerNetwork(networkId); }
        else addLog('Disconnect failed: ' + data.error, 'error');
    } catch (err) { addLog('Disconnect error: ' + err.message, 'error'); }
}

// ─── THEMES & FONT SIZE ───
function setTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);

    // Update active button
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === themeName);
    });

    // Update xterm theme if terminal exists
    if (term) {
        const xtermTheme = XTERM_THEMES[themeName] || XTERM_THEMES.daylight;
        term.options.theme = xtermTheme;
    }

    // Persist
    localStorage.setItem('ec2ops-theme', themeName);
}

function changeFontSize(delta) {
    currentFontSize = Math.min(20, Math.max(9, currentFontSize + delta));
    document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
    document.getElementById('fontSizeLabel').textContent = currentFontSize;

    // Update xterm font size
    if (term) {
        term.options.fontSize = currentFontSize;
        if (fitAddon) fitAddon.fit();
    }

    // Update logs font
    const logsScroll = document.getElementById('logsContainer');
    if (logsScroll) logsScroll.style.fontSize = currentFontSize + 'px';

    // Persist
    localStorage.setItem('ec2ops-fontsize', currentFontSize);
}

function changeFont(fontValue) {
    currentFont = fontValue;
    document.documentElement.style.setProperty('--c-font', fontValue);

    // Update xterm font family (use first font in the list)
    if (term) {
        const primaryFont = fontValue.split(',')[0].replace(/'/g, '').trim();
        term.options.fontFamily = fontValue;
        if (fitAddon) fitAddon.fit();
    }

    // Update logs font
    const logsScroll = document.getElementById('logsContainer');
    if (logsScroll) logsScroll.style.fontFamily = fontValue;

    // Persist
    localStorage.setItem('ec2ops-font', fontValue);
}

// ─── FULLSCREEN ───
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

function loadPreferences() {
    // Load theme (default: daylight)
    const savedTheme = localStorage.getItem('ec2ops-theme') || 'daylight';
    setTheme(savedTheme);

    // Load font size
    const savedSize = localStorage.getItem('ec2ops-fontsize');
    if (savedSize) {
        currentFontSize = parseInt(savedSize, 10);
        document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
        document.getElementById('fontSizeLabel').textContent = currentFontSize;

        const logsScroll = document.getElementById('logsContainer');
        if (logsScroll) logsScroll.style.fontSize = currentFontSize + 'px';
    }

    // Load font family
    const savedFont = localStorage.getItem('ec2ops-font');
    if (savedFont) {
        currentFont = savedFont;
        document.documentElement.style.setProperty('--c-font', savedFont);
        const fontSelect = document.getElementById('fontFamily');
        if (fontSelect) {
            // Match saved value to dropdown option
            for (let i = 0; i < fontSelect.options.length; i++) {
                if (fontSelect.options[i].value === savedFont) {
                    fontSelect.selectedIndex = i;
                    break;
                }
            }
        }
        const logsScroll = document.getElementById('logsContainer');
        if (logsScroll) logsScroll.style.fontFamily = savedFont;
    }
}

// ─── AUTH ───
async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    appInitialized = false;
    if (termConnected) disconnectSSH();
    if (ws) ws.close();
    ws = null;
    clientId = null;
    window.location.href = '/login.html';
}

// 401 fetch interceptor — redirect to login on expired/invalid token
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await _originalFetch.apply(this, args);
    if (response.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (!url.includes('/api/auth/')) {
            appInitialized = false;
            window.location.href = '/login.html';
        }
    }
    return response;
};

// ─── SESSION HISTORY (SQLite via server API) ───

async function fetchSessions() {
    try {
        const res = await fetch('/api/sessions');
        return await res.json();
    } catch (err) {
        console.error('Failed to fetch sessions:', err);
        return { sessions: [], grouped: {} };
    }
}

async function saveCurrentSession() {
    const host = document.getElementById('ec2Host').value.trim();
    if (!host) {
        addLog('Cannot save: host is required', 'warning');
        return;
    }

    const mode = document.getElementById('opMode').value;
    const username = mode === 'root-login'
        ? 'root'
        : document.getElementById('username').value;
    const auth_method = mode === 'root-login' ? 'password' : 'pem';

    // Prompt for session name
    const defaultName = `${username}@${host}`;
    const sessionName = prompt('Session name:', defaultName);
    if (sessionName === null) return; // User cancelled

    try {
        const res = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                host, username, mode, auth_method,
                pem_filename: originalPemFilename || null,
                pem_content: uploadedPemContent || null,
                status: 'saved',
                name: sessionName || defaultName
            })
        });
        const result = await res.json();
        if (result.success) {
            addLog(`Session saved: ${sessionName || defaultName}`, 'success');
            const btn = document.getElementById('saveSessionBtn');
            if (btn) { btn.classList.add('saved'); setTimeout(() => btn.classList.remove('saved'), 600); }
            await renderSessionHistory();
        } else {
            addLog(`Save failed: ${result.error}`, 'error');
        }
    } catch (err) {
        addLog(`Save failed: ${err.message}`, 'error');
    }
}

async function saveSession(sessionData) {
    try {
        if (!sessionData.auth_method) {
            sessionData.auth_method = sessionData.mode === 'root-login' ? 'password' : 'pem';
        }
        sessionData.pem_filename = originalPemFilename || null;
        sessionData.pem_content = uploadedPemContent || null;

        await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionData)
        });
        await renderSessionHistory();
    } catch (err) {
        console.error('Auto-save session failed:', err);
    }
}

async function clearSessionHistory() {
    try {
        await fetch('/api/sessions/all', { method: 'DELETE' });
        await renderSessionHistory();
        toggleSessionHistory();
    } catch (err) {
        addLog(`Clear failed: ${err.message}`, 'error');
    }
}

async function deleteSession(id, event) {
    event.stopPropagation();
    try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        await renderSessionHistory();
    } catch (err) {
        addLog(`Delete failed: ${err.message}`, 'error');
    }
}

async function renderSessionHistory() {
    const list = document.getElementById('sessionHistoryList');
    if (!list) return;

    const data = await fetchSessions();
    const grouped = data.grouped;
    const hosts = Object.keys(grouped);

    if (hosts.length === 0) {
        list.innerHTML = '<div class="session-empty">No saved sessions</div>';
        return;
    }

    let html = '';
    for (const host of hosts) {
        html += `<div class="session-group">`;
        html += `<div class="session-group-header">${escapeHtml(host)}</div>`;

        for (const s of grouped[host]) {
            const time = new Date(s.timestamp);
            const timeStr = time.toLocaleDateString() + ' ' +
                time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const statusClass = s.status === 'failure' ? 'session-failure' : 'session-success';
            const statusDot = s.status === 'failure' ? '&#x2717;' : '&#x2713;';
            const modeLabel = {
                'ssh-login': 'SSH', 'set-root-password': 'SET PWD', 'root-login': 'ROOT'
            }[s.mode] || s.mode;
            const authLabel = s.auth_method === 'pem' ? 'PEM' : 'PWD';
            const pemInfo = s.pem_filename ? ` &middot; ${escapeHtml(s.pem_filename)}` : '';
            const nameDisplay = s.name ? escapeHtml(s.name) : `${escapeHtml(s.username)}@`;

            html += `<div class="session-item" onclick="applySession(${s.id})">
                <div class="session-item-top">
                    <span class="session-name">${nameDisplay}</span>
                    <span class="session-auth-badge">${authLabel}</span>
                    <span class="session-status ${statusClass}">${statusDot}</span>
                    <button type="button" class="session-delete-btn" onclick="deleteSession(${s.id}, event)" title="Delete">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="session-item-bottom">
                    <span class="session-mode">${modeLabel}</span>
                    <span class="session-user">${escapeHtml(s.username)}@</span>
                    <span class="session-pem-info">${pemInfo}</span>
                    <span class="session-time">${timeStr}</span>
                </div>
            </div>`;
        }

        html += `</div>`;
    }

    list.innerHTML = html;
}

async function applySession(id) {
    const data = await fetchSessions();
    const session = data.sessions.find(s => s.id === id);
    if (!session) return;

    document.getElementById('ec2Host').value = session.host;
    document.getElementById('opMode').value = session.mode;
    switchMode(session.mode);

    if (session.mode === 'ssh-login' || session.mode === 'set-root-password') {
        const usernameSelect = document.getElementById('username');
        for (let i = 0; i < usernameSelect.options.length; i++) {
            if (usernameSelect.options[i].value === session.username) {
                usernameSelect.selectedIndex = i;
                break;
            }
        }
    }

    toggleSessionHistory();
    const pemNote = session.pem_filename ? `, key: ${session.pem_filename}` : '';
    addLog(`Loaded session: ${session.username}@${session.host} (${session.mode}${pemNote})`, 'system');
}

function toggleSessionHistory() {
    const dropdown = document.getElementById('sessionHistoryDropdown');
    dropdown.classList.toggle('visible');

    if (dropdown.classList.contains('visible')) {
        setTimeout(() => {
            document.addEventListener('click', closeSessionHistoryOnClickOutside);
        }, 0);
    } else {
        document.removeEventListener('click', closeSessionHistoryOnClickOutside);
    }
}

function closeSessionHistoryOnClickOutside(e) {
    const dropdown = document.getElementById('sessionHistoryDropdown');
    const toggle = document.getElementById('historyToggle');
    if (!dropdown.contains(e.target) && !toggle.contains(e.target)) {
        dropdown.classList.remove('visible');
        document.removeEventListener('click', closeSessionHistoryOnClickOutside);
    }
}

// ─── LOAD SESSION FROM URL (chooser redirect) ───
async function loadSessionFromUrl(sessionId) {
    try {
        const data = await fetchSessions();
        const session = data.sessions.find(s => s.id === parseInt(sessionId, 10));
        if (!session) {
            addLog(`Session #${sessionId} not found`, 'warning');
            return;
        }

        // Populate form fields
        document.getElementById('ec2Host').value = session.host;
        document.getElementById('opMode').value = session.mode;
        switchMode(session.mode);

        if (session.mode === 'ssh-login' || session.mode === 'set-root-password') {
            const usernameSelect = document.getElementById('username');
            for (let i = 0; i < usernameSelect.options.length; i++) {
                if (usernameSelect.options[i].value === session.username) {
                    usernameSelect.selectedIndex = i;
                    break;
                }
            }
        }

        // Restore PEM key if session has one
        if (session.has_pem) {
            try {
                const pemRes = await fetch(`/api/sessions/${session.id}/pem`);
                const pemData = await pemRes.json();
                if (pemData.success) {
                    uploadedPemPath = pemData.path;
                    originalPemFilename = pemData.filename;
                    const pemBtn = document.getElementById('pemBtn');
                    const pemLabel = document.getElementById('pemLabel');
                    if (pemBtn) pemBtn.classList.add('uploaded');
                    if (pemLabel) {
                        const name = pemData.filename.length > 12 ? pemData.filename.slice(0, 10) + '..' : pemData.filename;
                        pemLabel.textContent = name;
                    }
                    addLog(`PEM key restored: ${pemData.filename}`, 'success');
                }
            } catch (err) {
                addLog(`PEM restore failed: ${err.message}`, 'warning');
            }
        }

        const pemNote = session.pem_filename ? `, key: ${session.pem_filename}` : '';
        addLog(`Loaded saved session: ${session.username}@${session.host} (${session.mode}${pemNote})`, 'system');

        // Auto-connect for SSH modes
        if (session.mode === 'ssh-login' || session.mode === 'root-login') {
            addLog('Auto-connecting...', 'info', true);
            setTimeout(() => loginToEC2(), 500);
        }

        // Clean URL
        history.replaceState(null, '', '/');
    } catch (err) {
        addLog(`Failed to load session: ${err.message}`, 'error');
    }
}

// ─── APP INIT ───
function initApp() {
    if (appInitialized) return;
    appInitialized = true;

    initWebSocket();
    switchMode(document.getElementById('opMode').value);

    // Mode dropdown
    document.getElementById('opMode').addEventListener('change', (e) => {
        switchMode(e.target.value);
    });

    // Form submit
    document.getElementById('setupForm').addEventListener('submit', handleDeploy);

    // PEM key upload
    document.getElementById('pemKey').addEventListener('change', handlePemUpload);

    // Login button (SSH connect)
    document.getElementById('loginBtn').addEventListener('click', loginToEC2);

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => setTheme(btn.dataset.theme));
    });

    // Render session history
    renderSessionHistory();

    // Check for session auto-load from chooser
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (sessionId) {
        loadSessionFromUrl(sessionId);
    }
}

// ─── PACKAGE MANAGEMENT ───
async function fetchPackageList() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('packageDashboard');
    dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Loading installed packages...</div></div>';
    try {
        const res = await fetch('/api/packages/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            packageData = data.packages;
            renderPackages();
            const statusEl = document.getElementById('packageStatus');
            if (statusEl) statusEl.classList.add('loaded');
        } else {
            dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Error: ' + escapeHtml(data.error) + '</p></div>';
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function renderPackages() {
    if (!packageData) return;
    const dashboard = document.getElementById('packageDashboard');

    let html = '<div class="package-toolbar">';
    html += '<div class="package-toolbar-left">';
    html += '<input type="text" class="package-search" placeholder="Filter installed..." oninput="packageFilter=this.value;renderPackages()" value="' + escapeHtml(packageFilter) + '" spellcheck="false">';
    html += '<span class="package-count">' + packageData.length + ' packages</span>';
    html += '</div>';
    html += '<div class="package-toolbar-right">';
    html += '<button class="btn-refresh-resources" onclick="fetchPackageList()">REFRESH</button>';
    html += '</div></div>';

    // Quick install bar
    html += '<div class="package-quick-bar">';
    html += '<span class="package-quick-label">QUICK INSTALL:</span>';
    const popular = ['htop','curl','wget','git','vim','net-tools','jq','tree','tmux','nmap'];
    for (const pkg of popular) {
        html += '<button class="package-quick-btn" onclick="installPackage(\'' + pkg + '\')">' + pkg + '</button>';
    }
    html += '</div>';

    // Search available
    html += '<div class="package-search-bar">';
    html += '<input type="text" id="packageSearchInput" class="package-search" placeholder="Search available packages..." spellcheck="false">';
    html += '<button class="btn-small" onclick="searchPackages()">SEARCH</button>';
    html += '</div>';

    // Search results
    if (packageSearchResults && packageSearchResults.length > 0) {
        html += '<div class="package-search-results">';
        html += '<div class="resource-section-title">SEARCH RESULTS</div>';
        for (const r of packageSearchResults.slice(0, 20)) {
            html += '<div class="package-search-row">';
            html += '<span class="package-name">' + escapeHtml(r.name) + '</span>';
            html += '<span class="package-desc">' + escapeHtml(r.description || '') + '</span>';
            html += '<button class="package-quick-btn" onclick="installPackage(\'' + escapeHtml(r.name) + '\')">INSTALL</button>';
            html += '</div>';
        }
        html += '</div>';
    }

    // Package install log area
    if (packageInstalling) {
        html += '<div class="package-install-log" id="packageInstallLog"><div class="resources-loading"><div class="flower-icon spinning">✻</div><div class="resources-loading-text">Installing...</div></div></div>';
    }

    // Installed packages table
    let filtered = packageData;
    if (packageFilter) {
        const q = packageFilter.toLowerCase();
        filtered = packageData.filter(p => p.name.toLowerCase().includes(q));
    }

    html += '<div class="process-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th>PACKAGE</th><th>VERSION</th><th>STATUS</th><th>ACTION</th>';
    html += '</tr></thead><tbody>';
    for (const pkg of filtered.slice(0, 200)) {
        html += '<tr>';
        html += '<td>' + escapeHtml(pkg.name) + '</td>';
        html += '<td style="color:var(--c-text-dim)">' + escapeHtml(pkg.version) + '</td>';
        html += '<td><span class="port-label">' + escapeHtml(pkg.status) + '</span></td>';
        html += '<td><button class="btn-kill" onclick="uninstallPackage(\'' + escapeHtml(pkg.name) + '\')" title="Uninstall">✕</button></td>';
        html += '</tr>';
    }
    if (filtered.length > 200) {
        html += '<tr><td colspan="4" style="color:var(--c-text-dim);text-align:center">...and ' + (filtered.length - 200) + ' more</td></tr>';
    }
    html += '</tbody></table></div>';

    dashboard.innerHTML = html;
}

async function searchPackages() {
    const query = document.getElementById('packageSearchInput').value.trim();
    if (!query) return;
    try {
        const res = await fetch('/api/packages/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, query })
        });
        const data = await res.json();
        if (data.success) {
            packageSearchResults = data.results;
            renderPackages();
        }
    } catch (err) {
        addLog('Search error: ' + err.message, 'error');
    }
}

async function installPackage(name) {
    if (packageInstalling) return;
    packageInstalling = true;
    addLog('Installing package: ' + name, 'info');
    renderPackages();
    try {
        const res = await fetch('/api/packages/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, packageName: name })
        });
        const data = await res.json();
        if (!data.success) {
            addLog('Install failed: ' + (data.error || ''), 'error');
            packageInstalling = false;
            renderPackages();
        }
    } catch (err) {
        addLog('Install error: ' + err.message, 'error');
        packageInstalling = false;
        renderPackages();
    }
}

function handlePackageInstallProgress(data) {
    if (data.data) {
        const logArea = document.getElementById('packageInstallLog');
        if (logArea) {
            logArea.innerHTML = '<pre class="package-install-output">' + escapeHtml(data.data) + '</pre>';
        }
    }
    if (data.done) {
        packageInstalling = false;
        addLog('Package ' + (data.packageName || '') + ' ' + (data.success ? 'installed successfully' : 'install failed'), data.success ? 'success' : 'error');
        fetchPackageList();
    }
}

async function uninstallPackage(name) {
    if (!confirm('Uninstall ' + name + '?')) return;
    try {
        const res = await fetch('/api/packages/uninstall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, packageName: name })
        });
        const data = await res.json();
        addLog('Package ' + name + ' ' + (data.success ? 'removed' : 'removal failed'), data.success ? 'success' : 'error');
        if (data.success) fetchPackageList();
    } catch (err) {
        addLog('Uninstall error: ' + err.message, 'error');
    }
}

// ─── DOCKER INSTALL ───
async function installDocker() {
    const btn = document.getElementById('dockerInstallBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'INSTALLING...'; }
    addLog('Starting Docker installation...', 'info');
    try {
        await fetch('/api/docker/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
    } catch (err) {
        addLog('Docker install error: ' + err.message, 'error');
    }
}

// ─── SECURITY HARDENING ───
async function fetchSecurityStatus() {
    if (!isConnected()) return;
    const dashboard = document.getElementById('securityDashboard');
    dashboard.innerHTML = '<div class="resources-loading"><div class="flower-icon">✻</div><div class="resources-loading-text">Gathering security status...</div></div>';
    try {
        const res = await fetch('/api/security/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success) {
            securityData = data.security;
            renderSecurity();
            const statusEl = document.getElementById('securityStatus');
            if (statusEl) statusEl.classList.add('loaded');
        } else {
            dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Error: ' + escapeHtml(data.error) + '</p></div>';
        }
    } catch (err) {
        dashboard.innerHTML = '<div class="resources-placeholder"><div class="flower-icon idle">✻</div><p>Error: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function renderSecurity() {
    if (!securityData) return;
    const s = securityData;
    const dashboard = document.getElementById('securityDashboard');

    let html = '<div class="security-header">';
    html += '<span class="resource-section-title" style="margin:0">SECURITY STATUS</span>';
    html += '<button class="btn-refresh-resources" onclick="fetchSecurityStatus()">REFRESH</button>';
    html += '</div>';

    // Status cards
    html += '<div class="security-grid">';

    // Firewall card
    const fwOk = s.firewallStatus === 'active';
    html += '<div class="security-card ' + (fwOk ? 'security-card-ok' : 'security-card-warn') + '">';
    html += '<div class="security-card-icon">' + (fwOk ? '&#x2714;' : '&#x26A0;') + '</div>';
    html += '<div class="security-card-title">FIREWALL</div>';
    html += '<div class="security-card-value">' + escapeHtml(s.firewallStatus) + '</div>';
    if (!fwOk) html += '<button class="btn-small" onclick="enableFirewall()" ' + (securityInstalling ? 'disabled' : '') + '>ENABLE</button>';
    html += '</div>';

    // Fail2ban card
    html += '<div class="security-card ' + (s.fail2banInstalled ? 'security-card-ok' : 'security-card-warn') + '">';
    html += '<div class="security-card-icon">' + (s.fail2banInstalled ? '&#x2714;' : '&#x26A0;') + '</div>';
    html += '<div class="security-card-title">FAIL2BAN</div>';
    html += '<div class="security-card-value">' + (s.fail2banInstalled ? 'installed' : 'not installed') + '</div>';
    if (!s.fail2banInstalled) html += '<button class="btn-small" onclick="installFail2ban()" ' + (securityInstalling ? 'disabled' : '') + '>INSTALL</button>';
    html += '</div>';

    // SSH Port card
    const sshPort = s.sshConfig.Port || '22';
    html += '<div class="security-card">';
    html += '<div class="security-card-title">SSH PORT</div>';
    html += '<div class="security-card-value">' + escapeHtml(sshPort) + '</div>';
    html += '<div class="system-setting-row" style="margin-top:6px">';
    html += '<input type="number" id="newSSHPort" class="system-setting-input" value="' + escapeHtml(sshPort) + '" min="1024" max="65535" style="width:80px">';
    html += '<button class="btn-small" onclick="changeSSHPort()">CHANGE</button>';
    html += '</div></div>';

    // Root login card
    const rootLogin = s.sshConfig.PermitRootLogin || 'unknown';
    const rootOk = rootLogin === 'no';
    html += '<div class="security-card ' + (rootOk ? 'security-card-ok' : '') + '">';
    html += '<div class="security-card-title">ROOT LOGIN</div>';
    html += '<div class="security-card-value">' + escapeHtml(rootLogin) + '</div>';
    if (!rootOk) html += '<button class="btn-small" onclick="disableRootLogin()">DISABLE</button>';
    html += '</div>';

    // Password auth card
    const pwdAuth = s.sshConfig.PasswordAuthentication || 'unknown';
    html += '<div class="security-card">';
    html += '<div class="security-card-title">PASSWORD AUTH</div>';
    html += '<div class="security-card-value">' + escapeHtml(pwdAuth) + '</div>';
    html += '</div>';

    html += '</div>';

    // Firewall rule adder
    html += '<div class="security-firewall-section">';
    html += '<div class="resource-section-title">FIREWALL RULES</div>';
    html += '<div class="system-setting-row" style="margin-bottom:8px">';
    html += '<input type="number" id="fwPort" class="system-setting-input" placeholder="Port" min="1" max="65535" style="width:80px">';
    html += '<select id="fwAction" class="system-setting-input" style="width:80px"><option value="allow">Allow</option><option value="deny">Deny</option></select>';
    html += '<button class="btn-small" onclick="addFirewallRule()">ADD RULE</button>';
    html += '</div></div>';

    // Open ports table
    if (s.openPorts && s.openPorts.length > 0) {
        html += '<div class="resource-section-title">OPEN PORTS</div>';
        html += '<div class="process-table-wrap"><table class="process-table"><thead><tr>';
        html += '<th>PROTO</th><th>LOCAL ADDRESS</th><th>PROCESS</th>';
        html += '</tr></thead><tbody>';
        for (const p of s.openPorts) {
            html += '<tr>';
            html += '<td>' + escapeHtml(p.proto) + '</td>';
            html += '<td>' + escapeHtml(p.local) + '</td>';
            html += '<td style="color:var(--c-text-dim)">' + escapeHtml(p.process) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }

    // Failed logins
    if (s.failedLogins && s.failedLogins !== 'none') {
        html += '<div class="resource-section-title">RECENT FAILED LOGINS</div>';
        html += '<pre class="security-failed-logins">' + escapeHtml(s.failedLogins) + '</pre>';
    }

    dashboard.innerHTML = html;
}

async function installFail2ban() {
    securityInstalling = true;
    renderSecurity();
    addLog('Installing fail2ban...', 'info');
    try {
        await fetch('/api/security/fail2ban/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
    } catch (err) {
        addLog('Fail2ban install error: ' + err.message, 'error');
        securityInstalling = false;
    }
}

async function enableFirewall() {
    securityInstalling = true;
    renderSecurity();
    addLog('Enabling firewall...', 'info');
    try {
        await fetch('/api/security/firewall/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
    } catch (err) {
        addLog('Firewall enable error: ' + err.message, 'error');
        securityInstalling = false;
    }
}

async function addFirewallRule() {
    const port = document.getElementById('fwPort').value;
    const action = document.getElementById('fwAction').value;
    if (!port) return;
    try {
        const res = await fetch('/api/security/firewall/rule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, port, action })
        });
        const data = await res.json();
        addLog('Firewall rule: ' + action + ' port ' + port + ' — ' + (data.success ? 'OK' : data.error), data.success ? 'success' : 'error');
        if (data.success) fetchSecurityStatus();
    } catch (err) {
        addLog('Firewall rule error: ' + err.message, 'error');
    }
}

async function changeSSHPort() {
    const port = document.getElementById('newSSHPort').value;
    if (!port || port < 1024 || port > 65535) {
        addLog('SSH port must be 1024-65535', 'error');
        return;
    }
    if (!confirm('Change SSH port to ' + port + '? Make sure this port is open in your security group!')) return;
    try {
        const res = await fetch('/api/security/ssh/port', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, port: parseInt(port) })
        });
        const data = await res.json();
        addLog('SSH port ' + (data.success ? 'changed to ' + port : 'change failed: ' + (data.error || '')), data.success ? 'success' : 'error');
        if (data.success) fetchSecurityStatus();
    } catch (err) {
        addLog('SSH port change error: ' + err.message, 'error');
    }
}

async function disableRootLogin() {
    if (!confirm('Disable root login? Make sure you have another user with sudo access!')) return;
    try {
        const res = await fetch('/api/security/ssh/disable-root', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        addLog('Root login ' + (data.success ? 'disabled' : 'disable failed'), data.success ? 'success' : 'error');
        if (data.success) fetchSecurityStatus();
    } catch (err) {
        addLog('Disable root error: ' + err.message, 'error');
    }
}

// ─── CLOUD-INIT LOG VIEWER ───
async function fetchCloudInitLog() {
    try {
        const res = await fetch('/api/cloud-init/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        if (data.success && data.found) {
            cloudInitContent = data.content;
            cloudInitVisible = true;
            renderCloudInitViewer();
        } else {
            addLog('Cloud-init log not found', 'warning');
        }
    } catch (err) {
        addLog('Cloud-init fetch error: ' + err.message, 'error');
    }
}

function toggleCloudInitViewer() {
    cloudInitVisible = !cloudInitVisible;
    if (cloudInitVisible && !cloudInitContent) {
        fetchCloudInitLog();
    } else {
        renderCloudInitViewer();
    }
}

function renderCloudInitViewer() {
    // Cloud-init viewer overlays in the logs panel
    const container = document.getElementById('logsContainer');
    if (!cloudInitVisible) return;

    let existingViewer = document.getElementById('cloudInitViewer');
    if (!existingViewer) {
        existingViewer = document.createElement('div');
        existingViewer.id = 'cloudInitViewer';
        existingViewer.className = 'cloud-init-overlay';
        container.parentNode.insertBefore(existingViewer, container.nextSibling);
    }

    let html = '<div class="cloud-init-toolbar">';
    html += '<span class="resource-section-title" style="margin:0">CLOUD-INIT LOG</span>';
    html += '<div>';
    if (!cloudInitStreaming) {
        html += '<button class="btn-small" onclick="startCloudInitTail()">TAIL -F</button>';
    } else {
        html += '<button class="btn-small" onclick="stopCloudInitTail()">STOP</button>';
    }
    html += '<button class="btn-small" onclick="fetchCloudInitLog()">RELOAD</button>';
    html += '<button class="btn-small" onclick="cloudInitVisible=false;document.getElementById(\'cloudInitViewer\').remove()">CLOSE</button>';
    html += '</div></div>';
    html += '<pre class="cloud-init-log">' + escapeHtml(cloudInitContent.slice(-10000)) + '</pre>';

    existingViewer.innerHTML = html;
}

function startCloudInitTail() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    cloudInitStreaming = true;
    ws.send(JSON.stringify({ type: 'cloud-init-start', clientId }));
    renderCloudInitViewer();
}

function stopCloudInitTail() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    cloudInitStreaming = false;
    ws.send(JSON.stringify({ type: 'cloud-init-stop', clientId }));
    renderCloudInitViewer();
}

// ─── SSH KEY ROTATION ───
async function generateSSHKey() {
    try {
        const res = await fetch('/api/ssh-keys/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            addLog('SSH key pair generated', 'success');
            const container = document.getElementById('keyRotationResult');
            if (container) {
                let html = '<div class="key-rotation-result">';
                html += '<div class="resource-section-title">GENERATED PUBLIC KEY</div>';
                html += '<pre class="key-display">' + escapeHtml(data.publicKey) + '</pre>';
                html += '<button class="btn-small" onclick="deploySSHKey(\'' + escapeHtml(data.publicKey.replace(/\n/g, '\\n').replace(/'/g, "\\'")) + '\')">DEPLOY TO HOST</button>';
                html += '<a href="/api/ssh-keys/download/' + data.token + '" class="btn-small" download>DOWNLOAD PRIVATE KEY</a>';
                html += '</div>';
                container.innerHTML = html;
            }
        } else {
            addLog('Key generation failed: ' + (data.error || ''), 'error');
        }
    } catch (err) {
        addLog('Key generation error: ' + err.message, 'error');
    }
}

async function deploySSHKey(publicKey) {
    if (!isConnected()) { addLog('Not connected', 'error'); return; }
    const key = publicKey.replace(/\\n/g, '\n');
    try {
        const res = await fetch('/api/ssh-keys/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, publicKey: key })
        });
        const data = await res.json();
        addLog('SSH key ' + (data.success ? 'deployed successfully' : 'deploy failed: ' + (data.error || '')), data.success ? 'success' : 'error');
    } catch (err) {
        addLog('Deploy error: ' + err.message, 'error');
    }
}

// ─── BATCH OPERATIONS ───
async function startBatch() {
    const hostsText = document.getElementById('batchHosts').value.trim();
    const username = document.getElementById('batchUsername').value.trim();
    const password = document.getElementById('batchPassword').value;
    const operation = document.getElementById('batchOperation').value;
    const pemContent = document.getElementById('batchPemContent').value.trim();

    if (!hostsText) { addLog('Enter at least one host', 'error'); return; }
    if (!password) { addLog('Password is required', 'error'); return; }

    const hosts = hostsText.split('\n').map(h => h.trim()).filter(h => h);
    if (hosts.length === 0) { addLog('No valid hosts', 'error'); return; }
    if (hosts.length > 20) { addLog('Maximum 20 hosts per batch', 'error'); return; }

    batchRunning = true;
    batchResults = {};
    hosts.forEach(h => { batchResults[h] = { status: 'pending' }; });
    renderBatchResults();

    const btn = document.getElementById('batchStartBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'RUNNING...'; }

    try {
        const res = await fetch('/api/batch/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hosts, username, password, operation, pemContent, clientId })
        });
        const data = await res.json();
        if (data.success) {
            batchId = data.batchId;
            addLog('Batch started: ' + operation + ' on ' + hosts.length + ' hosts', 'info');
        } else {
            addLog('Batch start failed: ' + (data.error || ''), 'error');
            batchRunning = false;
            if (btn) { btn.disabled = false; btn.textContent = 'START BATCH'; }
        }
    } catch (err) {
        addLog('Batch error: ' + err.message, 'error');
        batchRunning = false;
        if (btn) { btn.disabled = false; btn.textContent = 'START BATCH'; }
    }
}

function handleBatchHostProgress(data) {
    if (!batchResults) batchResults = {};
    batchResults[data.host] = { status: data.status, message: data.message || '' };
    renderBatchResults();
}

function handleBatchComplete(data) {
    batchRunning = false;
    if (data.results) batchResults = data.results;
    renderBatchResults();
    const btn = document.getElementById('batchStartBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'START BATCH'; }

    const succeeded = Object.values(batchResults).filter(r => r.status === 'success').length;
    const failed = Object.values(batchResults).filter(r => r.status === 'failed').length;
    addLog('Batch complete: ' + succeeded + ' succeeded, ' + failed + ' failed', succeeded > 0 ? 'success' : 'error');

    const statusEl = document.getElementById('batchStatus');
    if (statusEl) statusEl.classList.add('loaded');
}

function renderBatchResults() {
    const container = document.getElementById('batchResults');
    if (!container || !batchResults) return;
    const hosts = Object.keys(batchResults);
    if (hosts.length === 0) { container.innerHTML = ''; return; }

    let html = '<div class="resource-section-title" style="margin-top:12px">RESULTS</div>';
    html += '<div class="process-table-wrap"><table class="process-table"><thead><tr>';
    html += '<th>HOST</th><th>STATUS</th><th>MESSAGE</th>';
    html += '</tr></thead><tbody>';

    for (const host of hosts) {
        const r = batchResults[host];
        const statusClass = r.status === 'success' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : r.status === 'running' ? 'badge-blue' : 'badge-dim';
        html += '<tr>';
        html += '<td>' + escapeHtml(host) + '</td>';
        html += '<td><span class="audit-badge ' + statusClass + '">' + escapeHtml(r.status) + '</span></td>';
        html += '<td style="color:var(--c-text-dim);font-size:10px">' + escapeHtml(r.message || (r.logs ? r.logs[0] || '' : '')) + '</td>';
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
    loadPreferences();
    // Clean ?new param from URL
    if (window.location.search.includes('new')) {
        history.replaceState(null, '', window.location.pathname);
    }
    initApp();
});
