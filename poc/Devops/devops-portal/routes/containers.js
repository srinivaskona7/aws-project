'use strict';
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const WORK_DIR = path.join(os.tmpdir(), 'devops-portal');

function streamCommand(res, jobId, command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
    const send = (line) => res.write(`data: ${JSON.stringify({ jobId, line, ts: Date.now() })}\n\n`);
    send(`[JOB:${jobId}] $ ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, { cwd: cwd || WORK_DIR, env: { ...process.env, ...env }, shell: true });
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(send));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(`[STDERR] ${l}`)));
    proc.on('close', code => {
      send(`[JOB:${jobId}] Exited: ${code}`);
      res.write(`data: ${JSON.stringify({ jobId, done: true, exitCode: code })}\n\n`);
      res.end();
      code === 0 ? resolve() : reject(new Error(`Exit ${code}`));
    });
    proc.on('error', err => { send(`[ERROR] ${err.message}`); res.end(); reject(err); });
  });
}

// POST /api/eks/deploy - Deploy EKS cluster
router.post('/eks/deploy', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    clusterName = 'devops-eks',
    k8sVersion = '1.28',
    nodeGroupName = 'devops-ng',
    instanceType = 't3.medium',
    minNodes = 1,
    maxNodes = 5,
    desiredNodes = 2,
    region,
    dryRun = false
  } = req.body;

  const creds = req.session.awsCreds || {};
  const awsRegion = region || creds.region || 'us-east-1';

  const script = `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="${creds.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${creds.secretAccessKey}"
export AWS_DEFAULT_REGION="${awsRegion}"

echo "[INFO] Deploying EKS Cluster: ${clusterName} in ${awsRegion}"
echo "[INFO] K8s Version: ${k8sVersion}"

# Check if eksctl is available
if ! command -v eksctl &> /dev/null; then
  echo "[ERROR] eksctl not found. Install with: curl --silent --location 'https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz' | tar xz -C /usr/local/bin"
  exit 1
fi

# Check if cluster already exists
EXISTING=$(aws eks describe-cluster --name "${clusterName}" --query 'cluster.status' --output text 2>/dev/null || echo "NOTFOUND")
if [ "$EXISTING" != "NOTFOUND" ]; then
  echo "[INFO] Cluster ${clusterName} already exists with status: $EXISTING"
  aws eks update-kubeconfig --name "${clusterName}" --region "${awsRegion}"
  echo "[INFO] kubeconfig updated"
  kubectl get nodes
  exit 0
fi

echo "[INFO] Creating EKS cluster (this takes ~15 minutes)..."
${dryRun ? 'echo "[DRY RUN] Would run eksctl create cluster..."' : `eksctl create cluster \\
  --name "${clusterName}" \\
  --version "${k8sVersion}" \\
  --region "${awsRegion}" \\
  --nodegroup-name "${nodeGroupName}" \\
  --node-type "${instanceType}" \\
  --nodes ${desiredNodes} \\
  --nodes-min ${minNodes} \\
  --nodes-max ${maxNodes} \\
  --managed \\
  --asg-access \\
  --full-ecr-access \\
  --alb-ingress-access \\
  --with-oidc \\
  --tags "ManagedBy=devops-portal"`}

echo "[INFO] Updating kubeconfig..."
aws eks update-kubeconfig --name "${clusterName}" --region "${awsRegion}"

echo "[INFO] Installing AWS Load Balancer Controller..."
eksctl create iamserviceaccount \\
  --cluster="${clusterName}" \\
  --namespace=kube-system \\
  --name=aws-load-balancer-controller \\
  --role-name="${clusterName}-aws-lb-controller" \\
  --attach-policy-arn=arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy \\
  --approve 2>/dev/null || echo "[WARN] IAM SA may already exist"

echo "[INFO] Installing metrics-server..."
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml 2>/dev/null || echo "[WARN] metrics-server install skipped"

echo "[SUCCESS] EKS Cluster ${clusterName} is ready!"
kubectl get nodes -o wide
`;

  const jobDir = path.join(WORK_DIR, `eks-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'deploy-eks.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });

  if (dryRun) return res.json({ success: true, script, message: 'Dry run - script generated' });
  try { await streamCommand(res, jobId, 'bash', [scriptPath], jobDir, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// POST /api/k8s/apply - Apply Kubernetes manifests
router.post('/k8s/apply', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const { manifest, namespace = 'default', dryRun = false } = req.body;
  if (!manifest) return res.status(400).json({ error: 'manifest YAML required' });

  const jobDir = path.join(WORK_DIR, `k8s-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const manifestPath = path.join(jobDir, 'manifest.yaml');
  await fs.writeFile(manifestPath, manifest);

  const args = dryRun
    ? ['-c', `kubectl apply -f ${manifestPath} --dry-run=client -n ${namespace}`]
    : ['-c', `kubectl apply -f ${manifestPath} -n ${namespace}`];
  try { await streamCommand(res, jobId, 'bash', args, jobDir, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// POST /api/k8s/get - Get K8s resources
router.post('/k8s/get', async (req, res) => {
  const { resource = 'pods', namespace = 'default', allNamespaces = false, output = 'wide' } = req.body;
  const nsFlag = allNamespaces ? '--all-namespaces' : `-n ${namespace}`;
  try {
    const { exec } = require('child_process');
    const cmd = `kubectl get ${resource} ${nsFlag} -o ${output}`;
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return res.status(400).json({ error: stderr || err.message });
      res.json({ success: true, output: stdout, command: cmd });
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/k8s/describe
router.post('/k8s/describe', async (req, res) => {
  const { resource = 'pod', name, namespace = 'default' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { exec } = require('child_process');
  exec(`kubectl describe ${resource} ${name} -n ${namespace}`, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.status(400).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout });
  });
});

// POST /api/k8s/scale
router.post('/k8s/scale', async (req, res) => {
  const { resource = 'deployment', name, namespace = 'default', replicas } = req.body;
  if (!name || replicas === undefined) return res.status(400).json({ error: 'name and replicas required' });
  const { exec } = require('child_process');
  exec(`kubectl scale ${resource}/${name} --replicas=${replicas} -n ${namespace}`, (err, stdout, stderr) => {
    if (err) return res.status(400).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout });
  });
});

// POST /api/k8s/rollout
router.post('/k8s/rollout', async (req, res) => {
  const { action = 'status', name, namespace = 'default' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { exec } = require('child_process');
  exec(`kubectl rollout ${action} deployment/${name} -n ${namespace}`, { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) return res.status(400).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout });
  });
});

// POST /api/k8s/logs
router.post('/k8s/logs', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const { pod, namespace = 'default', container, tail = 100, follow = false } = req.body;
  if (!pod) return res.status(400).json({ error: 'pod name required' });
  const args = ['-c', `kubectl logs ${pod} -n ${namespace} ${container ? `-c ${container}` : ''} --tail=${tail} ${follow ? '-f' : ''}`];
  try { await streamCommand(res, jobId, 'bash', args, WORK_DIR, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// POST /api/helm/install
router.post('/helm/install', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    releaseName,
    chart,
    repoUrl,
    repoName,
    namespace = 'default',
    values = {},
    dryRun = false,
    upgrade = true
  } = req.body;
  if (!releaseName || !chart) return res.status(400).json({ error: 'releaseName and chart required' });

  const valuesArgs = Object.entries(values).map(([k, v]) => `--set ${k}=${v}`).join(' ');
  const script = `#!/bin/bash
set -e
${repoName && repoUrl ? `echo "[INFO] Adding Helm repo..."
helm repo add ${repoName} ${repoUrl}
helm repo update` : ''}
kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -
echo "[INFO] ${upgrade ? 'Installing/Upgrading' : 'Installing'} ${releaseName}..."
helm ${upgrade ? 'upgrade --install' : 'install'} ${releaseName} ${chart} \\
  -n ${namespace} \\
  ${valuesArgs} \\
  ${dryRun ? '--dry-run' : ''} \\
  --wait --timeout 10m
echo "[SUCCESS] Helm release ${releaseName} deployed!"
helm status ${releaseName} -n ${namespace}
`;

  const jobDir = path.join(WORK_DIR, `helm-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'helm-install.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  try { await streamCommand(res, jobId, 'bash', [scriptPath], jobDir, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// POST /api/helm/list
router.post('/helm/list', async (req, res) => {
  const { namespace, allNamespaces = false } = req.body;
  const { exec } = require('child_process');
  const nsFlag = allNamespaces ? '--all-namespaces' : (namespace ? `-n ${namespace}` : '');
  exec(`helm list ${nsFlag} -o json`, { timeout: 30000 }, (err, stdout) => {
    if (err) return res.status(400).json({ error: err.message });
    try { res.json({ success: true, releases: JSON.parse(stdout) }); }
    catch { res.json({ success: true, output: stdout }); }
  });
});

// POST /api/helm/rollback
router.post('/helm/rollback', async (req, res) => {
  const { releaseName, revision, namespace = 'default' } = req.body;
  if (!releaseName) return res.status(400).json({ error: 'releaseName required' });
  const { exec } = require('child_process');
  exec(`helm rollback ${releaseName} ${revision || ''} -n ${namespace}`, (err, stdout, stderr) => {
    if (err) return res.status(400).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout });
  });
});

// POST /api/docker/build
router.post('/docker/build', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const { dockerfile, context = '.', imageName, tag = 'latest', buildArgs = {} } = req.body;
  if (!imageName) return res.status(400).json({ error: 'imageName required' });

  const jobDir = path.join(WORK_DIR, `docker-build-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  if (dockerfile) await fs.writeFile(path.join(jobDir, 'Dockerfile'), dockerfile);

  const buildArgStr = Object.entries(buildArgs).map(([k, v]) => `--build-arg ${k}=${v}`).join(' ');
  const cmd = `docker build ${buildArgStr} -t ${imageName}:${tag} ${context === '.' ? jobDir : context}`;
  try { await streamCommand(res, jobId, 'bash', ['-c', cmd], jobDir, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// POST /api/docker/run
router.post('/docker/run', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const { image, name, ports = [], envVars = {}, detach = true, rm = false, volumes = [] } = req.body;
  if (!image) return res.status(400).json({ error: 'image required' });

  const portArgs = ports.map(p => `-p ${p}`).join(' ');
  const envArgs = Object.entries(envVars).map(([k, v]) => `-e ${k}="${v}"`).join(' ');
  const volArgs = volumes.map(v => `-v ${v}`).join(' ');
  const nameArg = name ? `--name ${name}` : '';
  const cmd = `docker run ${detach ? '-d' : ''} ${rm ? '--rm' : ''} ${nameArg} ${portArgs} ${envArgs} ${volArgs} ${image}`;
  try { await streamCommand(res, jobId, 'bash', ['-c', cmd], WORK_DIR, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// GET /api/docker/ps
router.get('/docker/ps', async (req, res) => {
  const { exec } = require('child_process');
  const all = req.query.all === 'true';
  exec(`docker ps ${all ? '-a' : ''} --format json`, (err, stdout) => {
    if (err) return res.status(400).json({ error: err.message });
    const containers = stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ success: true, containers });
  });
});

// POST /api/docker/logs
router.post('/docker/logs', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const { container, tail = 100 } = req.body;
  if (!container) return res.status(400).json({ error: 'container required' });
  try { await streamCommand(res, jobId, 'bash', ['-c', `docker logs --tail=${tail} ${container}`], WORK_DIR, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// POST /api/ecr/setup
router.post('/ecr/setup', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const { repoName, region, enableScanOnPush = true } = req.body;
  if (!repoName) return res.status(400).json({ error: 'repoName required' });
  const creds = req.session.awsCreds || {};
  const awsRegion = region || creds.region || 'us-east-1';

  const script = `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="${creds.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${creds.secretAccessKey}"
export AWS_DEFAULT_REGION="${awsRegion}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL="$ACCOUNT_ID.dkr.ecr.${awsRegion}.amazonaws.com"

echo "[INFO] Account: $ACCOUNT_ID"
echo "[INFO] ECR URL: $ECR_URL/${repoName}"

# Create repo (idempotent)
EXISTING=$(aws ecr describe-repositories --repository-names "${repoName}" --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo "None")
if [ "$EXISTING" = "None" ] || [ -z "$EXISTING" ]; then
  aws ecr create-repository \\
    --repository-name "${repoName}" \\
    ${enableScanOnPush ? '--image-scanning-configuration scanOnPush=true' : ''} \\
    --encryption-configuration encryptionType=AES256 \\
    --tags Key=ManagedBy,Value=devops-portal
  echo "[INFO] Repository created: $ECR_URL/${repoName}"
else
  echo "[INFO] Repository already exists: $EXISTING"
fi

# Login
echo "[INFO] Logging into ECR..."
aws ecr get-login-password --region "${awsRegion}" | docker login --username AWS --password-stdin "$ECR_URL"

echo "[SUCCESS] ECR setup complete!"
echo "REGISTRY_URL=$ECR_URL"
echo "REPO_URI=$ECR_URL/${repoName}"
echo ""
echo "Push commands:"
echo "  docker tag your-image:tag $ECR_URL/${repoName}:latest"
echo "  docker push $ECR_URL/${repoName}:latest"
`;

  const jobDir = path.join(WORK_DIR, `ecr-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'setup-ecr.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  try { await streamCommand(res, jobId, 'bash', [scriptPath], jobDir, {}); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

module.exports = router;
