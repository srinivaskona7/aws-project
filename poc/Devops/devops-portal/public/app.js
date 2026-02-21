'use strict';

const Portal = (() => {
  let wsConn = null;
  let consoleCollapsed = false;
  let currentUser = null;
  let sshConn = null;
  let xterm = null;
  let fitAddon = null;

  // ===== UTILITIES =====
  function api(method, path, body, stream = false) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(r => {
      if (r.status === 401) { showLogin(); throw new Error('Unauthorized'); }
      if (stream) return r;
      return r.json().then(data => { if (\!r.ok) throw new Error(data.error || 'Request failed'); return data; });
    });
  }

  function toast(msg, type = 'info', duration = 4000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function log(line, type = 'info') {
    const out = document.getElementById('log-output');
    if (\!out) return;
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    const ts = new Date().toTimeString().split(' ')[0];
    div.innerHTML = `<span class="ts">${ts}</span>${escHtml(line)}`;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
    const dot = document.getElementById('log-activity-dot');
    if (dot) { dot.classList.add('active'); clearTimeout(dot._t); dot._t = setTimeout(() => dot.classList.remove('active'), 2000); }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function showOutput(elId, text) {
    const el = document.getElementById(elId);
    if (\!el) return;
    el.classList.add('visible');
    el.textContent = text;
    el.scrollTop = el.scrollHeight;
  }

  function clearOutput(elId) {
    const el = document.getElementById(elId);
    if (el) { el.textContent = ''; el.classList.remove('visible'); }
  }

  async function streamToOutput(response, outputElId) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const el = document.getElementById(outputElId);
    if (el) { el.classList.add('visible'); el.textContent = ''; }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.line) {
              if (el) { el.textContent += payload.line + '\n'; el.scrollTop = el.scrollHeight; }
              const lt = payload.line.includes('[SUCCESS]') ? 'success' : payload.line.includes('[ERROR]') ? 'error' : payload.line.includes('[WARN]') ? 'warn' : payload.line.startsWith('[JOB:') ? 'cmd' : 'info';
              log(payload.line, lt);
            }
            if (payload.done) {
              const msg = payload.exitCode === 0 ? '[DONE] Job completed successfully' : `[DONE] Job exited with code ${payload.exitCode}`;
              if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
              log(msg, payload.exitCode === 0 ? 'done' : 'error');
              toast(payload.exitCode === 0 ? 'Job completed\!' : `Job failed (exit ${payload.exitCode})`, payload.exitCode === 0 ? 'success' : 'error');
            }
          } catch(e) {}
        }
      }
    }
  }

  // ===== AUTH =====
  function showLogin() {
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').classList.remove('visible');
  }

  function showApp(user) {
    currentUser = user;
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    document.getElementById('status-user').textContent = user.username + ' (' + user.role + ')';
    document.getElementById('status-auth').className = 'status-item ok';
    initWebSocket();
    checkCreds();
    updateClock();
    setInterval(updateClock, 1000);
  }

  function updateClock() {
    const el = document.getElementById('status-time');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }

  async function logout() {
    try { await api('POST', '/api/auth/logout'); } catch(e) {}
    showLogin();
    toast('Logged out', 'info');
  }

  // ===== WEBSOCKET =====
  function initWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsConn = new WebSocket(`${proto}//${location.host}/ws`);
    wsConn.onopen = () => { document.getElementById('status-ws').className = 'status-item ok'; log('[WS] Connected to log stream', 'success'); };
    wsConn.onclose = () => { document.getElementById('status-ws').className = 'status-item err'; setTimeout(initWebSocket, 3000); };
    wsConn.onmessage = (e) => { try { const msg = JSON.parse(e.data); if (msg.type === 'log' && msg.data) log(msg.data); } catch(ex) {} };
  }

  // ===== CREDENTIALS =====
  async function saveCreds() {
    const accessKeyId = document.getElementById('creds-key').value.trim();
    const secretAccessKey = document.getElementById('creds-secret').value.trim();
    const region = document.getElementById('creds-region').value;
    if (\!accessKeyId || \!secretAccessKey) return toast('Access Key and Secret Key required', 'error');
    const btn = document.getElementById('creds-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> SAVING...';
    try {
      await api('POST', '/api/credentials', { accessKeyId, secretAccessKey, region });
      toast('AWS credentials saved\!', 'success');
      document.getElementById('status-creds').className = 'status-item ok';
      document.getElementById('status-creds-text').textContent = `AWS: ${accessKeyId.substring(0,8)}**** | ${region}`;
      document.getElementById('status-region').textContent = region;
      log(`[CREDS] AWS credentials configured (${region})`, 'success');
    } catch(err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = 'SAVE CREDS';
  }

  async function clearCreds() {
    try { await api('DELETE', '/api/credentials'); document.getElementById('status-creds').className = 'status-item'; document.getElementById('status-creds-text').textContent = 'No AWS Credentials'; document.getElementById('status-region').textContent = '—'; toast('Credentials cleared', 'info'); } catch(e) { toast(e.message, 'error'); }
  }

  async function checkCreds() {
    try { const d = await api('GET', '/api/credentials/status'); if (d.configured) { document.getElementById('status-creds').className = 'status-item ok'; document.getElementById('status-creds-text').textContent = `AWS: ${d.accessKeyId} | ${d.region}`; document.getElementById('status-region').textContent = d.region; try { document.getElementById('creds-region').value = d.region; } catch(e) {} } } catch(e) {}
  }

  // ===== RESOURCES =====
  async function loadResources() {
    log('[INFO] Loading AWS resources...', 'info');
    try {
      const data = await api('GET', '/api/resources');
      const r = data.resources;
      const ec2 = r.ec2 || [];
      const running = ec2.filter(i => i.state === 'running').length;
      document.getElementById('count-ec2').textContent = `${running}/${ec2.length}`;
      const tbody = document.getElementById('ec2-tbody');
      tbody.innerHTML = ec2.length ? ec2.map(i => `<tr><td>${escHtml(i.name)}</td><td style="color:var(--blue)">${escHtml(i.id)}</td><td>${escHtml(i.type)}</td><td><span class="badge badge-${i.state==='running'?'green':i.state==='stopped'?'red':'yellow'}">${i.state}</span></td><td>${i.publicIp||'—'}</td><td>${i.privateIp||'—'}</td><td>${i.az||'—'}</td><td style="color:var(--text3)">${i.launchTime?new Date(i.launchTime).toLocaleDateString():'—'}</td></tr>`).join('') : '<tr><td colspan="8" style="color:var(--text3);text-align:center">No EC2 instances</td></tr>';
      document.getElementById('count-eks').textContent = (r.eks||[]).length;
      document.getElementById('count-s3').textContent = (r.s3||[]).length;
      document.getElementById('count-asg').textContent = (r.asg||[]).length;
      log(`[INFO] Loaded: ${ec2.length} EC2, ${(r.eks||[]).length} EKS, ${(r.s3||[]).length} S3, ${(r.asg||[]).length} ASG`, 'success');
      toast('Resources refreshed\!', 'success');
    } catch(err) { toast(err.message, 'error'); log(`[ERROR] ${err.message}`, 'error'); }
  }

  // ===== TAB SWITCHING =====
  function switchTab(tabId) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.nav-tab[data-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
    if (tabId === 'templates') templates.load();
    if (tabId === 'audit') audit.load();
  }

  function toggleConsole() {
    consoleCollapsed = \!consoleCollapsed;
    document.getElementById('log-console').classList.toggle('collapsed', consoleCollapsed);
    document.getElementById('log-toggle-text').textContent = consoleCollapsed ? '▲ EXPAND' : '▼ COLLAPSE';
  }

  function clearConsole() { document.getElementById('log-output').innerHTML = ''; }

  // ===== EC2 =====
  const ec2 = {
    async deploy() {
      clearOutput('ec2-output');
      const body = { instanceName: document.getElementById('ec2-name').value, instanceType: document.getElementById('ec2-type').value, amiId: document.getElementById('ec2-ami').value, keyName: document.getElementById('ec2-keypair').value||undefined, vpcId: document.getElementById('ec2-vpc').value||undefined, subnetId: document.getElementById('ec2-subnet').value||undefined, securityGroupIds: document.getElementById('ec2-sgs').value.split(',').map(s=>s.trim()).filter(Boolean), region: document.getElementById('ec2-region').value||undefined, dryRun: document.getElementById('ec2-dryrun').checked };
      log('[EC2] Starting Terraform EC2 deployment...', 'cmd');
      try { const res = await api('POST', '/api/terraform/ec2', body, true); await streamToOutput(res, 'ec2-output'); } catch(err) { showOutput('ec2-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async genTfVpc() {
      clearOutput('ec2-output');
      log('[VPC] Generating VPC with Terraform...', 'cmd');
      try { const res = await api('POST', '/api/terraform/vpc', { vpcName: 'devops-vpc', cidr: '10.0.0.0/16', dryRun: document.getElementById('ec2-dryrun').checked }, true); await streamToOutput(res, 'ec2-output'); } catch(err) { showOutput('ec2-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== EKS =====
  const eks = {
    async deploy() {
      clearOutput('eks-output');
      const body = { clusterName: document.getElementById('eks-name').value, k8sVersion: document.getElementById('eks-version').value, nodeGroupName: document.getElementById('eks-ng-name').value, instanceType: document.getElementById('eks-instance').value, minNodes: parseInt(document.getElementById('eks-min').value), maxNodes: parseInt(document.getElementById('eks-max').value), desiredNodes: parseInt(document.getElementById('eks-desired').value), region: document.getElementById('eks-region').value||undefined, dryRun: document.getElementById('eks-dryrun').checked };
      log('[EKS] Initiating EKS cluster deployment...', 'cmd');
      try { const res = await api('POST', '/api/eks/deploy', body, true); await streamToOutput(res, 'eks-output'); } catch(err) { showOutput('eks-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== ASG =====
  const asg = {
    async deploy() {
      clearOutput('asg-output');
      const body = { asgName: document.getElementById('asg-name').value, amiId: document.getElementById('asg-ami').value, instanceType: document.getElementById('asg-type').value, keyName: document.getElementById('asg-keypair').value||undefined, minSize: parseInt(document.getElementById('asg-min').value), maxSize: parseInt(document.getElementById('asg-max').value), desiredCapacity: parseInt(document.getElementById('asg-desired').value), subnetIds: document.getElementById('asg-subnets').value.split(',').map(s=>s.trim()).filter(Boolean), dryRun: document.getElementById('asg-dryrun').checked };
      log('[ASG] Creating Auto Scaling Group...', 'cmd');
      try { const res = await api('POST', '/api/asg', body, true); await streamToOutput(res, 'asg-output'); } catch(err) { showOutput('asg-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== TERMINAL =====
  const terminal = {
    sshConfig: null,
    toggleAuth() { const m = document.getElementById('ssh-auth-method').value; document.getElementById('ssh-key-group').style.display = m==='key'?'block':'none'; document.getElementById('ssh-pass-group').style.display = m==='password'?'block':'none'; },
    _getConfig() {
      const host = document.getElementById('ssh-host').value.trim();
      const username = document.getElementById('ssh-user').value.trim();
      const port = document.getElementById('ssh-port').value;
      const method = document.getElementById('ssh-auth-method').value;
      if (\!host) { toast('Hostname required', 'error'); return null; }
      const cfg = { host, username, port: parseInt(port) };
      if (method === 'key') { cfg.privateKey = document.getElementById('ssh-key').value; if (\!cfg.privateKey) { toast('PEM key required', 'error'); return null; } }
      else cfg.password = document.getElementById('ssh-pass').value;
      return cfg;
    },
    async testConnection() {
      const body = this._getConfig(); if (\!body) return;
      log('[SSH] Testing connection...', 'cmd');
      try { const data = await api('POST', '/api/terminal/test-connection', body); toast(`Connected to ${body.host}\!`, 'success'); log(`[SSH] ${data.message}`, 'success'); document.getElementById('terminal-status').innerHTML = '<span style="color:var(--green)">✓ Connection test passed</span>'; }
      catch(err) { toast(err.message, 'error'); log(`[SSH] ${err.message}`, 'error'); document.getElementById('terminal-status').innerHTML = `<span style="color:var(--red)">✗ ${err.message}</span>`; }
    },
    async connect() {
      const config = this._getConfig(); if (\!config) return;
      this.sshConfig = config;
      if (\!xterm) {
        xterm = new Terminal({ theme: { background: '#080c0a', foreground: '#c8d8cc', cursor: '#00ff88', selection: '#22402e' }, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, cursorBlink: true, scrollback: 1000 });
        fitAddon = new FitAddon.FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(document.getElementById('terminal-container'));
        fitAddon.fit();
      }
      xterm.clear();
      xterm.writeln(`\x1b[32mConnecting to ${config.host}...\x1b[0m`);
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      sshConn = new WebSocket(`${proto}//${location.host}/ws`);
      sshConn.onopen = () => { sshConn.send(JSON.stringify({ type: 'ssh_connect', ...config })); document.getElementById('ssh-connect-btn').style.display = 'none'; document.getElementById('ssh-disconnect-btn').style.display = 'inline-flex'; document.getElementById('term-title').textContent = `${config.username}@${config.host}`; };
      sshConn.onmessage = (e) => { try { const msg = JSON.parse(e.data); if (msg.type === 'data') xterm.write(msg.data); if (msg.type === 'error') xterm.writeln(`\x1b[31mError: ${msg.message}\x1b[0m`); if (msg.type === 'closed') { xterm.writeln('\x1b[33m[Connection closed]\x1b[0m'); this.disconnect(); } } catch { if (e.data) xterm.write(e.data); } };
      sshConn.onclose = () => { xterm?.writeln('\x1b[33m[Disconnected]\x1b[0m'); this.disconnect(); };
      xterm.onData(data => { if (sshConn?.readyState === WebSocket.OPEN) sshConn.send(JSON.stringify({ type: 'data', data })); });
    },
    disconnect() { if (sshConn) { sshConn.close(); sshConn = null; } document.getElementById('ssh-connect-btn').style.display = 'inline-flex'; document.getElementById('ssh-disconnect-btn').style.display = 'none'; document.getElementById('term-title').textContent = 'Not connected'; },
    async runCmd(cmd) {
      if (\!cmd || \!this.sshConfig) { if (\!this.sshConfig) toast('Connect to SSH first', 'error'); return; }
      clearOutput('cmd-output');
      log(`[SSH] $ ${cmd}`, 'cmd');
      try { const data = await api('POST', '/api/terminal/exec', { ...this.sshConfig, command: cmd }); showOutput('cmd-output', (data.output||'') + (data.stderr?'\n[STDERR]\n'+data.stderr:'')); log(`[SSH] Exit: ${data.exitCode}`, data.exitCode===0?'success':'error'); } catch(err) { showOutput('cmd-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== NGINX =====
  const nginx = {
    toggleSsl() { document.getElementById('nginx-ssl-fields').style.display = document.getElementById('nginx-ssl').checked ? 'block' : 'none'; },
    async generate() {
      const body = { serverName: document.getElementById('nginx-domain').value, proxyPass: document.getElementById('nginx-proxy').value, listenPort: parseInt(document.getElementById('nginx-port').value), sslEnabled: document.getElementById('nginx-ssl').checked, certPath: document.getElementById('nginx-cert')?.value, keyPath: document.getElementById('nginx-key')?.value };
      if (\!body.serverName) return toast('Server name required', 'error');
      try { const data = await api('POST', '/api/nginx/generate', body); showOutput('nginx-output', data.config); toast('Nginx config generated\!', 'success'); } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== DOCKER =====
  const docker = {
    async build() {
      clearOutput('docker-build-output');
      const body = { imageName: document.getElementById('docker-image-name').value, tag: document.getElementById('docker-tag').value, dockerfile: document.getElementById('docker-dockerfile').value };
      if (\!body.imageName) return toast('Image name required', 'error');
      log(`[DOCKER] Building ${body.imageName}:${body.tag}...`, 'cmd');
      try { const res = await api('POST', '/api/docker/build', body, true); await streamToOutput(res, 'docker-build-output'); } catch(err) { showOutput('docker-build-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async run() {
      clearOutput('docker-run-output');
      const ports = document.getElementById('docker-run-ports').value.split(',').map(s=>s.trim()).filter(Boolean);
      const envVars = {}; document.getElementById('docker-run-env').value.split(',').map(s=>s.trim()).filter(Boolean).forEach(p => { const [k,...v] = p.split('='); if(k) envVars[k.trim()]=(v.join('=')).trim(); });
      const body = { image: document.getElementById('docker-run-image').value, name: document.getElementById('docker-run-name').value||undefined, ports, envVars, detach: document.getElementById('docker-run-detach').checked };
      if (\!body.image) return toast('Image required', 'error');
      log(`[DOCKER] Running ${body.image}...`, 'cmd');
      try { const res = await api('POST', '/api/docker/run', body, true); await streamToOutput(res, 'docker-run-output'); } catch(err) { showOutput('docker-run-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async ps() {
      const all = document.getElementById('docker-ps-all').checked;
      try { const data = await api('GET', `/api/docker/ps?all=${all}`); const containers = data.containers||[]; document.getElementById('docker-containers-tbody').innerHTML = containers.length ? containers.map(c=>`<tr><td style="color:var(--blue)">${(c.ID||'').substring(0,12)}</td><td>${escHtml(c.Image||'')}</td><td style="color:var(--text3)">${escHtml((c.Command||'').substring(0,30))}</td><td><span class="badge badge-${(c.Status||'').includes('Up')?'green':'red'}">${escHtml(c.Status||'')}</span></td><td>${escHtml(c.Ports||'')}</td><td>${escHtml(c.Names||'')}</td><td><button class="btn btn-secondary" onclick="Portal.docker.logs('${c.ID}')" style="padding:2px 8px;font-size:10px">LOGS</button></td></tr>`).join('') : '<tr><td colspan="7" style="color:var(--text3);text-align:center">No containers</td></tr>'; } catch(err) { toast(err.message, 'error'); }
    },
    async logs(container) { clearOutput('docker-build-output'); log(`[DOCKER] Fetching logs for ${container}...`, 'cmd'); try { const res = await api('POST', '/api/docker/logs', { container, tail: 200 }, true); await streamToOutput(res, 'docker-build-output'); switchTab('docker'); } catch(err) { toast(err.message, 'error'); } }
  };

  // ===== KUBERNETES =====
  const k8s = {
    async apply() {
      clearOutput('k8s-apply-output');
      const body = { manifest: document.getElementById('k8s-manifest').value, namespace: document.getElementById('k8s-ns').value, dryRun: document.getElementById('k8s-dryrun').checked };
      if (\!body.manifest) return toast('Manifest YAML required', 'error');
      log('[K8S] Applying manifest...', 'cmd');
      try { const res = await api('POST', '/api/k8s/apply', body, true); await streamToOutput(res, 'k8s-apply-output'); } catch(err) { showOutput('k8s-apply-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async get() {
      clearOutput('k8s-get-output');
      const body = { resource: document.getElementById('k8s-resource-type').value, namespace: document.getElementById('k8s-get-ns').value, allNamespaces: document.getElementById('k8s-all-ns').checked };
      log(`[K8S] kubectl get ${body.resource}...`, 'cmd');
      try { const data = await api('POST', '/api/k8s/get', body); showOutput('k8s-get-output', data.output||'No output'); } catch(err) { showOutput('k8s-get-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async quickGet(resource) {
      clearOutput('eks-ops-output');
      log(`[K8S] kubectl get ${resource}`, 'cmd');
      try { const parts = resource.split(' '); const allNs = parts.includes('--all-namespaces'); const data = await api('POST', '/api/k8s/get', { resource: parts[0], allNamespaces: allNs }); showOutput('eks-ops-output', data.output||'No output'); } catch(err) { showOutput('eks-ops-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async scale() {
      clearOutput('k8s-scale-output');
      const body = { name: document.getElementById('k8s-scale-name').value, replicas: parseInt(document.getElementById('k8s-scale-replicas').value), namespace: document.getElementById('k8s-scale-ns').value };
      if (\!body.name) return toast('Deployment name required', 'error');
      try { const data = await api('POST', '/api/k8s/scale', body); showOutput('k8s-scale-output', data.output); toast('Scaling done\!', 'success'); } catch(err) { showOutput('k8s-scale-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async rollout() {
      clearOutput('k8s-scale-output');
      const body = { name: document.getElementById('k8s-rollout-name').value, action: document.getElementById('k8s-rollout-action').value, namespace: 'default' };
      if (\!body.name) return toast('Deployment name required', 'error');
      try { const data = await api('POST', '/api/k8s/rollout', body); showOutput('k8s-scale-output', data.output); } catch(err) { showOutput('k8s-scale-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== HELM =====
  const helm = {
    async install() {
      clearOutput('helm-output');
      const values = {}; document.getElementById('helm-values').value.split('\n').forEach(line => { const [k,...v] = line.split('='); if(k?.trim()) values[k.trim()]=v.join('=').trim(); });
      const body = { releaseName: document.getElementById('helm-release').value, chart: document.getElementById('helm-chart').value, repoName: document.getElementById('helm-repo-name').value||undefined, repoUrl: document.getElementById('helm-repo-url').value||undefined, namespace: document.getElementById('helm-ns').value, values, dryRun: document.getElementById('helm-dryrun').checked, upgrade: true };
      if (\!body.releaseName || \!body.chart) return toast('Release name and chart required', 'error');
      log(`[HELM] Installing ${body.chart}...`, 'cmd');
      try { const res = await api('POST', '/api/helm/install', body, true); await streamToOutput(res, 'helm-output'); } catch(err) { showOutput('helm-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async list() {
      clearOutput('helm-output');
      try { const data = await api('POST', '/api/helm/list', { allNamespaces: true }); const releases = data.releases||[]; showOutput('helm-output', releases.length ? 'NAME\tNAMESPACE\tCHART\tSTATUS\n' + releases.map(r=>`${r.name}\t${r.namespace}\t${r.chart}\t${r.status}`).join('\n') : 'No releases'); } catch(err) { showOutput('helm-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async rollback() {
      const releaseName = document.getElementById('helm-release').value; if (\!releaseName) return toast('Release name required', 'error');
      try { const data = await api('POST', '/api/helm/rollback', { releaseName, namespace: document.getElementById('helm-ns').value }); showOutput('helm-output', data.output||'Rollback done'); toast('Rollback initiated\!', 'success'); } catch(err) { showOutput('helm-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== S3 =====
  const s3 = {
    async create() {
      clearOutput('s3-create-output');
      const body = { bucketName: document.getElementById('s3-bucket-name').value.trim(), region: document.getElementById('s3-bucket-region').value.trim()||undefined, versioning: document.getElementById('s3-versioning').checked, publicBlock: document.getElementById('s3-public-block').checked };
      if (\!body.bucketName) return toast('Bucket name required', 'error');
      try { const data = await api('POST', '/api/s3/buckets', body); showOutput('s3-create-output', `✓ ${data.message}`); toast('Bucket created\!', 'success'); this.list(); } catch(err) { showOutput('s3-create-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async list() {
      try { const data = await api('GET', '/api/s3/buckets'); document.getElementById('s3-list-tbody').innerHTML = (data.buckets||[]).map(b=>`<tr><td style="color:var(--blue)">${escHtml(b.Name)}</td><td style="color:var(--text3)">${b.CreationDate?new Date(b.CreationDate).toLocaleDateString():'—'}</td><td><button class="btn btn-secondary" onclick="Portal.s3.browse('${b.Name}')" style="padding:2px 8px;font-size:10px">BROWSE</button></td></tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text3)">No buckets</td></tr>'; document.getElementById('count-s3').textContent = (data.buckets||[]).length; } catch(err) { toast(err.message, 'error'); }
    },
    async browse(bucket) { log(`[S3] Listing ${bucket}...`, 'cmd'); try { const data = await api('GET', `/api/s3/buckets/${bucket}/objects`); toast(`${(data.objects||[]).length} objects in ${bucket}`, 'info'); } catch(err) { toast(err.message, 'error'); } }
  };

  // ===== IAM =====
  const iam = {
    async createRole() {
      clearOutput('iam-role-output');
      const policiesRaw = document.getElementById('iam-policies').value;
      const policies = [...new Set(policiesRaw.split(/[\n,]/).map(s=>s.trim()).filter(s=>s.startsWith('arn:')))];
      const body = { roleName: document.getElementById('iam-role-name').value, assumeService: document.getElementById('iam-trust-service').value, description: document.getElementById('iam-role-desc').value, policies };
      if (\!body.roleName) return toast('Role name required', 'error');
      try { const data = await api('POST', '/api/iam/roles', body); showOutput('iam-role-output', `✓ Role created\!\nARN: ${data.roleArn}`); toast('IAM Role created\!', 'success'); } catch(err) { showOutput('iam-role-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listRoles() {
      try { const data = await api('GET', '/api/iam/roles'); document.getElementById('iam-roles-tbody').innerHTML = (data.roles||[]).map(r=>`<tr><td style="color:var(--green)">${escHtml(r.name)}</td><td style="color:var(--text3)">${r.created?new Date(r.created).toLocaleDateString():'—'}</td><td style="color:var(--text3);font-size:10px">${escHtml(r.arn)}</td></tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text3)">No roles</td></tr>'; } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== SECRETS =====
  const secrets = {
    async create() {
      clearOutput('secret-create-output');
      const body = { name: document.getElementById('secret-name').value, value: document.getElementById('secret-value').value, description: document.getElementById('secret-desc').value };
      if (\!body.name || \!body.value) return toast('Name and value required', 'error');
      try { const data = await api('POST', '/api/secrets', body); showOutput('secret-create-output', `✓ Secret stored\!\nARN: ${data.arn}`); toast('Secret stored\!', 'success'); this.list(); } catch(err) { showOutput('secret-create-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async list() {
      try { const data = await api('GET', '/api/secrets'); document.getElementById('secrets-tbody').innerHTML = (data.secrets||[]).map(s=>`<tr><td style="color:var(--yellow)">${escHtml(s.name)}</td><td style="color:var(--text3)">${escHtml(s.description||'—')}</td><td style="color:var(--text3)">${s.lastChanged?new Date(s.lastChanged).toLocaleDateString():'—'}</td><td><button class="btn btn-secondary" onclick="Portal.secrets.retrieve('${escHtml(s.name)}')" style="padding:2px 8px;font-size:10px">RETRIEVE</button></td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text3)">No secrets</td></tr>'; } catch(err) { toast(err.message, 'error'); }
    },
    async retrieve(name) { log(`[SECRETS] Retrieving ${name}...`, 'cmd'); try { const data = await api('GET', `/api/secrets/${encodeURIComponent(name)}`); toast('Secret retrieved (check console)', 'info'); log(`[SECRETS] ${name}: ${(data.value||'').substring(0,50)}...`, 'info'); } catch(err) { toast(err.message, 'error'); } }
  };

  // ===== LAMBDA =====
  const lambda = {
    async invoke() {
      clearOutput('lambda-invoke-output');
      let payload; try { payload = JSON.parse(document.getElementById('lambda-payload').value||'{}'); } catch(e) { return toast('Invalid JSON payload', 'error'); }
      const body = { functionName: document.getElementById('lambda-fn-name').value, payload };
      if (\!body.functionName) return toast('Function name required', 'error');
      log(`[LAMBDA] Invoking ${body.functionName}...`, 'cmd');
      try { const data = await api('POST', '/api/lambda/invoke', body); showOutput('lambda-invoke-output', `Status: ${data.statusCode}\n\nResult:\n${data.result}\n\nLogs:\n${data.logs}`); toast('Lambda invoked\!', 'success'); } catch(err) { showOutput('lambda-invoke-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async list() {
      try { const data = await api('GET', '/api/lambda/functions'); document.getElementById('lambda-tbody').innerHTML = (data.functions||[]).map(f=>`<tr><td style="color:var(--blue)">${escHtml(f.name)}</td><td><span class="badge badge-yellow">${escHtml(f.runtime||'')}</span></td><td>${f.memory}MB</td><td>${f.timeout}s</td><td style="color:var(--text3)">${f.lastModified?new Date(f.lastModified).toLocaleDateString():'—'}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text3)">No functions</td></tr>'; } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== DNS =====
  const dns = {
    async upsert() {
      clearOutput('r53-output');
      const body = { zoneId: document.getElementById('r53-zone-id').value, name: document.getElementById('r53-record-name').value, type: document.getElementById('r53-record-type').value, value: document.getElementById('r53-record-value').value, ttl: parseInt(document.getElementById('r53-ttl').value), action: 'UPSERT' };
      if (\!body.zoneId || \!body.name || \!body.value) return toast('Zone ID, record name, and value required', 'error');
      try { const data = await api('POST', '/api/route53/records', body); showOutput('r53-output', `✓ ${data.message}`); toast('DNS record updated\!', 'success'); } catch(err) { showOutput('r53-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listZones() {
      try { const data = await api('GET', '/api/route53/zones'); document.getElementById('r53-zones-tbody').innerHTML = (data.zones||[]).map(z=>`<tr><td style="color:var(--blue)">${escHtml(z.name)}</td><td style="color:var(--text2);font-size:10px;cursor:pointer" onclick="document.getElementById('r53-zone-id').value='${z.id.replace('/hostedzone/','')}'">click to use</td><td><span class="badge badge-${z.private?'yellow':'green'}">${z.private?'Private':'Public'}</span></td><td>${z.count||0}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text3)">No zones</td></tr>'; } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== TEMPLATES =====
  const templates = {
    all: [],
    selected: null,
    async load() {
      try { const data = await api('GET', '/api/templates'); this.all = data.templates||[]; this.render(this.all); } catch(err) { toast(err.message, 'error'); }
    },
    render(list) {
      const grid = document.getElementById('templates-grid');
      grid.innerHTML = list.map(t=>`<div class="resource-card" onclick="Portal.templates.select('${t.id}')"><div style="font-size:10px;color:var(--blue);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">${escHtml(t.category)}</div><div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">${escHtml(t.name)}</div><div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:12px">${escHtml(t.description)}</div><div style="display:flex;gap:4px;flex-wrap:wrap">${(t.tags||[]).map(tag=>`<span class="badge badge-blue">${escHtml(tag)}</span>`).join('')}</div><button class="btn btn-primary btn-full" style="margin-top:12px;font-size:11px">DEPLOY →</button></div>`).join('')||'<div style="color:var(--text3)">No templates</div>';
    },
    select(id) {
      this.selected = this.all.find(t=>t.id===id); if (\!this.selected) return;
      document.getElementById('tpl-deploy-title').textContent = `Deploy: ${this.selected.name}`;
      document.getElementById('tpl-params-form').innerHTML = `<div style="color:var(--text3);font-size:12px;margin-bottom:16px">${escHtml(this.selected.description)}</div>` + (this.selected.params||[]).map(p=>`<div class="form-group"><label>${escHtml(p.label)}${p.required?'<span style="color:var(--red)"> *</span>':''}</label>${p.type==='select'?`<select id="tpl-param-${p.name}">${(p.options||[]).map(o=>`<option value="${o}"${o===p.default?' selected':''}>${o}</option>`).join('')}</select>`:p.type==='password'?`<input type="password" id="tpl-param-${p.name}" placeholder="${p.default||''}">`:`<input type="${p.type||'text'}" id="tpl-param-${p.name}" value="${p.default||''}" placeholder="${p.default||''}">`}</div>`).join('');
      document.getElementById('tpl-deploy-panel').style.display = 'block';
      document.getElementById('tpl-deploy-panel').scrollIntoView({ behavior: 'smooth' });
    },
    search(query) { this.render(this.all.filter(t=>t.name.toLowerCase().includes(query.toLowerCase())||t.description.toLowerCase().includes(query.toLowerCase())||(t.tags||[]).some(tag=>tag.toLowerCase().includes(query.toLowerCase())))); },
    async deploy() {
      if (\!this.selected) return; clearOutput('tpl-output');
      const params = {}; (this.selected.params||[]).forEach(p=>{const el=document.getElementById(`tpl-param-${p.name}`);if(el)params[p.name]=el.value;});
      log(`[TEMPLATE] Deploying ${this.selected.name}...`, 'cmd');
      try { const data = await api('POST', `/api/templates/${this.selected.id}/deploy`, { params }); showOutput('tpl-output', `✓ ${data.message}\nJob ID: ${data.jobId}`); toast(`Deploying ${this.selected.name}...`, 'info'); } catch(err) { showOutput('tpl-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== CI/CD =====
  const cicd = {
    toggleFields() { const t = document.getElementById('cicd-deploy-target').value; document.getElementById('cicd-eks-fields').style.display = t==='eks'?'block':'none'; document.getElementById('cicd-s3-fields').style.display = t==='s3'?'block':'none'; },
    async generate() {
      clearOutput('cicd-output');
      const body = { type: document.getElementById('cicd-type').value, appType: document.getElementById('cicd-app-type').value, deployTarget: document.getElementById('cicd-deploy-target').value, repoName: document.getElementById('cicd-repo').value, region: document.getElementById('cicd-region').value, ecr: document.getElementById('cicd-ecr')?.value, eksCluster: document.getElementById('cicd-eks-cluster')?.value, s3Bucket: document.getElementById('cicd-s3')?.value };
      log('[CICD] Generating pipeline YAML...', 'cmd');
      try { const data = await api('POST', '/api/cicd/generate', body); showOutput('cicd-output', data.yaml); toast('Pipeline YAML generated\!', 'success'); } catch(err) { showOutput('cicd-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== CLOUDWATCH LOGS =====
  const cwlogs = {
    async filter() {
      clearOutput('logs-output');
      const body = { logGroupName: document.getElementById('logs-group').value, filterPattern: document.getElementById('logs-filter').value };
      if (\!body.logGroupName) return toast('Log group name required', 'error');
      try { const data = await api('POST', '/api/logs/filter', body); const events = data.events||[]; showOutput('logs-output', events.length ? events.map(e=>`${new Date(e.timestamp).toISOString()} | ${e.message}`).join('\n') : 'No log events found'); toast(`${events.length} events found`, 'info'); } catch(err) { showOutput('logs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listGroups() {
      try { const data = await api('GET', '/api/logs/groups'); document.getElementById('log-groups-tbody').innerHTML = (data.logGroups||[]).map(g=>`<tr><td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('logs-group').value='${escHtml(g.name)}'">${escHtml(g.name)}</td><td>${(g.size||0).toLocaleString()}</td><td>${g.retention||'Never expire'}</td></tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text3)">No log groups</td></tr>'; } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== COST =====
  const cost = {
    async load() {
      log('[COST] Loading Cost Explorer data...', 'cmd');
      try { const data = await api('GET', '/api/cost/summary'); const total = parseFloat(data.totalCost); document.getElementById('cost-total').style.display='block'; document.getElementById('cost-total').textContent=`Total: $${data.totalCost} USD (${data.period})`; document.getElementById('cost-tbody').innerHTML = (data.services||[]).map(s=>{const pct=total>0?((parseFloat(s.cost)/total)*100).toFixed(1):0;return`<tr><td>${escHtml(s.service)}</td><td style="color:var(--yellow);font-weight:600">$${s.cost}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:4px;background:var(--border);border-radius:2px"><div style="width:${pct}%;height:100%;background:var(--green);border-radius:2px"></div></div><span style="color:var(--text3);width:40px;text-align:right">${pct}%</span></div></td></tr>`}).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text3)">No cost data</td></tr>'; toast(`$${data.totalCost} in last 30 days`, 'info'); } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== AUDIT =====
  const audit = {
    async load() {
      try { const data = await api('GET', '/api/audit/logs?limit=100'); document.getElementById('audit-tbody').innerHTML = (data.logs||[]).map(l=>`<tr><td style="color:var(--text3)">${l.created_at?new Date(l.created_at*1000).toLocaleString():'—'}</td><td style="color:var(--blue)">${escHtml(l.user)}</td><td>${escHtml(l.action)}</td><td style="color:var(--text2)">${escHtml(l.resource||'—')}</td><td><span class="badge badge-${l.status==='completed'?'green':l.status==='initiated'?'yellow':'red'}">${escHtml(l.status)}</span></td></tr>`).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--text3)">${escHtml(data.message||'No logs')}</td></tr>`; } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== INIT =====
  function init() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-user').value;
      const password = document.getElementById('login-pass').value;
      const btn = document.getElementById('login-btn');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> AUTHENTICATING...';
      try {
        const data = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, password }) }).then(r => r.json());
        if (data.error) throw new Error(data.error);
        showApp(data.user);
        log(`[AUTH] Logged in as ${data.user.username}`, 'success');
      } catch(err) {
        document.getElementById('login-error').style.display = 'block';
        btn.disabled = false; btn.innerHTML = '<span>▶</span> AUTHENTICATE';
      }
    });

    document.querySelectorAll('.nav-tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    document.getElementById('creds-form').addEventListener('submit', (e) => { e.preventDefault(); saveCreds(); });

    // Check existing session
    fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json()).then(data => { if (data.user) showApp(data.user); }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { logout, loadResources, clearCreds, switchTab, toggleConsole, clearConsole, ec2, eks, asg, terminal, nginx, docker, k8s, helm, s3, iam, secrets, lambda, dns, templates, cicd, cwlogs, cost, audit };
})();
