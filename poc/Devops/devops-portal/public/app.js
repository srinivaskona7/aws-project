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
      return r.json().then(data => { if (!r.ok) throw new Error(data.error || 'Request failed'); return data; });
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
    if (!out) return;
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
    if (!el) return;
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
              toast(payload.exitCode === 0 ? 'Job completed!' : `Job failed (exit ${payload.exitCode})`, payload.exitCode === 0 ? 'success' : 'error');
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
    if (!accessKeyId || !secretAccessKey) return toast('Access Key and Secret Key required', 'error');
    const btn = document.getElementById('creds-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> SAVING...';
    try {
      await api('POST', '/api/credentials', { accessKeyId, secretAccessKey, region });
      toast('AWS credentials saved!', 'success');
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
      toast('Resources refreshed!', 'success');
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
    if (typeof info !== 'undefined') info.setTab(tabId);
  }

  function toggleConsole() {
    consoleCollapsed = !consoleCollapsed;
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
      if (!host) { toast('Hostname required', 'error'); return null; }
      const cfg = { host, username, port: parseInt(port) };
      if (method === 'key') { cfg.privateKey = document.getElementById('ssh-key').value; if (!cfg.privateKey) { toast('PEM key required', 'error'); return null; } }
      else cfg.password = document.getElementById('ssh-pass').value;
      return cfg;
    },
    async testConnection() {
      const body = this._getConfig(); if (!body) return;
      log('[SSH] Testing connection...', 'cmd');
      try { const data = await api('POST', '/api/terminal/test-connection', body); toast(`Connected to ${body.host}!`, 'success'); log(`[SSH] ${data.message}`, 'success'); document.getElementById('terminal-status').innerHTML = '<span style="color:var(--green)">✓ Connection test passed</span>'; }
      catch(err) { toast(err.message, 'error'); log(`[SSH] ${err.message}`, 'error'); document.getElementById('terminal-status').innerHTML = `<span style="color:var(--red)">✗ ${err.message}</span>`; }
    },
    async connect() {
      const config = this._getConfig(); if (!config) return;
      this.sshConfig = config;
      if (!xterm) {
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
      if (!cmd || !this.sshConfig) { if (!this.sshConfig) toast('Connect to SSH first', 'error'); return; }
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
      if (!body.serverName) return toast('Server name required', 'error');
      try { const data = await api('POST', '/api/nginx/generate', body); showOutput('nginx-output', data.config); toast('Nginx config generated!', 'success'); } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== DOCKER =====
  const docker = {
    async build() {
      clearOutput('docker-build-output');
      const body = { imageName: document.getElementById('docker-image-name').value, tag: document.getElementById('docker-tag').value, dockerfile: document.getElementById('docker-dockerfile').value };
      if (!body.imageName) return toast('Image name required', 'error');
      log(`[DOCKER] Building ${body.imageName}:${body.tag}...`, 'cmd');
      try { const res = await api('POST', '/api/docker/build', body, true); await streamToOutput(res, 'docker-build-output'); } catch(err) { showOutput('docker-build-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async run() {
      clearOutput('docker-run-output');
      const ports = document.getElementById('docker-run-ports').value.split(',').map(s=>s.trim()).filter(Boolean);
      const envVars = {}; document.getElementById('docker-run-env').value.split(',').map(s=>s.trim()).filter(Boolean).forEach(p => { const [k,...v] = p.split('='); if(k) envVars[k.trim()]=(v.join('=')).trim(); });
      const body = { image: document.getElementById('docker-run-image').value, name: document.getElementById('docker-run-name').value||undefined, ports, envVars, detach: document.getElementById('docker-run-detach').checked };
      if (!body.image) return toast('Image required', 'error');
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
      if (!body.manifest) return toast('Manifest YAML required', 'error');
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
      if (!body.name) return toast('Deployment name required', 'error');
      try { const data = await api('POST', '/api/k8s/scale', body); showOutput('k8s-scale-output', data.output); toast('Scaling done!', 'success'); } catch(err) { showOutput('k8s-scale-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async rollout() {
      clearOutput('k8s-scale-output');
      const body = { name: document.getElementById('k8s-rollout-name').value, action: document.getElementById('k8s-rollout-action').value, namespace: 'default' };
      if (!body.name) return toast('Deployment name required', 'error');
      try { const data = await api('POST', '/api/k8s/rollout', body); showOutput('k8s-scale-output', data.output); } catch(err) { showOutput('k8s-scale-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== HELM =====
  const helm = {
    async install() {
      clearOutput('helm-output');
      const values = {}; document.getElementById('helm-values').value.split('\n').forEach(line => { const [k,...v] = line.split('='); if(k?.trim()) values[k.trim()]=v.join('=').trim(); });
      const body = { releaseName: document.getElementById('helm-release').value, chart: document.getElementById('helm-chart').value, repoName: document.getElementById('helm-repo-name').value||undefined, repoUrl: document.getElementById('helm-repo-url').value||undefined, namespace: document.getElementById('helm-ns').value, values, dryRun: document.getElementById('helm-dryrun').checked, upgrade: true };
      if (!body.releaseName || !body.chart) return toast('Release name and chart required', 'error');
      log(`[HELM] Installing ${body.chart}...`, 'cmd');
      try { const res = await api('POST', '/api/helm/install', body, true); await streamToOutput(res, 'helm-output'); } catch(err) { showOutput('helm-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async list() {
      clearOutput('helm-output');
      try { const data = await api('POST', '/api/helm/list', { allNamespaces: true }); const releases = data.releases||[]; showOutput('helm-output', releases.length ? 'NAME\tNAMESPACE\tCHART\tSTATUS\n' + releases.map(r=>`${r.name}\t${r.namespace}\t${r.chart}\t${r.status}`).join('\n') : 'No releases'); } catch(err) { showOutput('helm-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async rollback() {
      const releaseName = document.getElementById('helm-release').value; if (!releaseName) return toast('Release name required', 'error');
      try { const data = await api('POST', '/api/helm/rollback', { releaseName, namespace: document.getElementById('helm-ns').value }); showOutput('helm-output', data.output||'Rollback done'); toast('Rollback initiated!', 'success'); } catch(err) { showOutput('helm-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== S3 =====
  const s3 = {
    async create() {
      clearOutput('s3-create-output');
      const body = { bucketName: document.getElementById('s3-bucket-name').value.trim(), region: document.getElementById('s3-bucket-region').value.trim()||undefined, versioning: document.getElementById('s3-versioning').checked, publicBlock: document.getElementById('s3-public-block').checked };
      if (!body.bucketName) return toast('Bucket name required', 'error');
      try { const data = await api('POST', '/api/s3/buckets', body); showOutput('s3-create-output', `✓ ${data.message}`); toast('Bucket created!', 'success'); this.list(); } catch(err) { showOutput('s3-create-output', `Error: ${err.message}`); toast(err.message, 'error'); }
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
      if (!body.roleName) return toast('Role name required', 'error');
      try { const data = await api('POST', '/api/iam/roles', body); showOutput('iam-role-output', `✓ Role created!\nARN: ${data.roleArn}`); toast('IAM Role created!', 'success'); } catch(err) { showOutput('iam-role-output', `Error: ${err.message}`); toast(err.message, 'error'); }
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
      if (!body.name || !body.value) return toast('Name and value required', 'error');
      try { const data = await api('POST', '/api/secrets', body); showOutput('secret-create-output', `✓ Secret stored!\nARN: ${data.arn}`); toast('Secret stored!', 'success'); this.list(); } catch(err) { showOutput('secret-create-output', `Error: ${err.message}`); toast(err.message, 'error'); }
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
      if (!body.functionName) return toast('Function name required', 'error');
      log(`[LAMBDA] Invoking ${body.functionName}...`, 'cmd');
      try { const data = await api('POST', '/api/lambda/invoke', body); showOutput('lambda-invoke-output', `Status: ${data.statusCode}\n\nResult:\n${data.result}\n\nLogs:\n${data.logs}`); toast('Lambda invoked!', 'success'); } catch(err) { showOutput('lambda-invoke-output', `Error: ${err.message}`); toast(err.message, 'error'); }
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
      if (!body.zoneId || !body.name || !body.value) return toast('Zone ID, record name, and value required', 'error');
      try { const data = await api('POST', '/api/route53/records', body); showOutput('r53-output', `✓ ${data.message}`); toast('DNS record updated!', 'success'); } catch(err) { showOutput('r53-output', `Error: ${err.message}`); toast(err.message, 'error'); }
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
      this.selected = this.all.find(t=>t.id===id); if (!this.selected) return;
      document.getElementById('tpl-deploy-title').textContent = `Deploy: ${this.selected.name}`;
      document.getElementById('tpl-params-form').innerHTML = `<div style="color:var(--text3);font-size:12px;margin-bottom:16px">${escHtml(this.selected.description)}</div>` + (this.selected.params||[]).map(p=>`<div class="form-group"><label>${escHtml(p.label)}${p.required?'<span style="color:var(--red)"> *</span>':''}</label>${p.type==='select'?`<select id="tpl-param-${p.name}">${(p.options||[]).map(o=>`<option value="${o}"${o===p.default?' selected':''}>${o}</option>`).join('')}</select>`:p.type==='password'?`<input type="password" id="tpl-param-${p.name}" placeholder="${p.default||''}">`:`<input type="${p.type||'text'}" id="tpl-param-${p.name}" value="${p.default||''}" placeholder="${p.default||''}">`}</div>`).join('');
      document.getElementById('tpl-deploy-panel').style.display = 'block';
      document.getElementById('tpl-deploy-panel').scrollIntoView({ behavior: 'smooth' });
    },
    search(query) { this.render(this.all.filter(t=>t.name.toLowerCase().includes(query.toLowerCase())||t.description.toLowerCase().includes(query.toLowerCase())||(t.tags||[]).some(tag=>tag.toLowerCase().includes(query.toLowerCase())))); },
    async deploy() {
      if (!this.selected) return; clearOutput('tpl-output');
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
      try { const data = await api('POST', '/api/cicd/generate', body); showOutput('cicd-output', data.yaml); toast('Pipeline YAML generated!', 'success'); } catch(err) { showOutput('cicd-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== CLOUDWATCH LOGS =====
  const cwlogs = {
    async filter() {
      clearOutput('logs-output');
      const body = { logGroupName: document.getElementById('logs-group').value, filterPattern: document.getElementById('logs-filter').value };
      if (!body.logGroupName) return toast('Log group name required', 'error');
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

  // ===== CLOUDFORMATION =====
  const cfn = {
    async listStacks() {
      log('[CFN] Listing stacks...', 'cmd');
      try {
        const data = await api('GET', '/api/cfn/stacks');
        const tbody = document.getElementById('cfn-stacks-tbody');
        tbody.innerHTML = (data.stacks||[]).map(s => `<tr>
          <td style="color:var(--blue)">${escHtml(s.name)}</td>
          <td><span class="badge badge-${s.status&&s.status.includes('COMPLETE')?'green':s.status&&s.status.includes('FAIL')?'red':'yellow'}">${escHtml(s.status||'')}</span></td>
          <td style="color:var(--text3)">${s.created?new Date(s.created).toLocaleDateString():'—'}</td>
          <td style="color:var(--text3)">${s.updated?new Date(s.updated).toLocaleDateString():'—'}</td>
          <td><button class="btn btn-secondary" onclick="document.getElementById('cfn-stack-name').value='${escHtml(s.name)}'" style="padding:2px 8px;font-size:10px">SELECT</button></td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text3);text-align:center">No stacks</td></tr>';
        toast(`${(data.stacks||[]).length} stacks loaded`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async deploy() {
      clearOutput('cfn-output');
      const paramsRaw = document.getElementById('cfn-params').value;
      const parameters = {};
      paramsRaw.split('\n').forEach(line => { const [k,...v] = line.split('='); if(k?.trim()) parameters[k.trim()] = v.join('=').trim(); });
      const capRaw = document.getElementById('cfn-capabilities').value;
      const body = {
        stackName: document.getElementById('cfn-stack-name').value,
        templateBody: document.getElementById('cfn-template-body').value || undefined,
        templateUrl: document.getElementById('cfn-template-url').value || undefined,
        parameters,
        capabilities: capRaw.split(','),
        dryRun: document.getElementById('cfn-dryrun').checked
      };
      if (!body.stackName) return toast('Stack name required', 'error');
      log(`[CFN] Deploying stack ${body.stackName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/cfn/deploy', body);
        showOutput('cfn-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('cfn-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async deleteStack() {
      const name = document.getElementById('cfn-stack-name').value;
      if (!name) return toast('Stack name required', 'error');
      if (!confirm(`Delete stack "${name}"?`)) return;
      try {
        const data = await api('POST', '/api/cfn/delete', { stackName: name });
        showOutput('cfn-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('cfn-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== CODEBUILD =====
  const codebuild = {
    async listProjects() {
      try {
        const data = await api('GET', '/api/codebuild/projects');
        const tbody = document.getElementById('cb-projects-tbody');
        tbody.innerHTML = (data.projects||[]).map(p => `<tr>
          <td style="color:var(--blue)">${escHtml(p)}</td>
          <td><button class="btn btn-secondary" onclick="document.getElementById('cb-project-name').value='${escHtml(p)}';" style="padding:2px 8px;font-size:10px">SELECT</button>
          <button class="btn btn-secondary" onclick="Portal.codebuild.getBuilds('${escHtml(p)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">BUILDS</button></td>
        </tr>`).join('') || '<tr><td colspan="2" style="color:var(--text3);text-align:center">No projects</td></tr>';
        toast(`${(data.projects||[]).length} projects`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async startBuild() {
      clearOutput('cb-build-output');
      const envVarsRaw = document.getElementById('cb-env-vars').value;
      const envVars = {};
      envVarsRaw.split('\n').forEach(line => { const [k,...v] = line.split('='); if(k?.trim()) envVars[k.trim()] = v.join('=').trim(); });
      const body = { projectName: document.getElementById('cb-project-name').value, sourceVersion: document.getElementById('cb-source-version').value || undefined, envVars };
      if (!body.projectName) return toast('Project name required', 'error');
      log(`[CODEBUILD] Starting build for ${body.projectName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/codebuild/build', body);
        showOutput('cb-build-output', `✓ Build started!\nBuild ID: ${data.buildId}\nStatus: ${data.status}`);
        toast(`Build started: ${data.buildId}`, 'success');
      } catch(err) { showOutput('cb-build-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async getBuilds(projectName) {
      log(`[CODEBUILD] Fetching builds for ${projectName}...`, 'cmd');
      try {
        const data = await api('GET', `/api/codebuild/projects/${encodeURIComponent(projectName)}/builds`);
        const tbody = document.getElementById('cb-projects-tbody');
        const txt = (data.builds||[]).map(b => `${b.id?.split(':').pop()} | ${b.status} | ${b.startTime ? new Date(b.startTime).toLocaleString() : '—'}`).join('\n');
        showOutput('cb-build-output', txt || 'No builds found');
      } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== CODEPIPELINE =====
  const pipeline = {
    async list() {
      log('[PIPELINE] Listing pipelines...', 'cmd');
      try {
        const data = await api('GET', '/api/pipeline/list');
        const tbody = document.getElementById('pipeline-tbody');
        tbody.innerHTML = (data.pipelines||[]).map(p => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('pipeline-name').value='${escHtml(p.name)}'">${escHtml(p.name)}</td>
          <td colspan="2" style="color:var(--text3)">—</td>
          <td style="color:var(--text3)">${p.updated?new Date(p.updated).toLocaleDateString():'—'}</td>
          <td>
            <button class="btn btn-primary" onclick="Portal.pipeline.startByName('${escHtml(p.name)}')" style="padding:2px 8px;font-size:10px">START</button>
            <button class="btn btn-secondary" onclick="Portal.pipeline.getStateByName('${escHtml(p.name)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">STATUS</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text3);text-align:center">No pipelines</td></tr>';
        toast(`${(data.pipelines||[]).length} pipelines`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async start() {
      const name = document.getElementById('pipeline-name').value;
      if (!name) return toast('Pipeline name required', 'error');
      await this.startByName(name);
    },
    async startByName(name) {
      log(`[PIPELINE] Starting ${name}...`, 'cmd');
      try {
        const data = await api('POST', '/api/pipeline/start', { name });
        showOutput('pipeline-output', `✓ Pipeline started!\nExecution ID: ${data.pipelineExecutionId}`);
        toast(`Pipeline ${name} started!`, 'success');
      } catch(err) { showOutput('pipeline-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async getState() {
      const name = document.getElementById('pipeline-name').value;
      if (!name) return toast('Pipeline name required', 'error');
      await this.getStateByName(name);
    },
    async getStateByName(name) {
      log(`[PIPELINE] Getting state of ${name}...`, 'cmd');
      try {
        const data = await api('GET', `/api/pipeline/${encodeURIComponent(name)}/state`);
        const txt = (data.stages||[]).map(s => `${s.name}: ${s.status||'—'} (${s.lastRun ? new Date(s.lastRun).toLocaleString() : 'no runs'})`).join('\n');
        showOutput('pipeline-output', txt || 'No stage data');
        const tbody = document.getElementById('pipeline-tbody');
        if (!tbody.innerHTML.includes(name)) return;
      } catch(err) { showOutput('pipeline-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== ELASTICACHE =====
  const cache = {
    async list() {
      log('[CACHE] Listing clusters...', 'cmd');
      try {
        const data = await api('GET', '/api/cache/clusters');
        const tbody = document.getElementById('cache-clusters-tbody');
        const all = [...(data.clusters||[]).map(c => ({ ...c, type: 'cluster' })), ...(data.replicationGroups||[]).map(r => ({ id: r.id, engine: 'redis', status: r.status, nodeType: r.nodeType, type: 'rg' }))];
        tbody.innerHTML = all.length ? all.map(c => `<tr>
          <td style="color:var(--blue)">${escHtml(c.id)}</td>
          <td><span class="badge badge-blue">${escHtml(c.engine||'')}</span></td>
          <td><span class="badge badge-${c.status==='available'?'green':'yellow'}">${escHtml(c.status||'')}</span></td>
          <td>${escHtml(c.nodeType||'')}</td>
          <td><button class="btn btn-danger" onclick="Portal.cache.deleteCluster('${escHtml(c.id)}')" style="padding:2px 8px;font-size:10px">DELETE</button></td>
        </tr>`).join('') : '<tr><td colspan="5" style="color:var(--text3);text-align:center">No clusters</td></tr>';
        toast(`${all.length} clusters`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async create() {
      clearOutput('cache-output');
      const body = { clusterId: document.getElementById('cache-cluster-id').value, engine: document.getElementById('cache-engine').value, nodeType: document.getElementById('cache-node-type').value, numNodes: parseInt(document.getElementById('cache-num-nodes').value) };
      if (!body.clusterId) return toast('Cluster ID required', 'error');
      log(`[CACHE] Creating ${body.engine} cluster ${body.clusterId}...`, 'cmd');
      try {
        const data = await api('POST', '/api/cache/create', body);
        showOutput('cache-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('cache-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async deleteCluster(clusterId) {
      if (!confirm(`Delete ElastiCache cluster "${clusterId}"?`)) return;
      try {
        const data = await api('POST', '/api/cache/delete', { clusterId });
        toast(data.message, 'success');
        this.list();
      } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== DYNAMODB =====
  const dynamo = {
    async listTables() {
      log('[DYNAMO] Listing tables...', 'cmd');
      try {
        const data = await api('GET', '/api/dynamo/tables');
        const tbody = document.getElementById('dynamo-tables-tbody');
        tbody.innerHTML = (data.tables||[]).map(t => `<tr>
          <td style="color:var(--blue)">${escHtml(t)}</td>
          <td>
            <button class="btn btn-secondary" onclick="Portal.dynamo.scan('${escHtml(t)}')" style="padding:2px 8px;font-size:10px">SCAN</button>
            <button class="btn btn-danger" onclick="Portal.dynamo.deleteTable('${escHtml(t)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">DELETE</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="2" style="color:var(--text3);text-align:center">No tables</td></tr>';
        toast(`${(data.tables||[]).length} tables`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async createTable() {
      clearOutput('dynamo-create-output');
      const body = { tableName: document.getElementById('dynamo-table-name').value, partitionKey: document.getElementById('dynamo-pk').value, partitionKeyType: document.getElementById('dynamo-pk-type').value, sortKey: document.getElementById('dynamo-sk').value || undefined, billingMode: document.getElementById('dynamo-billing').value };
      if (!body.tableName || !body.partitionKey) return toast('Table name and partition key required', 'error');
      log(`[DYNAMO] Creating table ${body.tableName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/dynamo/tables', body);
        showOutput('dynamo-create-output', `✓ Table ${data.tableName} created\nStatus: ${data.status}`);
        toast('Table created!', 'success');
        this.listTables();
      } catch(err) { showOutput('dynamo-create-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async scan(tableName) {
      log(`[DYNAMO] Scanning ${tableName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/dynamo/scan', { tableName, limit: 25 });
        showOutput('dynamo-scan-output', JSON.stringify(data.items, null, 2) || 'No items');
        toast(`${data.count} items scanned`, 'info');
      } catch(err) { showOutput('dynamo-scan-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async deleteTable(tableName) {
      if (!confirm(`Delete table "${tableName}"? This is irreversible!`)) return;
      try {
        await api('DELETE', `/api/dynamo/tables/${encodeURIComponent(tableName)}`);
        toast(`Table ${tableName} deleted`, 'success');
        this.listTables();
      } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== SQS =====
  const sqs = {
    async list() {
      log('[SQS] Listing queues...', 'cmd');
      try {
        const data = await api('GET', '/api/sqs/queues');
        const tbody = document.getElementById('sqs-queues-tbody');
        tbody.innerHTML = (data.queues||[]).map(q => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('sqs-queue-url').value='${escHtml(q.url)}'">${escHtml(q.name)}</td>
          <td><button class="btn btn-secondary" onclick="document.getElementById('sqs-queue-url').value='${escHtml(q.url)}'" style="padding:2px 8px;font-size:10px">SELECT</button></td>
        </tr>`).join('') || '<tr><td colspan="2" style="color:var(--text3);text-align:center">No queues</td></tr>';
        toast(`${(data.queues||[]).length} queues`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async create() {
      clearOutput('sqs-output');
      const body = { queueName: document.getElementById('sqs-queue-name').value, fifo: document.getElementById('sqs-fifo').checked };
      if (!body.queueName) return toast('Queue name required', 'error');
      log(`[SQS] Creating queue ${body.queueName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/sqs/queues', body);
        showOutput('sqs-output', `✓ Queue created!\nURL: ${data.queueUrl}`);
        toast('Queue created!', 'success');
        document.getElementById('sqs-queue-url').value = data.queueUrl;
        this.list();
      } catch(err) { showOutput('sqs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async send() {
      clearOutput('sqs-output');
      const body = { queueUrl: document.getElementById('sqs-queue-url').value, message: document.getElementById('sqs-message').value };
      if (!body.queueUrl || !body.message) return toast('Queue URL and message required', 'error');
      try {
        const data = await api('POST', '/api/sqs/send', body);
        showOutput('sqs-output', `✓ Message sent!\nMessage ID: ${data.messageId}`);
        toast('Message sent!', 'success');
      } catch(err) { showOutput('sqs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async receive() {
      clearOutput('sqs-output');
      const queueUrl = document.getElementById('sqs-queue-url').value;
      if (!queueUrl) return toast('Queue URL required', 'error');
      try {
        const data = await api('POST', '/api/sqs/receive', { queueUrl, maxMessages: 10 });
        const msgs = data.messages || [];
        showOutput('sqs-output', msgs.length ? msgs.map(m => `ID: ${m.id}\n${m.body}`).join('\n\n---\n\n') : 'No messages available');
        toast(`${msgs.length} messages received`, 'info');
      } catch(err) { showOutput('sqs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== CLOUDFRONT =====
  const cdn = {
    async list() {
      log('[CDN] Listing distributions...', 'cmd');
      try {
        const data = await api('GET', '/api/cdn/distributions');
        const tbody = document.getElementById('cdn-distros-tbody');
        tbody.innerHTML = (data.distributions||[]).map(d => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('cdn-dist-id').value='${escHtml(d.id)}'">${escHtml(d.id)}</td>
          <td style="color:var(--text2)">${escHtml(d.domainName||'')}</td>
          <td><span class="badge badge-${d.status==='Deployed'?'green':'yellow'}">${escHtml(d.status||'')}</span></td>
          <td><span class="badge badge-${d.enabled?'green':'red'}">${d.enabled?'Yes':'No'}</span></td>
          <td style="color:var(--text3);font-size:11px">${(d.origins||[]).join(', ')}</td>
          <td><button class="btn btn-secondary" onclick="Portal.cdn.invalidate('${escHtml(d.id)}')" style="padding:2px 8px;font-size:10px">INVALIDATE</button></td>
        </tr>`).join('') || '<tr><td colspan="6" style="color:var(--text3);text-align:center">No distributions</td></tr>';
        toast(`${(data.distributions||[]).length} distributions`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async invalidate(distId) {
      clearOutput('cdn-output');
      const distributionId = distId || document.getElementById('cdn-dist-id').value;
      const pathsRaw = document.getElementById('cdn-paths').value;
      const paths = pathsRaw.split(',').map(p => p.trim()).filter(Boolean);
      if (!distributionId) return toast('Distribution ID required', 'error');
      log(`[CDN] Creating invalidation for ${distributionId}...`, 'cmd');
      try {
        const data = await api('POST', '/api/cdn/invalidate', { distributionId, paths });
        showOutput('cdn-output', `✓ Invalidation created!\nID: ${data.invalidationId}\nStatus: ${data.status}`);
        toast('Cache invalidation created!', 'success');
      } catch(err) { showOutput('cdn-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== ELASTIC BEANSTALK =====
  const beanstalk = {
    async list() {
      log('[BEANSTALK] Loading apps and environments...', 'cmd');
      try {
        const data = await api('GET', '/api/beanstalk/apps');
        const tbody = document.getElementById('beanstalk-envs-tbody');
        tbody.innerHTML = (data.environments||[]).map(e => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('beanstalk-env-name').value='${escHtml(e.name)}'">${escHtml(e.name)}</td>
          <td>${escHtml(e.app||'')}</td>
          <td><span class="badge badge-${e.status==='Ready'?'green':'yellow'}">${escHtml(e.status||'')}</span></td>
          <td><span class="badge badge-${e.health==='Green'?'green':e.health==='Yellow'?'yellow':'red'}">${escHtml(e.health||'')}</span></td>
          <td style="color:var(--text2);font-size:11px">${e.url?`<a href="http://${e.url}" target="_blank" style="color:var(--blue)">${e.url}</a>`:'—'}</td>
          <td><button class="btn btn-secondary" onclick="Portal.beanstalk.restartEnv('${escHtml(e.name)}')" style="padding:2px 8px;font-size:10px">RESTART</button></td>
        </tr>`).join('') || '<tr><td colspan="6" style="color:var(--text3);text-align:center">No environments</td></tr>';
        toast(`${(data.environments||[]).length} environments`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async restartEnv(envName) {
      const name = envName || document.getElementById('beanstalk-env-name').value;
      if (!name) return toast('Environment name required', 'error');
      log(`[BEANSTALK] Restarting ${name}...`, 'cmd');
      try {
        const data = await api('POST', '/api/beanstalk/restart', { environmentName: name });
        showOutput('beanstalk-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('beanstalk-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async restart() { await this.restartEnv(); },
    async events() {
      const name = document.getElementById('beanstalk-env-name').value;
      if (!name) return toast('Environment name required', 'error');
      log(`[BEANSTALK] Getting events for ${name}...`, 'cmd');
      try {
        const data = await api('GET', `/api/beanstalk/events?environmentName=${encodeURIComponent(name)}`);
        showOutput('beanstalk-output', (data.events||[]).map(e => `[${e.severity}] ${new Date(e.time).toLocaleString()} - ${e.message}`).join('\n') || 'No events');
      } catch(err) { showOutput('beanstalk-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== SSM =====
  const ssm = {
    async list() {
      log('[SSM] Listing parameters...', 'cmd');
      try {
        const data = await api('GET', '/api/ssm/parameters?path=/&recursive=true');
        showOutput('ssm-param-output', (data.parameters||[]).map(p => `${p.name} [${p.type}] v${p.version}`).join('\n') || 'No parameters');
        toast(`${(data.parameters||[]).length} parameters`, 'info');
      } catch(err) { showOutput('ssm-param-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async get() {
      const name = document.getElementById('ssm-param-name').value;
      if (!name) return toast('Parameter name required', 'error');
      try {
        const data = await api('GET', `/api/ssm/parameters/${encodeURIComponent(name)}`);
        showOutput('ssm-param-output', `Name: ${data.parameter.name}\nType: ${data.parameter.type}\nValue: ${data.parameter.value}\nVersion: ${data.parameter.version}`);
      } catch(err) { showOutput('ssm-param-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async put() {
      const body = { name: document.getElementById('ssm-param-name').value, value: document.getElementById('ssm-param-value').value, type: document.getElementById('ssm-param-type').value };
      if (!body.name || !body.value) return toast('Name and value required', 'error');
      log(`[SSM] Putting parameter ${body.name}...`, 'cmd');
      try {
        const data = await api('POST', '/api/ssm/parameters', body);
        showOutput('ssm-param-output', `✓ Parameter stored!\nVersion: ${data.version}`);
        toast('Parameter stored!', 'success');
      } catch(err) { showOutput('ssm-param-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async runCommand() {
      clearOutput('ssm-cmd-output');
      const instanceIds = document.getElementById('ssm-instance-ids').value.split(',').map(s => s.trim()).filter(Boolean);
      const commands = document.getElementById('ssm-commands').value.split('\n').filter(Boolean);
      if (!instanceIds.length || !commands.length) return toast('Instance IDs and commands required', 'error');
      log(`[SSM] Running command on ${instanceIds.join(', ')}...`, 'cmd');
      try {
        const data = await api('POST', '/api/ssm/run-command', { instanceIds, commands });
        showOutput('ssm-cmd-output', `✓ Command sent!\nCommand ID: ${data.commandId}\nStatus: ${data.status}`);
        toast('SSM Command sent!', 'success');
      } catch(err) { showOutput('ssm-cmd-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== CLOUDWATCH ALARMS =====
  const alarms = {
    async list() {
      log('[ALARMS] Listing alarms...', 'cmd');
      try {
        const data = await api('GET', '/api/alarms/list');
        const tbody = document.getElementById('alarms-tbody');
        tbody.innerHTML = (data.alarms||[]).map(a => `<tr>
          <td style="color:var(--text)">${escHtml(a.name)}</td>
          <td><span class="badge badge-${a.state==='OK'?'green':a.state==='ALARM'?'red':'yellow'}">${escHtml(a.state||'')}</span></td>
          <td style="color:var(--text2)">${escHtml(a.metric||'')}</td>
          <td style="color:var(--yellow)">${a.threshold}</td>
          <td style="color:var(--text3)">${a.updatedAt?new Date(a.updatedAt).toLocaleString():'—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text3);text-align:center">No alarms</td></tr>';
        toast(`${(data.alarms||[]).length} alarms`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async create() {
      clearOutput('alarm-create-output');
      const metricValue = document.getElementById('alarm-metric').value;
      const body = {
        alarmName: document.getElementById('alarm-name').value,
        metricName: metricValue,
        namespace: document.getElementById('alarm-namespace').value,
        threshold: parseFloat(document.getElementById('alarm-threshold').value),
        comparisonOperator: document.getElementById('alarm-comparison').value
      };
      if (!body.alarmName || !body.metricName) return toast('Alarm name and metric required', 'error');
      log(`[ALARMS] Creating alarm ${body.alarmName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/alarms/create', body);
        showOutput('alarm-create-output', `✓ ${data.message}`);
        toast('Alarm created!', 'success');
        this.list();
      } catch(err) { showOutput('alarm-create-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== ECS =====
  const ecs = {
    async listClusters() {
      log('[ECS] Listing clusters...', 'cmd');
      try {
        const data = await api('GET', '/api/ecs/clusters');
        const tbody = document.getElementById('ecs-clusters-tbody');
        tbody.innerHTML = (data.clusters||[]).map(c => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('ecs-cluster-name').value='${escHtml(c.name)}'">${escHtml(c.name)}</td>
          <td>
            <button class="btn btn-secondary" onclick="Portal.ecs.listServices('${escHtml(c.name)}')" style="padding:2px 8px;font-size:10px">SERVICES</button>
            <button class="btn btn-secondary" onclick="Portal.ecs.listTasks('${escHtml(c.name)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">TASKS</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="2" style="color:var(--text3);text-align:center">No clusters</td></tr>';
        toast(`${(data.clusters||[]).length} clusters`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async listServices(cluster) {
      try {
        const data = await api('GET', `/api/ecs/clusters/${encodeURIComponent(cluster)}/services`);
        const txt = (data.services||[]).map(s => `${s.name} | desired:${s.desired} running:${s.running} | ${s.status}`).join('\n');
        showOutput('ecs-output', txt || 'No services');
        toast(`${(data.services||[]).length} services`, 'info');
      } catch(err) { showOutput('ecs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listTasks(cluster) {
      try {
        const data = await api('GET', `/api/ecs/clusters/${encodeURIComponent(cluster)}/tasks`);
        const txt = (data.tasks||[]).map(t => `${t.arn?.split('/').pop()} | ${t.status} | ${t.launchType}`).join('\n');
        showOutput('ecs-output', txt || 'No tasks');
        toast(`${(data.tasks||[]).length} tasks`, 'info');
      } catch(err) { showOutput('ecs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async registerTaskDef() {
      const body = { family: document.getElementById('ecs-family').value, image: document.getElementById('ecs-image').value, cpu: document.getElementById('ecs-cpu').value, memory: document.getElementById('ecs-memory').value, containerPort: parseInt(document.getElementById('ecs-port').value) };
      if (!body.family || !body.image) return toast('Family and image required', 'error');
      log(`[ECS] Registering task definition ${body.family}...`, 'cmd');
      try {
        const data = await api('POST', '/api/ecs/task-def', body);
        showOutput('ecs-output', `✓ Task definition registered!\nARN: ${data.taskDefinition}\nRevision: ${data.revision}`);
        document.getElementById('ecs-task-def').value = `${body.family}:${data.revision}`;
        toast('Task definition registered!', 'success');
      } catch(err) { showOutput('ecs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async runTask() {
      const body = { cluster: document.getElementById('ecs-cluster-name').value, taskDefinition: document.getElementById('ecs-task-def').value, subnets: document.getElementById('ecs-subnets').value.split(',').map(s=>s.trim()).filter(Boolean) };
      if (!body.cluster || !body.taskDefinition) return toast('Cluster and task definition required', 'error');
      log(`[ECS] Running task ${body.taskDefinition}...`, 'cmd');
      try {
        const data = await api('POST', '/api/ecs/run-task', body);
        showOutput('ecs-output', `✓ Task running!\n${(data.tasks||[]).map(t=>`ARN: ${t.arn}\nStatus: ${t.status}`).join('\n')}`);
        toast('Task started!', 'success');
      } catch(err) { showOutput('ecs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async scale() {
      const body = { cluster: document.getElementById('ecs-cluster-name').value, service: document.getElementById('ecs-service-name').value, desiredCount: parseInt(document.getElementById('ecs-desired-count').value) };
      if (!body.cluster || !body.service) return toast('Cluster and service required', 'error');
      try {
        const data = await api('POST', '/api/ecs/scale', body);
        showOutput('ecs-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('ecs-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== STEP FUNCTIONS =====
  const stepfn = {
    async list() {
      log('[STEPFN] Listing state machines...', 'cmd');
      try {
        const data = await api('GET', '/api/stepfn/machines');
        const tbody = document.getElementById('stepfn-machines-tbody');
        tbody.innerHTML = (data.stateMachines||[]).map(m => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('stepfn-arn').value='${escHtml(m.arn)}'">${escHtml(m.name)}</td>
          <td><span class="badge badge-blue">${escHtml(m.type||'')}</span></td>
          <td style="color:var(--text3)">${m.created?new Date(m.created).toLocaleDateString():'—'}</td>
          <td>
            <button class="btn btn-primary" onclick="document.getElementById('stepfn-arn').value='${escHtml(m.arn)}'" style="padding:2px 8px;font-size:10px">SELECT</button>
            <button class="btn btn-secondary" onclick="Portal.stepfn.listExecsByArn('${escHtml(m.arn)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">RUNS</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4" style="color:var(--text3);text-align:center">No state machines</td></tr>';
        toast(`${(data.stateMachines||[]).length} state machines`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async execute() {
      clearOutput('stepfn-output');
      const arn = document.getElementById('stepfn-arn').value;
      let input = {};
      try { input = JSON.parse(document.getElementById('stepfn-input').value || '{}'); } catch(e) { return toast('Invalid JSON input', 'error'); }
      if (!arn) return toast('State machine ARN required', 'error');
      log('[STEPFN] Starting execution...', 'cmd');
      try {
        const data = await api('POST', '/api/stepfn/execute', { stateMachineArn: arn, input });
        showOutput('stepfn-output', `✓ Execution started!\nARN: ${data.executionArn}\nStarted: ${data.startDate}`);
        toast('Execution started!', 'success');
      } catch(err) { showOutput('stepfn-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listExecutions() {
      const arn = document.getElementById('stepfn-arn').value;
      if (!arn) return toast('State machine ARN required', 'error');
      await this.listExecsByArn(arn);
    },
    async listExecsByArn(arn) {
      try {
        const data = await api('GET', `/api/stepfn/executions?stateMachineArn=${encodeURIComponent(arn)}`);
        const txt = (data.executions||[]).map(e => `${e.name} | ${e.status} | ${e.startDate?new Date(e.startDate).toLocaleString():'—'}`).join('\n');
        showOutput('stepfn-output', txt || 'No executions');
        toast(`${(data.executions||[]).length} executions`, 'info');
      } catch(err) { showOutput('stepfn-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== EVENTBRIDGE =====
  const events = {
    async listRules() {
      log('[EVENTS] Listing rules...', 'cmd');
      try {
        const data = await api('GET', '/api/events/rules');
        const tbody = document.getElementById('eb-rules-tbody');
        tbody.innerHTML = (data.rules||[]).map(r => `<tr>
          <td style="color:var(--blue)">${escHtml(r.name)}</td>
          <td><span class="badge badge-${r.state==='ENABLED'?'green':'red'}">${escHtml(r.state||'')}</span></td>
          <td style="color:var(--text3)">${escHtml(r.schedule||r.eventPattern||'—')}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No rules</td></tr>';
        toast(`${(data.rules||[]).length} rules`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async createRule() {
      clearOutput('eb-output');
      const body = { ruleName: document.getElementById('eb-rule-name').value, schedule: document.getElementById('eb-schedule').value || undefined, eventPattern: document.getElementById('eb-pattern').value || undefined, targetArn: document.getElementById('eb-target-arn').value };
      if (!body.ruleName || !body.targetArn) return toast('Rule name and target ARN required', 'error');
      log(`[EVENTS] Creating rule ${body.ruleName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/events/rules', body);
        showOutput('eb-output', `✓ Rule created!\nARN: ${data.ruleArn}`);
        toast('EventBridge rule created!', 'success');
      } catch(err) { showOutput('eb-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async putEvent() {
      const body = { source: document.getElementById('eb-event-source').value, detailType: document.getElementById('eb-detail-type').value, detail: document.getElementById('eb-detail').value };
      if (!body.source || !body.detailType || !body.detail) return toast('Source, detail type, and detail required', 'error');
      try {
        const data = await api('POST', '/api/events/put', body);
        showOutput('eb-output', `✓ Event published!\nFailed entries: ${data.failedCount}`);
        toast('Event published!', 'success');
      } catch(err) { showOutput('eb-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== KINESIS =====
  const kinesis = {
    async list() {
      log('[KINESIS] Listing streams...', 'cmd');
      try {
        const data = await api('GET', '/api/kinesis/streams');
        const tbody = document.getElementById('kinesis-streams-tbody');
        tbody.innerHTML = (data.streams||[]).map(s => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('kinesis-put-stream').value='${escHtml(s)}'">${escHtml(s)}</td>
          <td><button class="btn btn-secondary" onclick="Portal.kinesis.describe('${escHtml(s)}')" style="padding:2px 8px;font-size:10px">DESCRIBE</button></td>
        </tr>`).join('') || '<tr><td colspan="2" style="color:var(--text3);text-align:center">No streams</td></tr>';
        toast(`${(data.streams||[]).length} streams`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async create() {
      clearOutput('kinesis-output');
      const body = { streamName: document.getElementById('kinesis-stream-name').value, shardCount: parseInt(document.getElementById('kinesis-shards').value) };
      if (!body.streamName) return toast('Stream name required', 'error');
      log(`[KINESIS] Creating stream ${body.streamName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/kinesis/streams', body);
        showOutput('kinesis-output', `✓ ${data.message}`);
        toast(data.message, 'success');
        this.list();
      } catch(err) { showOutput('kinesis-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async put() {
      clearOutput('kinesis-output');
      const body = { streamName: document.getElementById('kinesis-put-stream').value, data: document.getElementById('kinesis-data').value, partitionKey: document.getElementById('kinesis-partition-key').value };
      if (!body.streamName || !body.data) return toast('Stream name and data required', 'error');
      log(`[KINESIS] Putting record to ${body.streamName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/kinesis/put', body);
        showOutput('kinesis-output', `✓ Record sent!\nShard: ${data.shardId}\nSequence: ${data.sequenceNumber}`);
        toast('Record published!', 'success');
      } catch(err) { showOutput('kinesis-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async describe(streamName) {
      try {
        const data = await api('GET', `/api/kinesis/streams/${encodeURIComponent(streamName)}`);
        showOutput('kinesis-output', `Stream: ${data.name}\nStatus: ${data.status}\nShards: ${data.shards}\nRetention: ${data.retentionHours}h\nARN: ${data.arn}`);
      } catch(err) { showOutput('kinesis-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== WAF =====
  const waf = {
    async listAcls() {
      log('[WAF] Listing Web ACLs...', 'cmd');
      try {
        const scope = document.getElementById('waf-scope')?.value || 'REGIONAL';
        const data = await api('GET', `/api/waf/acls?scope=${scope}`);
        const tbody = document.getElementById('waf-acls-tbody');
        tbody.innerHTML = (data.webAcls||[]).map(a => `<tr>
          <td style="color:var(--blue)">${escHtml(a.name)}</td>
          <td style="color:var(--text3);font-size:11px">${escHtml(a.id)}</td>
          <td><button class="btn btn-secondary" onclick="document.getElementById('waf-acl-arn').value='${escHtml(a.arn)}'" style="padding:2px 8px;font-size:10px">SELECT</button></td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No ACLs</td></tr>';
        toast(`${(data.webAcls||[]).length} Web ACLs`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async createIpSet() {
      clearOutput('waf-output');
      const ips = document.getElementById('waf-ips').value.split('\n').map(s=>s.trim()).filter(Boolean);
      const body = { name: document.getElementById('waf-ipset-name').value, addresses: ips, scope: document.getElementById('waf-scope').value };
      if (!body.name || !ips.length) return toast('Name and IP addresses required', 'error');
      log(`[WAF] Creating IP set ${body.name}...`, 'cmd');
      try {
        const data = await api('POST', '/api/waf/ip-sets', body);
        showOutput('waf-output', `✓ IP Set created!\nID: ${data.id}\nARN: ${data.arn}`);
        toast('IP Set created!', 'success');
      } catch(err) { showOutput('waf-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async associate() {
      clearOutput('waf-output');
      const body = { webAclArn: document.getElementById('waf-acl-arn').value, resourceArn: document.getElementById('waf-resource-arn').value };
      if (!body.webAclArn || !body.resourceArn) return toast('WAF ACL ARN and resource ARN required', 'error');
      try {
        const data = await api('POST', '/api/waf/associate', body);
        showOutput('waf-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('waf-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== BACKUP =====
  const backup = {
    async create() {
      clearOutput('backup-output');
      const body = { planName: document.getElementById('backup-plan-name').value, scheduleExpression: document.getElementById('backup-schedule').value, deleteAfterDays: parseInt(document.getElementById('backup-retention').value) };
      if (!body.planName) return toast('Plan name required', 'error');
      log(`[BACKUP] Creating plan ${body.planName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/backup/plans', body);
        showOutput('backup-output', `✓ Backup plan created!\nPlan ID: ${data.planId}`);
        toast('Backup plan created!', 'success');
        this.listPlans();
      } catch(err) { showOutput('backup-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async startNow() {
      clearOutput('backup-output');
      const body = { resourceArn: document.getElementById('backup-resource-arn').value };
      if (!body.resourceArn) return toast('Resource ARN required', 'error');
      log('[BACKUP] Starting on-demand backup...', 'cmd');
      try {
        const data = await api('POST', '/api/backup/start', body);
        showOutput('backup-output', `✓ Backup started!\nJob ID: ${data.jobId}`);
        toast('Backup started!', 'success');
      } catch(err) { showOutput('backup-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listPlans() {
      log('[BACKUP] Listing plans...', 'cmd');
      try {
        const data = await api('GET', '/api/backup/plans');
        const tbody = document.getElementById('backup-list-tbody');
        tbody.innerHTML = (data.plans||[]).map(p => `<tr>
          <td style="color:var(--blue)">${escHtml(p.name)}</td>
          <td><span class="badge badge-green">PLAN</span></td>
          <td style="color:var(--text3)">${p.created?new Date(p.created).toLocaleDateString():'—'}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No plans</td></tr>';
        toast(`${(data.plans||[]).length} plans`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async listJobs() {
      log('[BACKUP] Listing jobs...', 'cmd');
      try {
        const data = await api('GET', '/api/backup/jobs');
        const tbody = document.getElementById('backup-list-tbody');
        tbody.innerHTML = (data.jobs||[]).map(j => `<tr>
          <td style="color:var(--text2);font-size:11px">${escHtml((j.id||'').substring(0,20)+'...')}</td>
          <td><span class="badge badge-${j.status==='COMPLETED'?'green':j.status==='FAILED'?'red':'yellow'}">${escHtml(j.status||'')}</span></td>
          <td style="color:var(--text3)">${j.created?new Date(j.created).toLocaleDateString():'—'}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No jobs</td></tr>';
        toast(`${(data.jobs||[]).length} backup jobs`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== AWS CONFIG =====
  const awsconfig = {
    async compliance() {
      log('[CONFIG] Loading compliance data...', 'cmd');
      try {
        const data = await api('GET', '/api/awsconfig/compliance');
        document.getElementById('awsconfig-summary').style.display = 'block';
        document.getElementById('awsconfig-compliant').textContent = data.summary?.compliant ?? '—';
        document.getElementById('awsconfig-noncompliant').textContent = data.summary?.nonCompliant ?? '—';
        document.getElementById('awsconfig-total').textContent = data.summary?.total ?? '—';
        const tbody = document.getElementById('awsconfig-tbody');
        tbody.innerHTML = (data.rules||[]).map(r => `<tr>
          <td style="color:var(--text)">${escHtml(r.name)}</td>
          <td><span class="badge badge-${r.compliance==='COMPLIANT'?'green':r.compliance==='NON_COMPLIANT'?'red':'yellow'}">${escHtml(r.compliance||'—')}</span></td>
          <td style="color:var(--text3)">—</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No rules</td></tr>';
        toast(`${data.summary?.total||0} rules checked`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async listRules() {
      log('[CONFIG] Listing config rules...', 'cmd');
      try {
        const data = await api('GET', '/api/awsconfig/rules');
        const tbody = document.getElementById('awsconfig-tbody');
        tbody.innerHTML = (data.rules||[]).map(r => `<tr>
          <td style="color:var(--text)">${escHtml(r.name)}</td>
          <td><span class="badge badge-${r.state==='ACTIVE'?'green':'yellow'}">${escHtml(r.state||'—')}</span></td>
          <td style="color:var(--text3)">${escHtml(r.source||'—')}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No rules</td></tr>';
        toast(`${(data.rules||[]).length} rules`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    }
  };

  // ===== API GATEWAY =====
  const apigw = {
    async listApis() {
      log('[APIGW] Listing REST APIs...', 'cmd');
      try {
        const data = await api('GET', '/api/apigw/apis');
        const tbody = document.getElementById('apigw-apis-tbody');
        tbody.innerHTML = (data.apis||[]).map(a => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="document.getElementById('apigw-api-id').value='${escHtml(a.id)}'">${escHtml(a.name)}</td>
          <td style="color:var(--text3)">${escHtml(a.id)}</td>
          <td><span class="badge badge-blue">${escHtml(a.endpointType||'')}</span></td>
          <td style="color:var(--text3)">${a.created?new Date(a.created).toLocaleDateString():'—'}</td>
          <td><button class="btn btn-secondary" onclick="Portal.apigw.listStages('${escHtml(a.id)}')" style="padding:2px 8px;font-size:10px">STAGES</button></td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text3);text-align:center">No APIs</td></tr>';
        toast(`${(data.apis||[]).length} APIs`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async listStages(apiId) {
      try {
        const data = await api('GET', `/api/apigw/apis/${encodeURIComponent(apiId)}/stages`);
        showOutput('apigw-output', (data.stages||[]).map(s => `${s.name} → ${s.invokeUrl}`).join('\n') || 'No stages');
      } catch(err) { showOutput('apigw-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async deploy() {
      clearOutput('apigw-output');
      const body = { restApiId: document.getElementById('apigw-api-id').value, stageName: document.getElementById('apigw-stage-name').value, description: document.getElementById('apigw-deploy-desc').value };
      if (!body.restApiId || !body.stageName) return toast('API ID and stage name required', 'error');
      log(`[APIGW] Deploying API ${body.restApiId} to ${body.stageName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/apigw/deploy', body);
        showOutput('apigw-output', `✓ API deployed!\nDeployment ID: ${data.deploymentId}\nURL: ${data.invokeUrl}`);
        toast('API deployed!', 'success');
      } catch(err) { showOutput('apigw-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listKeys() {
      try {
        const data = await api('GET', '/api/apigw/keys');
        const tbody = document.getElementById('apigw-keys-tbody');
        tbody.innerHTML = (data.keys||[]).map(k => `<tr>
          <td style="color:var(--text)">${escHtml(k.name)}</td>
          <td><span class="badge badge-${k.enabled?'green':'red'}">${k.enabled?'Yes':'No'}</span></td>
          <td style="color:var(--text3)">${k.created?new Date(k.created).toLocaleDateString():'—'}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No API keys</td></tr>';
        toast(`${(data.keys||[]).length} keys`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async createKey() {
      const name = document.getElementById('apigw-key-name').value;
      if (!name) return toast('Key name required', 'error');
      try {
        const data = await api('POST', '/api/apigw/keys', { name });
        showOutput('apigw-output', `✓ API Key created!\nID: ${data.id}\nValue: ${data.value}`);
        toast('API Key created!', 'success');
        this.listKeys();
      } catch(err) { showOutput('apigw-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== OPENSEARCH =====
  const opensearch = {
    async list() {
      log('[OPENSEARCH] Listing domains...', 'cmd');
      try {
        const data = await api('GET', '/api/opensearch/domains');
        const tbody = document.getElementById('os-domains-tbody');
        tbody.innerHTML = (data.domains||[]).map(d => `<tr>
          <td style="color:var(--blue)">${escHtml(d.name)}</td>
          <td style="color:var(--text3)">${escHtml(d.engineType||'')}</td>
          <td>
            <button class="btn btn-secondary" onclick="Portal.opensearch.describe('${escHtml(d.name)}')" style="padding:2px 8px;font-size:10px">DESCRIBE</button>
            <button class="btn btn-danger" onclick="Portal.opensearch.deleteDomain('${escHtml(d.name)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">DELETE</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No domains</td></tr>';
        toast(`${(data.domains||[]).length} domains`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async create() {
      clearOutput('os-output');
      const body = { domainName: document.getElementById('os-domain-name').value, engineVersion: document.getElementById('os-engine-version').value, instanceType: document.getElementById('os-instance-type').value, ebsVolumeSize: parseInt(document.getElementById('os-ebs-size').value) };
      if (!body.domainName) return toast('Domain name required', 'error');
      log(`[OPENSEARCH] Creating domain ${body.domainName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/opensearch/create', body);
        showOutput('os-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('os-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async describe(name) {
      try {
        const data = await api('GET', `/api/opensearch/domains/${encodeURIComponent(name)}`);
        const d = data.domain;
        showOutput('os-output', `Domain: ${d.name}\nEndpoint: ${d.endpoint||'(provisioning)'}\nEngine: ${d.engineVersion}\nStatus: ${d.processing?'Processing':'Active'}\nInstance: ${d.instanceType} x${d.instanceCount}\nARN: ${d.arn}`);
      } catch(err) { showOutput('os-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async deleteDomain(name) {
      if (!confirm(`Delete OpenSearch domain "${name}"?`)) return;
      try {
        const data = await api('POST', '/api/opensearch/delete', { domainName: name });
        showOutput('os-output', `✓ ${data.message}`);
        toast(data.message, 'success');
        this.list();
      } catch(err) { showOutput('os-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== GLUE =====
  const glue = {
    async listDatabases() {
      log('[GLUE] Listing databases...', 'cmd');
      try {
        const data = await api('GET', '/api/glue/databases');
        const tbody = document.getElementById('glue-databases-tbody');
        tbody.innerHTML = (data.databases||[]).map(d => `<tr>
          <td style="color:var(--blue);cursor:pointer" onclick="Portal.glue.listTables('${escHtml(d.name)}')">${escHtml(d.name)}</td>
          <td style="color:var(--text3)">${escHtml(d.description||'—')}</td>
          <td><button class="btn btn-secondary" onclick="Portal.glue.listTables('${escHtml(d.name)}')" style="padding:2px 8px;font-size:10px">TABLES</button></td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No databases</td></tr>';
        toast(`${(data.databases||[]).length} databases`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async listTables(dbName) {
      try {
        const data = await api('GET', `/api/glue/databases/${encodeURIComponent(dbName)}/tables`);
        showOutput('glue-tables-output', (data.tables||[]).map(t => `${t.name} | ${t.type||'TABLE'} | ${t.columns} cols | ${t.location||'—'}`).join('\n') || 'No tables');
        toast(`${(data.tables||[]).length} tables in ${dbName}`, 'info');
      } catch(err) { showOutput('glue-tables-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async listJobs() {
      log('[GLUE] Listing jobs...', 'cmd');
      try {
        const data = await api('GET', '/api/glue/jobs');
        const tbody = document.getElementById('glue-jobs-tbody');
        tbody.innerHTML = (data.jobs||[]).map(j => `<tr>
          <td style="color:var(--blue)">${escHtml(j.name)}</td>
          <td><span class="badge badge-blue">JOB</span></td>
          <td>
            <button class="btn btn-primary" onclick="Portal.glue.runJob('${escHtml(j.name)}')" style="padding:2px 8px;font-size:10px">RUN</button>
            <button class="btn btn-secondary" onclick="Portal.glue.getJobRuns('${escHtml(j.name)}')" style="padding:2px 8px;font-size:10px;margin-left:4px">RUNS</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No jobs</td></tr>';
        toast(`${(data.jobs||[]).length} jobs`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async listCrawlers() {
      log('[GLUE] Listing crawlers...', 'cmd');
      try {
        const data = await api('GET', '/api/glue/crawlers');
        const tbody = document.getElementById('glue-jobs-tbody');
        tbody.innerHTML = (data.crawlers||[]).map(c => `<tr>
          <td style="color:var(--blue)">${escHtml(c.name)}</td>
          <td><span class="badge badge-yellow">CRAWLER</span></td>
          <td><button class="btn btn-primary" onclick="Portal.glue.startCrawler('${escHtml(c.name)}')" style="padding:2px 8px;font-size:10px">START</button></td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text3);text-align:center">No crawlers</td></tr>';
        toast(`${(data.crawlers||[]).length} crawlers`, 'info');
      } catch(err) { toast(err.message, 'error'); }
    },
    async runJob(jobName) {
      log(`[GLUE] Running job ${jobName}...`, 'cmd');
      try {
        const data = await api('POST', '/api/glue/jobs/run', { jobName });
        showOutput('glue-run-output', `✓ Job started!\nJob: ${data.jobName}\nRun ID: ${data.jobRunId}`);
        toast(`Job ${jobName} started!`, 'success');
      } catch(err) { showOutput('glue-run-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async getJobRuns(jobName) {
      try {
        const data = await api('GET', `/api/glue/jobs/${encodeURIComponent(jobName)}/runs`);
        showOutput('glue-run-output', (data.runs||[]).map(r => `${r.id} | ${r.status} | ${r.started?new Date(r.started).toLocaleString():'—'} | ${r.duration||'—'}s`).join('\n') || 'No runs');
        toast(`${(data.runs||[]).length} runs`, 'info');
      } catch(err) { showOutput('glue-run-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    },
    async startCrawler(crawlerName) {
      try {
        const data = await api('POST', '/api/glue/crawlers/start', { crawlerName });
        showOutput('glue-run-output', `✓ ${data.message}`);
        toast(data.message, 'success');
      } catch(err) { showOutput('glue-run-output', `Error: ${err.message}`); toast(err.message, 'error'); }
    }
  };

  // ===== EC2 PACKAGE MANAGER =====
  const ec2pkg = {
    selected: new Set(),

    toggleAuth() {
      const method = document.getElementById('pkg-auth-method').value;
      document.getElementById('pkg-key-group').style.display = method === 'key' ? 'block' : 'none';
      document.getElementById('pkg-pass-group').style.display = method === 'password' ? 'block' : 'none';
    },

    // Copy connection info from the main Shell tab
    syncFromTerminal() {
      const host = document.getElementById('ssh-host')?.value;
      const user = document.getElementById('ssh-user')?.value;
      const port = document.getElementById('ssh-port')?.value;
      const key = document.getElementById('ssh-key')?.value;
      const pass = document.getElementById('ssh-pass')?.value;
      if (host) document.getElementById('pkg-ssh-host').value = host;
      if (user) document.getElementById('pkg-ssh-user').value = user;
      if (port) document.getElementById('pkg-ssh-port').value = port;
      if (key) document.getElementById('pkg-ssh-key').value = key;
      if (pass) document.getElementById('pkg-ssh-pass').value = pass;
      toast('Credentials synced from Shell tab', 'success');
    },

    _getConn() {
      const host = document.getElementById('pkg-ssh-host').value.trim();
      const username = document.getElementById('pkg-ssh-user').value.trim();
      const port = document.getElementById('pkg-ssh-port').value;
      const method = document.getElementById('pkg-auth-method').value;
      if (!host) { toast('EC2 hostname required', 'error'); return null; }
      const conn = { host, username, port: parseInt(port) };
      if (method === 'key') {
        conn.privateKey = document.getElementById('pkg-ssh-key').value;
        if (!conn.privateKey) { toast('PEM key required', 'error'); return null; }
      } else {
        conn.password = document.getElementById('pkg-ssh-pass').value;
      }
      return conn;
    },

    _showOutput(text, append = false) {
      const panel = document.getElementById('pkg-output-panel');
      const out = document.getElementById('pkg-output');
      panel.style.display = 'block';
      if (append) {
        out.textContent += text + '\n';
      } else {
        out.textContent = text;
      }
      out.scrollTop = out.scrollHeight;
    },

    async install(packageId) {
      const conn = this._getConn();
      if (!conn) return;
      this._showOutput(`[STARTING] Installing: ${packageId}\n`);
      log(`[EC2PKG] Installing ${packageId} on ${conn.host}...`, 'cmd');
      try {
        const res = await api('POST', '/api/ec2-packages/install', { packageId, ...conn }, true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
                  this._showOutput(payload.line, true);
                  const lt = payload.line.includes('[SUCCESS]') || payload.line.includes('[DONE]') ? 'success'
                    : payload.line.includes('[ERROR]') ? 'error'
                    : payload.line.includes('[WARN]') ? 'warn'
                    : payload.line.startsWith('[JOB:') ? 'cmd' : 'info';
                  log(payload.line, lt);
                }
                if (payload.done) {
                  const msg = payload.exitCode === 0 ? `✓ ${packageId} installed!` : `✗ ${packageId} failed (exit ${payload.exitCode})`;
                  this._showOutput(msg, true);
                  toast(msg, payload.exitCode === 0 ? 'success' : 'error');
                }
              } catch(e) {}
            }
          }
        }
      } catch(err) {
        this._showOutput(`Error: ${err.message}`);
        toast(err.message, 'error');
      }
    },

    async installSelected() {
      if (this.selected.size === 0) { toast('No packages selected', 'error'); return; }
      const conn = this._getConn();
      if (!conn) return;
      const packageIds = Array.from(this.selected);
      this._showOutput(`[BATCH] Installing ${packageIds.length} packages: ${packageIds.join(', ')}\n`);
      log(`[EC2PKG] Batch installing ${packageIds.length} packages on ${conn.host}...`, 'cmd');
      try {
        const res = await api('POST', '/api/ec2-packages/install-many', { packageIds, ...conn }, true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
                  this._showOutput(payload.line, true);
                  log(payload.line, payload.line.includes('[SUCCESS]') || payload.line.includes('[DONE]') ? 'success' : payload.line.includes('[ERROR]') ? 'error' : 'info');
                }
                if (payload.done) {
                  const msg = payload.exitCode === 0 ? `✓ Batch install complete!` : `✗ Batch install failed`;
                  this._showOutput(msg, true);
                  toast(msg, payload.exitCode === 0 ? 'success' : 'error');
                }
              } catch(e) {}
            }
          }
        }
      } catch(err) {
        this._showOutput(`Error: ${err.message}`);
        toast(err.message, 'error');
      }
    },

    async checkInstalled() {
      const conn = this._getConn();
      if (!conn) return;
      this._showOutput('[CHECKING] Scanning installed tools on remote EC2...\n');
      log(`[EC2PKG] Checking installed tools on ${conn.host}...`, 'cmd');
      try {
        const res = await api('POST', '/api/ec2-packages/check', conn, true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
                  this._showOutput(payload.line, true);
                  // Visually mark cards as installed
                  if (payload.line.startsWith('✓ ')) {
                    const toolName = payload.line.split('✓ ')[1].split(':')[0].trim();
                    this._markInstalled(toolName);
                  }
                }
                if (payload.done) toast('Check complete!', 'success');
              } catch(e) {}
            }
          }
        }
      } catch(err) {
        this._showOutput(`Error: ${err.message}`);
        toast(err.message, 'error');
      }
    },

    _markInstalled(toolName) {
      // Map tool names to package IDs
      const toolMap = {
        'git': 'git', 'node': 'nodejs', 'docker': 'docker', 'kubectl': 'kubectl',
        'helm': 'helm', 'terraform': 'terraform', 'ansible': 'ansible',
        'aws': 'awscli', 'eksctl': 'eksctl', 'nginx': 'nginx', 'redis-server': 'redis',
        'mongod': 'mongodb', 'psql': 'postgresql', 'mysql': 'mysql',
        'jenkins': 'jenkins', 'argocd': 'argocd-cli', 'flux': 'fluxcd',
        'k9s': 'k9s', 'istioctl': 'istio', 'velero': 'velero', 'trivy': 'trivy',
        'certbot': 'certbot', 'kustomize': 'kustomize', 'opa': 'open-policy-agent', 'tkn': 'tekton-cli'
      };
      const pkgId = toolMap[toolName];
      if (pkgId) {
        const card = document.querySelector(`.pkg-card[data-pkg="${pkgId}"]`);
        if (card) {
          const btn = card.querySelector('.pkg-btn');
          if (btn) { btn.textContent = '✓ INSTALLED'; btn.style.background = 'rgba(0,255,136,0.2)'; btn.style.color = 'var(--green)'; btn.style.cursor = 'default'; }
        }
      }
    },

    toggleSelect(pkgId) {
      const card = document.querySelector(`.pkg-card[data-pkg="${pkgId}"]`);
      if (this.selected.has(pkgId)) {
        this.selected.delete(pkgId);
        card?.classList.remove('selected');
      } else {
        this.selected.add(pkgId);
        card?.classList.add('selected');
      }
      this._updateSelectedUI();
    },

    selectCategory(category) {
      document.querySelectorAll(`.pkg-card`).forEach(card => {
        const pkgId = card.dataset.pkg;
        if (!pkgId) return;
        // Find which category this pkg belongs to by checking if it's in the same panel
        const panel = card.closest('.panel');
        const panelTitle = panel?.querySelector('.panel-title')?.textContent?.toLowerCase() || '';
        const catMap = { core: 'core tools', runtime: 'runtimes', containers: 'containers', iac: 'infrastructure as code', cicd: 'ci/cd', cloud: 'cloud', observability: 'observability', security: 'security', database: 'databases', cncf: 'cncf' };
        const expectedTitle = catMap[category] || '';
        if (panelTitle.includes(expectedTitle.split(' ')[0].toLowerCase())) {
          this.selected.add(pkgId);
          card.classList.add('selected');
        }
      });
      this._updateSelectedUI();
      toast(`Category "${category}" selected`, 'info');
    },

    clearSelected() {
      this.selected.clear();
      document.querySelectorAll('.pkg-card.selected').forEach(c => c.classList.remove('selected'));
      this._updateSelectedUI();
    },

    _updateSelectedUI() {
      const badgesEl = document.getElementById('pkg-selected-badges');
      const clearBtn = document.getElementById('pkg-clear-btn');
      const installBtn = document.getElementById('pkg-install-selected-btn');
      if (!badgesEl) return;
      badgesEl.innerHTML = Array.from(this.selected).map(id => `<span class="badge badge-green" style="cursor:pointer" onclick="Portal.ec2pkg.toggleSelect('${escHtml(id)}')">${escHtml(id)} ✕</span>`).join('');
      const hasSelected = this.selected.size > 0;
      if (clearBtn) clearBtn.style.display = hasSelected ? 'inline-flex' : 'none';
      if (installBtn) { installBtn.style.display = hasSelected ? 'inline-flex' : 'none'; installBtn.textContent = `▶ INSTALL ${this.selected.size} PACKAGES`; }
    }
  };

  // ===== CNCF LAB =====
  const cncflab = {
    istioSteps: [],
    cncfTools: [],
    currentTool: null,

    showSection(section) {
      document.getElementById('cncf-istio-section').style.display = 'none';
      document.getElementById('cncf-tools-section').style.display = 'none';
      if (section === 'istio') {
        document.getElementById('cncf-istio-section').style.display = 'block';
        this.loadIstioSteps();
      } else if (section === 'tools') {
        document.getElementById('cncf-tools-section').style.display = 'block';
        this.loadTools();
      }
    },

    async loadIstioSteps() {
      if (this.istioSteps.length > 0) { this.renderIstioSteps(); return; }
      try {
        const data = await api('GET', '/api/cncf-lab/istio/steps');
        this.istioSteps = data.steps || [];
        this.renderIstioSteps();
      } catch(err) { toast(err.message, 'error'); }
    },

    renderIstioSteps() {
      const container = document.getElementById('istio-steps-list');
      if (!container) return;
      container.innerHTML = this.istioSteps.map(step => `
        <div class="panel" style="margin-bottom:12px;border-left:3px solid var(--blue)">
          <div class="panel-header" style="cursor:pointer" onclick="Portal.cncflab.toggleIstioStep('${step.id}')">
            <div class="panel-title">
              <span style="background:var(--blue);color:var(--bg);padding:2px 8px;border-radius:2px;font-size:11px;margin-right:8px">${step.step}</span>
              ${escHtml(step.title)}
            </div>
            <button class="btn btn-primary" onclick="event.stopPropagation();Portal.cncflab.applyIstioStep('${step.id}')" style="padding:4px 12px;font-size:10px">▶ APPLY</button>
          </div>
          <div id="istio-step-detail-${step.id}" style="display:none">
            <div class="panel-body" style="padding:12px 16px">
              <p style="color:var(--text2);font-size:12px;margin-bottom:12px">${escHtml(step.description)}</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div>
                  <div style="font-size:10px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">ARCHITECTURE CHANGE</div>
                  <pre style="font-size:10px;line-height:1.5;color:var(--green);background:var(--bg);border:1px solid var(--border);padding:10px;overflow-x:auto">${escHtml(step.architecture || '')}</pre>
                </div>
                <div>
                  <div style="font-size:10px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">IMPACT</div>
                  <div style="background:rgba(255,204,0,0.05);border:1px solid rgba(255,204,0,0.3);padding:10px;font-size:11px;color:var(--yellow);line-height:1.6;border-radius:4px">${escHtml(step.impact || '')}</div>
                  ${step.hasManifest ? `<button class="btn btn-secondary" onclick="Portal.cncflab.showManifest('${step.id}')" style="margin-top:8px;padding:4px 10px;font-size:10px">VIEW MANIFEST</button>` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>`).join('');
    },

    toggleIstioStep(id) {
      const el = document.getElementById(`istio-step-detail-${id}`);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    },

    async showManifest(stepId) {
      try {
        const data = await api('GET', `/api/cncf-lab/istio/steps/${stepId}`);
        if (data.manifest) {
          const panel = document.getElementById('cncf-output-panel');
          const out = document.getElementById('cncf-output');
          const title = document.getElementById('cncf-output-title');
          title.textContent = `Manifest: ${data.title}`;
          out.textContent = data.manifest;
          panel.style.display = 'block';
          panel.scrollIntoView({ behavior: 'smooth' });
        }
      } catch(err) { toast(err.message, 'error'); }
    },

    async applyIstioStep(stepId) {
      const panel = document.getElementById('cncf-output-panel');
      const out = document.getElementById('cncf-output');
      const title = document.getElementById('cncf-output-title');
      const step = this.istioSteps.find(s => s.id === stepId);
      title.textContent = `Step ${step?.step}: ${step?.title || stepId}`;
      out.textContent = `[STARTING] Applying step: ${stepId}\n`;
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth' });
      log(`[CNCF-LAB] Applying Istio step: ${stepId}`, 'cmd');
      try {
        const res = await api('POST', `/api/cncf-lab/istio/apply/${stepId}`, {}, true);
        await this._stream(res, out);
      } catch(err) { out.textContent += `\nError: ${err.message}`; toast(err.message, 'error'); }
    },

    async loadTools() {
      if (this.cncfTools.length > 0) { this.renderTools(); return; }
      try {
        const data = await api('GET', '/api/cncf-lab/tools');
        this.cncfTools = data.tools || [];
        this.renderTools();
      } catch(err) { toast(err.message, 'error'); }
    },

    renderTools() {
      const grid = document.getElementById('cncf-tools-grid');
      if (!grid) return;
      const icons = { argocd: '🐙', kyverno: '🛡', 'prometheus-grafana': '📊', keda: '⚡', falco: '🦅', 'opa-gatekeeper': '⚖', velero: '💾', crossplane: '🔗', tekton: '⚙', fluxcd: '🌊' };
      grid.innerHTML = this.cncfTools.map(tool => `
        <div class="resource-card" style="cursor:pointer" onclick="Portal.cncflab.selectTool('${tool.id}')">
          <div style="font-size:24px;margin-bottom:8px">${icons[tool.id] || '🔧'}</div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">${escHtml(tool.name.split('—')[0].trim())}</div>
          <div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:8px">${escHtml(tool.description)}</div>
          <div style="font-size:10px;color:var(--blue)">${tool.steps} guided steps →</div>
        </div>`).join('');
    },

    async selectTool(toolId) {
      this.currentTool = toolId;
      try {
        const data = await api('GET', `/api/cncf-lab/tools/${toolId}`);
        document.getElementById('cncf-tool-title').textContent = data.name;
        document.getElementById('cncf-tool-desc').textContent = data.description;
        const list = document.getElementById('cncf-tool-steps-list');
        list.innerHTML = (data.steps || []).map((step, i) => `
          <div class="panel" style="margin-bottom:12px;border-left:3px solid var(--green)">
            <div class="panel-header">
              <div class="panel-title">
                <span style="background:var(--green);color:var(--bg);padding:2px 8px;border-radius:2px;font-size:11px;margin-right:8px">${i + 1}</span>
                ${escHtml(step.title)}
              </div>
              <button class="btn btn-primary" onclick="Portal.cncflab.applyToolStep('${toolId}', '${step.id}')" style="padding:4px 12px;font-size:10px">▶ RUN</button>
            </div>
          </div>`).join('');
        document.getElementById('cncf-tool-steps-panel').style.display = 'block';
        document.getElementById('cncf-tool-steps-panel').scrollIntoView({ behavior: 'smooth' });
      } catch(err) { toast(err.message, 'error'); }
    },

    async applyToolStep(toolId, stepId) {
      const panel = document.getElementById('cncf-output-panel');
      const out = document.getElementById('cncf-output');
      const title = document.getElementById('cncf-output-title');
      title.textContent = `${toolId} → ${stepId}`;
      out.textContent = `[STARTING] ${toolId} / ${stepId}\n`;
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth' });
      log(`[CNCF-LAB] Running ${toolId}/${stepId}`, 'cmd');
      try {
        const res = await api('POST', `/api/cncf-lab/tools/${toolId}/steps/${stepId}`, {}, true);
        await this._stream(res, out);
      } catch(err) { out.textContent += `\nError: ${err.message}`; toast(err.message, 'error'); }
    },

    async _stream(response, outputEl) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
                outputEl.textContent += payload.line + '\n';
                outputEl.scrollTop = outputEl.scrollHeight;
                const lt = payload.line.includes('[OK]') || payload.line.includes('[DONE]') ? 'success'
                  : payload.line.includes('[ERROR]') ? 'error'
                  : payload.line.includes('[WARN]') ? 'warn'
                  : payload.line.startsWith('[CMD]') ? 'cmd' : 'info';
                log(payload.line, lt);
              }
              if (payload.done) {
                const msg = payload.exitCode === 0 ? '✓ Step completed!' : `✗ Step failed (exit ${payload.exitCode})`;
                outputEl.textContent += '\n' + msg;
                toast(msg, payload.exitCode === 0 ? 'success' : 'error');
              }
            } catch(e) {}
          }
        }
      }
    }
  };

  // ===== INFO PAGES =====
  const TAB_INFO = {
    home:{icon:'🏠',title:'Home Dashboard',desc:'Central hub. Enter IAM credentials to unlock all 50+ services. View live EC2, EKS, S3, ASG resource counts.',inputs:[{n:'AWS Access Key ID',t:'AKIA... (IAM user key)',r:true},{n:'AWS Secret Access Key',t:'40-char secret',r:true},{n:'Region',t:'us-east-1',r:true}],outputs:['EC2 table (ID, type, state, IPs)','EKS/S3/ASG counts'],steps:['Enter IAM credentials','Click SAVE CREDS','Click ↻ REFRESH','Click count cards to jump to service tab'],apis:['POST /api/credentials','GET /api/resources']},
    ec2:{icon:'⚡',title:'EC2 Terraform Provisioner',desc:'Provision EC2 via Terraform. Generates main.tf, runs init+apply, streams output. Idempotent.',inputs:[{n:'Instance Name',t:'my-ec2',r:true},{n:'Instance Type',t:'t3.micro/medium/large',r:true},{n:'AMI ID',t:'ami-0c55b159cbfafe1f0',r:true},{n:'Key Pair',t:'existing keypair name',r:false},{n:'VPC/Subnet/SG',t:'vpc-xxx/subnet-xxx/sg-xxx',r:false}],outputs:['Terraform streaming output','instance_id, public_ip, private_ip'],steps:['Set AWS credentials on Home tab','Fill instance details','Toggle Dry Run to plan only','Click DEPLOY EC2'],apis:['POST /api/terraform/ec2','POST /api/terraform/vpc']},
    eks:{icon:'☸',title:'EKS Cluster Deployer',desc:'Deploy managed EKS cluster via eksctl. Includes OIDC, managed node groups, kubeconfig update. ~15 min.',inputs:[{n:'Cluster Name',t:'my-cluster',r:true},{n:'K8s Version',t:'1.28 / 1.29',r:true},{n:'Node Type',t:'t3.medium',r:true},{n:'Min/Max/Desired',t:'1/5/2',r:true}],outputs:['eksctl streaming output','kubeconfig updated on server'],steps:['Set AWS credentials','Configure cluster settings','Click DEPLOY EKS','Use cluster ops buttons after deploy'],apis:['POST /api/eks/deploy']},
    asg:{icon:'⚖',title:'Auto Scaling Group Wizard',desc:'Create EC2 ASG with Launch Template and target-tracking CPU policy (70%). Idempotent — updates if exists.',inputs:[{n:'ASG Name',t:'my-asg',r:true},{n:'AMI ID',t:'ami-xxxxxxxx',r:true},{n:'Instance Type',t:'t3.small',r:true},{n:'Min/Max/Desired',t:'1/5/2',r:true},{n:'Subnet IDs',t:'subnet-xxx,subnet-yyy',r:false}],outputs:['Launch Template ID','ASG ARN','Scale-out policy ARN'],steps:['Configure AMI, type, sizes','Add subnet IDs for multi-AZ','Toggle Dry Run for preview','Click CREATE ASG'],apis:['POST /api/asg']},
    terminal:{icon:'💻',title:'SSH Virtual Shell',desc:'Browser-based SSH terminal via WebSocket. PEM key or password auth. Quick Commands run exec-over-SSH without opening full shell.',inputs:[{n:'Hostname/IP',t:'54.x.x.x or DNS',r:true},{n:'Username',t:'ec2-user/ubuntu/admin',r:true},{n:'PEM Key',t:'Full .pem file contents',r:false},{n:'Password',t:'alternative to PEM',r:false}],outputs:['Interactive terminal','Command output in Quick Commands panel'],steps:['Enter EC2 IP + username','Paste PEM key','Click TEST CONNECTION','Click OPEN SHELL for interactive terminal','Or use Quick Command buttons for one-shot ops'],apis:['POST /api/terminal/test-connection','POST /api/terminal/exec','WS /ws']},
    ec2pkg:{icon:'📦',title:'EC2 Package Manager',desc:'One-click install of 37 DevOps tools on remote EC2 via SSH. Idempotent scripts. Live streaming output.',inputs:[{n:'EC2 Hostname',t:'IP or DNS',r:true},{n:'Username',t:'ec2-user/ubuntu',r:true},{n:'PEM Key or Password',t:'SSH credentials',r:true}],outputs:['Live install log','CHECK INSTALLED marks tools green'],steps:['Enter SSH credentials','Click CHECK INSTALLED to scan','Click INSTALL on tools','Or select multiple → INSTALL N PACKAGES','Use bundles for Full Stack or CNCF'],apis:['POST /api/ec2-packages/install','POST /api/ec2-packages/install-many','POST /api/ec2-packages/check']},
    nginx:{icon:'🌐',title:'Nginx Config Generator',desc:'Generate production Nginx config with reverse proxy, SSL/TLS, security headers, gzip. Copy-paste ready.',inputs:[{n:'Server Name',t:'myapp.example.com',r:true},{n:'Proxy Pass',t:'http://localhost:3000',r:false},{n:'SSL Certificate/Key',t:'paths on server',r:false}],outputs:['Complete nginx.conf server block','HTTP→HTTPS redirect (if SSL enabled)'],steps:['Enter domain name','Set upstream proxy URL','Toggle SSL for HTTPS','Click GENERATE CONFIG','Copy to /etc/nginx/conf.d/'],apis:['POST /api/nginx/generate']},
    docker:{icon:'🐳',title:'Docker Build & Run',desc:'Build images, run containers, list running containers, stream logs. Full Docker lifecycle.',inputs:[{n:'Image Name',t:'myapp',r:true},{n:'Dockerfile',t:'Multi-line content',r:false},{n:'Ports',t:'8080:80,443:443',r:false},{n:'Env Vars',t:'KEY=VALUE,KEY2=VAL2',r:false}],outputs:['Streaming build output','Container ID','Container list with status','Container logs'],steps:['Paste Dockerfile, set image name','Click BUILD IMAGE','For run: set image + ports + env','Click RUN CONTAINER','Click PS → LOGS button'],apis:['POST /api/docker/build','POST /api/docker/run','GET /api/docker/ps','POST /api/docker/logs']},
    k8s:{icon:'⚓',title:'Kubernetes Resource Manager',desc:'Full kubectl via UI: apply manifests, get/describe resources, scale deployments, rollouts.',inputs:[{n:'YAML Manifest',t:'Full K8s YAML',r:false},{n:'Namespace',t:'default',r:false},{n:'Resource Type',t:'pods/deployments/services',r:false},{n:'Deployment Name',t:'for scale/rollout',r:false}],outputs:['kubectl output','Scale confirmation','Rollout status'],steps:['For apply: paste YAML → KUBECTL APPLY','For get: select type+namespace → KUBECTL GET','For scale: name+replicas → SCALE','For rollout: name+action → RUN'],apis:['POST /api/k8s/apply','POST /api/k8s/get','POST /api/k8s/scale','POST /api/k8s/rollout']},
    helm:{icon:'⛵',title:'Helm Chart Deployer',desc:'Install/upgrade/rollback Helm releases. Auto-adds repos. Supports custom values and dry-run.',inputs:[{n:'Release Name',t:'my-nginx',r:true},{n:'Chart',t:'bitnami/nginx',r:true},{n:'Repo URL',t:'https://charts.bitnami.com/bitnami',r:false},{n:'Values',t:'key=value (one per line)',r:false}],outputs:['helm install streaming output','Release status','helm list table'],steps:['Enter release name + chart','Add repo name/URL if needed','Set values','Toggle Dry Run for validation','Click INSTALL/UPGRADE'],apis:['POST /api/helm/install','POST /api/helm/list','POST /api/helm/rollback']},
    s3:{icon:'🪣',title:'S3 Bucket Manager',desc:'Create S3 buckets with AES256 encryption, versioning, and public access blocking by default.',inputs:[{n:'Bucket Name',t:'globally-unique-name',r:true},{n:'Region',t:'us-east-1',r:false},{n:'Versioning',t:'toggle',r:false},{n:'Block Public Access',t:'default: ON',r:false}],outputs:['Creation confirmation','Bucket list with dates','Object listing (BROWSE)'],steps:['Enter unique bucket name','Toggle versioning if needed','Click CREATE BUCKET','Click LIST to see all buckets'],apis:['POST /api/s3/buckets','GET /api/s3/buckets']},
    iam:{icon:'🔐',title:'IAM Role Creator',desc:'Create IAM roles with trust policies for EC2, Lambda, EKS, CodeBuild. Attach managed policies.',inputs:[{n:'Role Name',t:'MyAppRole',r:true},{n:'Trust Service',t:'ec2.amazonaws.com etc.',r:true},{n:'Policy ARNs',t:'arn:aws:iam::aws:policy/...',r:false}],outputs:['Role ARN','Role name'],steps:['Enter role name','Select service','Add policy ARNs','Click CREATE ROLE','Click LIST ROLES'],apis:['POST /api/iam/roles','GET /api/iam/roles']},
    secrets:{icon:'🔑',title:'Secrets Manager',desc:'Store and retrieve secrets (strings or JSON). Optional KMS encryption. Hierarchical naming with /.',inputs:[{n:'Secret Name',t:'/myapp/db/password',r:true},{n:'Value',t:'string or JSON',r:true}],outputs:['Secret ARN','Listing with last-modified','Retrieved value'],steps:['Enter name + value','Click STORE SECRET','Click LIST','Click RETRIEVE on any secret'],apis:['POST /api/secrets','GET /api/secrets','GET /api/secrets/:name']},
    lambda:{icon:'λ',title:'Lambda Manager',desc:'List and invoke Lambda functions with JSON payloads. View response body and execution logs.',inputs:[{n:'Function Name',t:'my-function or ARN',r:true},{n:'Payload JSON',t:'{"key":"value"}',r:false}],outputs:['Status code','Response body','CloudWatch tail logs'],steps:['Click LIST','Enter function name','Paste JSON payload','Click INVOKE'],apis:['GET /api/lambda/functions','POST /api/lambda/invoke']},
    route53:{icon:'🌍',title:'Route53 DNS Manager',desc:'List hosted zones and UPSERT DNS records (A, CNAME, MX, TXT, AAAA).',inputs:[{n:'Zone ID',t:'Z1234ABC (click LIST to find)',r:true},{n:'Record Name',t:'api.example.com',r:true},{n:'Type + Value + TTL',t:'A / 54.x.x.x / 300',r:true}],outputs:['Change confirmation','Zones table (click row to select ID)'],steps:['Click LIST ZONES','Click zone to auto-fill ID','Enter record name, type, value','Click UPSERT RECORD'],apis:['GET /api/route53/zones','POST /api/route53/records']},
    templates:{icon:'📦',title:'Template Marketplace',desc:'One-click infra from 5 templates: MEAN stack, EKS microservices, 3-tier VPC, static site CDN, serverless API.',inputs:[{n:'Template Parameters',t:'varies per template',r:true}],outputs:['Job ID','Deployment status'],steps:['Browse templates','Click a card','Fill parameter form','Click DEPLOY TEMPLATE'],apis:['GET /api/templates','POST /api/templates/:id/deploy']},
    cicd:{icon:'🔄',title:'CI/CD Pipeline Generator',desc:'Generate GitHub Actions YAML for EC2 SSH deploy, EKS kubectl deploy, or S3 static site deploy.',inputs:[{n:'App Type',t:'Node.js/Python/Java/Go',r:true},{n:'Deploy Target',t:'EC2 / EKS / S3',r:true},{n:'Repo Name',t:'my-app',r:true}],outputs:['Complete .github/workflows/deploy.yml'],steps:['Select app type + target','Fill target-specific fields','Click GENERATE PIPELINE YAML','Copy to .github/workflows/'],apis:['POST /api/cicd/generate']},
    logs:{icon:'📋',title:'CloudWatch Logs Viewer',desc:'Browse log groups and filter events by pattern. Click a group row to auto-fill the filter form.',inputs:[{n:'Log Group',t:'/aws/lambda/my-fn',r:true},{n:'Filter Pattern',t:'ERROR or { $.status = 500 }',r:false}],outputs:['Events with timestamps','Log group list'],steps:['Click LIST to load groups','Click row to select','Enter filter pattern','Click FILTER LOGS'],apis:['GET /api/logs/groups','POST /api/logs/filter']},
    cost:{icon:'💰',title:'Cost Explorer',desc:'AWS billing last 30 days by service. Requires CostExplorer:GetCostAndUsage IAM permission.',inputs:[{n:'AWS Credentials',t:'on Home tab',r:true}],outputs:['Total USD (30 days)','Per-service breakdown with % bars'],steps:['Set credentials on Home','Click LOAD COSTS'],apis:['GET /api/cost/summary']},
    audit:{icon:'🕵',title:'Audit Trail',desc:'SQLite log of every portal action: user, action, resource, status, timestamp.',inputs:[],outputs:['Action log table'],steps:['Click REFRESH','All actions auto-logged'],apis:['GET /api/audit/logs']},
    cncflab:{icon:'🧪',title:'CNCF Lab',desc:'10-step Istio walkthrough + 10 CNCF tool tutorials (Argo CD, Kyverno, Prometheus, KEDA, Falco, OPA, Velero, Crossplane, Tekton, Flux). Each step shows architecture diagram, manifest, impact, and streams live kubectl output.',inputs:[{n:'kubectl configured',t:'kubeconfig must point to a cluster',r:true}],outputs:['Live kubectl/helm streaming output','Architecture ASCII diagrams','K8s YAML manifests per step','Before/after impact description'],steps:['Click Istio or CNCF Tools','For Istio: follow steps 1-10 in order','Click ▶ APPLY to execute each step','For CNCF tools: click tool card then run steps'],apis:['GET /api/cncf-lab/istio/steps','POST /api/cncf-lab/istio/apply/:id','GET /api/cncf-lab/tools','POST /api/cncf-lab/tools/:id/steps/:stepId']},
    cfn:{icon:'☁',title:'CloudFormation',desc:'Deploy/update/delete stacks. Validate with dry-run. Template body or S3 URL.',inputs:[{n:'Stack Name',t:'my-stack',r:true},{n:'Template Body or S3 URL',t:'JSON/YAML or s3://...',r:true},{n:'Parameters',t:'KEY=VALUE per line',r:false}],outputs:['Stack status','Events table'],steps:['Enter name + template','Toggle Dry Run to validate','Click DEPLOY STACK','Click LIST to see stacks'],apis:['POST /api/cfn/deploy','GET /api/cfn/stacks']},
    codebuild:{icon:'🔨',title:'CodeBuild',desc:'List projects, start builds with env var overrides, view build history.',inputs:[{n:'Project Name',t:'my-project',r:true},{n:'Source Version',t:'main/tag (optional)',r:false},{n:'Env Vars',t:'KEY=VALUE per line',r:false}],outputs:['Build ID','Build status and phase history'],steps:['Click LIST → SELECT project','Set source version if needed','Click START BUILD','Click BUILDS for history'],apis:['GET /api/codebuild/projects','POST /api/codebuild/build']},
    pipeline:{icon:'🔄',title:'CodePipeline',desc:'List, start, stop pipelines. View stage-by-stage status.',inputs:[{n:'Pipeline Name',t:'my-pipeline',r:true}],outputs:['Pipeline list','Stage states','Execution ID'],steps:['Click LIST ALL','Click name to select','Click STATUS or START'],apis:['GET /api/pipeline/list','POST /api/pipeline/start']},
    cache:{icon:'⚡',title:'ElastiCache',desc:'Create Redis/Memcached clusters. View existing clusters and replication groups.',inputs:[{n:'Cluster ID',t:'my-redis',r:true},{n:'Engine',t:'redis/memcached',r:true},{n:'Node Type',t:'cache.t3.micro',r:true}],outputs:['Creation confirmation','Cluster list'],steps:['Click LIST','Fill form','Click CREATE CLUSTER'],apis:['GET /api/cache/clusters','POST /api/cache/create']},
    dynamo:{icon:'🗄',title:'DynamoDB',desc:'Create tables with PK/SK, scan data, delete tables.',inputs:[{n:'Table Name',t:'my-table',r:true},{n:'Partition Key + Type',t:'id / S',r:true},{n:'Sort Key',t:'optional',r:false}],outputs:['Table ARN + status','Scanned items as JSON'],steps:['Enter name + PK','Click CREATE TABLE','Click SCAN to view data'],apis:['GET /api/dynamo/tables','POST /api/dynamo/tables','POST /api/dynamo/scan']},
    sqs:{icon:'📨',title:'SQS Queue Manager',desc:'Create standard/FIFO queues, send/receive messages.',inputs:[{n:'Queue Name',t:'my-queue (.fifo for FIFO)',r:true},{n:'Queue URL',t:'for send/receive',r:false},{n:'Message Body',t:'string or JSON',r:false}],outputs:['Queue URL','Message ID','Messages with receipt handles'],steps:['Enter name → CREATE QUEUE','SELECT a queue URL','Enter message → SEND','Click RECEIVE to poll'],apis:['POST /api/sqs/queues','POST /api/sqs/send','POST /api/sqs/receive']},
    cdn:{icon:'🌐',title:'CloudFront Manager',desc:'List distributions and create cache invalidations.',inputs:[{n:'Distribution ID',t:'E1ABCDEF (click LIST)',r:true},{n:'Paths',t:'/* or /api/*',r:true}],outputs:['Distribution list with domain/status','Invalidation ID + status'],steps:['Click LIST','Click ID to select','Enter paths → INVALIDATE'],apis:['GET /api/cdn/distributions','POST /api/cdn/invalidate']},
    beanstalk:{icon:'🫘',title:'Elastic Beanstalk',desc:'List environments with health. Restart app server, view events.',inputs:[{n:'Environment Name',t:'my-app-prod',r:true}],outputs:['Env list with health/URL','Restart confirmation','Events list'],steps:['Click LIST','Select env','Click RESTART APP or GET EVENTS'],apis:['GET /api/beanstalk/apps','POST /api/beanstalk/restart']},
    ssm:{icon:'🔧',title:'SSM Parameter Store + Run Command',desc:'Store/retrieve parameters. Run shell commands on EC2 without SSH.',inputs:[{n:'Parameter Name',t:'/app/db/password',r:true},{n:'Value + Type',t:'String/SecureString',r:true},{n:'Instance IDs',t:'i-xxx (for Run Command)',r:false},{n:'Commands',t:'shell lines',r:false}],outputs:['Parameter version','Parameter value','SSM Command ID'],steps:['Enter name+value → PUT','Or GET VALUE','For Run Command: instance IDs + commands → RUN COMMAND'],apis:['POST /api/ssm/parameters','GET /api/ssm/parameters/:name','POST /api/ssm/run-command']},
    alarms:{icon:'🔔',title:'CloudWatch Alarms',desc:'Create metric alarms for EC2/RDS/Lambda. View alarm states.',inputs:[{n:'Alarm Name',t:'High-CPU',r:true},{n:'Metric + Namespace',t:'CPUUtilization / AWS/EC2',r:true},{n:'Threshold',t:'80',r:true}],outputs:['Alarm created confirmation','Alarm list with OK/ALARM states'],steps:['Select metric + namespace','Enter name + threshold','Click CREATE ALARM','Click LIST to view states'],apis:['POST /api/alarms/create','GET /api/alarms/list']},
    ecs:{icon:'🐋',title:'ECS / Fargate Manager',desc:'Manage clusters, register Fargate task definitions, run tasks, scale services.',inputs:[{n:'Cluster Name',t:'my-cluster',r:true},{n:'Container Image',t:'nginx:latest or ECR URI',r:true},{n:'CPU/Memory',t:'256/512 (Fargate units)',r:true},{n:'Subnets',t:'subnet-xxx,subnet-yyy',r:false}],outputs:['Cluster list','Task definition ARN + revision','Task ARN'],steps:['Click CLUSTERS → list services/tasks','Register task def form → REGISTER','Enter cluster+taskdef+subnets → RUN TASK','Scale: cluster+service+count → SCALE'],apis:['GET /api/ecs/clusters','POST /api/ecs/task-def','POST /api/ecs/run-task','POST /api/ecs/scale']},
    stepfn:{icon:'🔀',title:'Step Functions',desc:'List state machines, start executions, track status.',inputs:[{n:'State Machine ARN',t:'arn:aws:states:... (click LIST)',r:true},{n:'Input JSON',t:'{}',r:false}],outputs:['Execution ARN','Execution status/output','Execution list'],steps:['Click LIST → SELECT','Paste JSON input → EXECUTE','Click LIST EXECUTIONS'],apis:['GET /api/stepfn/machines','POST /api/stepfn/execute']},
    events:{icon:'⚡',title:'EventBridge',desc:'List buses/rules, create scheduled/pattern rules, put custom events.',inputs:[{n:'Rule Name',t:'my-rule',r:true},{n:'Schedule',t:'rate(5 minutes) or cron()',r:false},{n:'Event Pattern',t:'{"source":["aws.ec2"]}',r:false},{n:'Target ARN',t:'Lambda/SQS/SNS ARN',r:true}],outputs:['Rule ARN','Rule list','Event put result'],steps:['Click LIST','Enter name + schedule or pattern + target','Click CREATE RULE','Use Put Custom Event to test'],apis:['GET /api/events/rules','POST /api/events/rules','POST /api/events/put']},
    kinesis:{icon:'📊',title:'Kinesis Streams',desc:'Create streams, put records, describe shards.',inputs:[{n:'Stream Name',t:'my-stream',r:true},{n:'Shard Count',t:'1',r:false},{n:'Data',t:'JSON or string',r:false},{n:'Partition Key',t:'user-123',r:false}],outputs:['Creation confirmation','Shard ID + sequence number','Stream details'],steps:['Click LIST','CREATE STREAM','Click name → PUT RECORD','Click DESCRIBE for details'],apis:['GET /api/kinesis/streams','POST /api/kinesis/streams','POST /api/kinesis/put']},
    waf:{icon:'🛡',title:'WAF v2 Manager',desc:'List Web ACLs, create IP block sets, associate WAF with ALBs/CloudFront.',inputs:[{n:'Scope',t:'REGIONAL or CLOUDFRONT',r:true},{n:'IP Set Name + Addresses',t:'name + CIDR per line',r:false},{n:'WAF ACL ARN + Resource ARN',t:'for association',r:false}],outputs:['ACL list','IP Set ARN','Association confirmation'],steps:['Click LIST ACLs','Create IP set','Paste ACL ARN + resource ARN → ASSOCIATE WAF'],apis:['GET /api/waf/acls','POST /api/waf/ip-sets','POST /api/waf/associate']},
    backup:{icon:'💾',title:'AWS Backup',desc:'Create backup plans with schedules, run on-demand backups, view job history.',inputs:[{n:'Plan Name',t:'daily-backup',r:true},{n:'Schedule (cron)',t:'cron(0 5 ? * * *)',r:false},{n:'Retention (days)',t:'30',r:false},{n:'Resource ARN',t:'arn:aws:ec2:...:volume/vol-xxx',r:false}],outputs:['Plan ID/ARN','Job ID','Job history'],steps:['Enter plan → CREATE PLAN','Paste resource ARN → START BACKUP NOW','Click PLANS or JOBS to view'],apis:['POST /api/backup/plans','POST /api/backup/start','GET /api/backup/jobs']},
    awsconfig:{icon:'📐',title:'AWS Config',desc:'Compliance summary and rule listing for Config rules.',inputs:[{n:'AWS Credentials',t:'on Home tab',r:true}],outputs:['Compliant/non-compliant counts','Rule list with compliance state'],steps:['Click COMPLIANCE for summary','Click LIST RULES for all rules'],apis:['GET /api/awsconfig/compliance','GET /api/awsconfig/rules']},
    apigw:{icon:'🔌',title:'API Gateway',desc:'List REST APIs, deploy to stages, manage API keys.',inputs:[{n:'REST API ID',t:'abc1234 (click LIST)',r:true},{n:'Stage Name',t:'prod/dev',r:true},{n:'API Key Name',t:'my-key',r:false}],outputs:['API list','Stage list with invoke URLs','Deployment ID + URL','Key value after creation'],steps:['Click LIST → click row to select ID','Enter stage → DEPLOY','LIST in API Keys section'],apis:['GET /api/apigw/apis','POST /api/apigw/deploy','POST /api/apigw/keys']},
    opensearch:{icon:'🔍',title:'OpenSearch Manager',desc:'Create/describe/delete OpenSearch domains. Encryption and HTTPS enforced by default.',inputs:[{n:'Domain Name',t:'my-search',r:true},{n:'Engine Version',t:'OpenSearch_2.11',r:true},{n:'Instance Type',t:'t3.small.search',r:true},{n:'EBS Size (GB)',t:'10',r:false}],outputs:['Domain creation initiated (15-30 min)','Domain details: endpoint, engine, instance count'],steps:['Enter name + version + type','Click CREATE DOMAIN','Click LIST to check status','Click DESCRIBE for details'],apis:['POST /api/opensearch/create','GET /api/opensearch/domains']},
    glue:{icon:'🧬',title:'Glue ETL Manager',desc:'Browse Data Catalog, run jobs, start crawlers.',inputs:[{n:'None required',t:'Browse buttons populate forms',r:false}],outputs:['Database + table list','Job run ID + history','Crawler status'],steps:['Click DATABASES → click row for tables','Click JOBS → RUN or RUNS','Click CRAWLERS → START'],apis:['GET /api/glue/databases','GET /api/glue/jobs','POST /api/glue/jobs/run','GET /api/glue/crawlers','POST /api/glue/crawlers/start']}
  };

  const info = {
    currentTab: 'home',
    show() {
      const d = TAB_INFO[this.currentTab];
      const overlay = document.getElementById('info-modal-overlay');
      document.getElementById('info-modal-icon').textContent = d ? d.icon : 'ℹ';
      document.getElementById('info-modal-title').textContent = d ? d.title.toUpperCase() : this.currentTab.toUpperCase();
      if (!d) { document.getElementById('info-modal-body').innerHTML = '<p style="color:var(--text3);padding:20px">Documentation coming soon.</p>'; overlay.classList.add('visible'); return; }
      const inp = (d.inputs||[]).map(i => `<div class="info-item"><div class="info-item-label">${escHtml(i.n)} ${i.r?'<span style="color:var(--red)">*</span>':'<span style="color:var(--text3)">(opt)</span>'}</div><div class="info-item-value" style="color:var(--text3)">${escHtml(i.t)}</div></div>`).join('');
      const out = (d.outputs||[]).map(o => `<div class="info-item"><span class="info-badge info-badge-output">→</span> <span style="font-size:12px;color:var(--text)">${escHtml(o)}</span></div>`).join('');
      const steps = (d.steps||[]).map(s => `<li>${escHtml(s)}</li>`).join('');
      const apis = (d.apis||[]).map(a => { const p=a.split(' '); const m=['GET','POST','PUT','DELETE','WS'].includes(p[0]); return `<div class="info-api-row">${m?`<span class="info-method">${escHtml(p[0])}</span><span class="info-path">${escHtml(p.slice(1).join(' '))}</span>`:`<span class="info-path">${escHtml(a)}</span>`}</div>`; }).join('');
      document.getElementById('info-modal-body').innerHTML = `
        <div class="info-section"><div class="info-section-title">What it does</div><div class="info-desc">${escHtml(d.desc)}</div></div>
        ${inp?`<div class="info-section"><div class="info-section-title">Inputs</div><div class="info-grid">${inp}</div></div>`:''}
        ${out?`<div class="info-section"><div class="info-section-title">Outputs</div><div class="info-grid">${out}</div></div>`:''}
        ${steps?`<div class="info-section"><div class="info-section-title">How to use</div><ol class="info-steps">${steps}</ol></div>`:''}
        ${apis?`<div class="info-section"><div class="info-section-title">API Endpoints</div>${apis}</div>`:''}`;
      overlay.classList.add('visible');
    },
    close() { document.getElementById('info-modal-overlay').classList.remove('visible'); },
    setTab(t) { this.currentTab = t; const b = document.getElementById('info-btn'); if(b) b.style.color = TAB_INFO[t]?'var(--green)':'var(--text3)'; }
  };

  // ===== INIT (runs after all modules are declared) =====
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
    fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json()).then(data => { if (data.user) showApp(data.user); }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { logout, loadResources, clearCreds, switchTab, toggleConsole, clearConsole, ec2, eks, asg, terminal, nginx, docker, k8s, helm, s3, iam, secrets, lambda, dns, templates, cicd, cwlogs, cost, audit, cfn, codebuild, pipeline, cache, dynamo, sqs, cdn, beanstalk, ssm, alarms, ecs, stepfn, events, kinesis, waf, backup, awsconfig, apigw, opensearch, glue, ec2pkg, cncflab, info };
})();
