'use strict';
const express = require('express');
const router = express.Router();
const { Client: SSHClient } = require('ssh2');
const { v4: uuidv4 } = require('uuid');

function sshStream(res, jobId, connConfig, script) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (line) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify({ jobId, line, ts: Date.now() })}\n\n`); };
  const done = (code) => { if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ jobId, done: true, exitCode: code })}\n\n`); res.end(); } };
  const conn = new SSHClient();
  conn.on('ready', () => {
    send(`[JOB:${jobId}] SSH connected. Running installer...`);
    conn.exec(script, { pty: true }, (err, stream) => {
      if (err) { send(`[ERROR] ${err.message}`); done(1); conn.end(); return; }
      stream.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)));
      stream.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(`[STDERR] ${l}`)));
      stream.on('close', (code) => { send(code === 0 ? '[SUCCESS] Installation complete!' : `[ERROR] Exited with code ${code}`); done(code); conn.end(); });
    });
  });
  conn.on('error', (err) => { send(`[SSH ERROR] ${err.message}`); done(1); });
  conn.connect(connConfig);
}

function getConnConfig(body) {
  const { host, port = 22, username = 'ec2-user', privateKey, password } = body;
  if (!host) throw new Error('host is required');
  const cfg = { host, port: parseInt(port), username, readyTimeout: 30000, keepaliveInterval: 10000 };
  if (privateKey) cfg.privateKey = Buffer.from(privateKey);
  else if (password) cfg.password = password;
  else throw new Error('privateKey or password required');
  return cfg;
}

const SCRIPTS = {
  'system-update': { name: 'System Update', category: 'core', script: `#!/bin/bash
set -e
echo "[INFO] Detecting OS..."
if command -v apt-get &>/dev/null; then
  sudo apt-get update -y && sudo apt-get upgrade -y
  sudo apt-get install -y curl wget git unzip jq vim htop net-tools lsof
elif command -v yum &>/dev/null; then
  sudo yum update -y
  sudo yum install -y curl wget git unzip jq vim htop net-tools lsof
fi
echo "[DONE] System updated"` },

  'git': { name: 'Git', category: 'core', script: `#!/bin/bash
set -e
if command -v git &>/dev/null; then echo "[SKIP] $(git --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y git; else sudo yum install -y git; fi
echo "[DONE] $(git --version)"` },

  'nodejs': { name: 'Node.js 20 LTS', category: 'runtime', script: `#!/bin/bash
set -e
if command -v node &>/dev/null; then echo "[SKIP] $(node --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
  sudo yum install -y nodejs
fi
sudo npm install -g pm2 nodemon yarn --silent
echo "[DONE] Node.js $(node --version)"` },

  'python3': { name: 'Python 3 + pip', category: 'runtime', script: `#!/bin/bash
set -e
if command -v python3 &>/dev/null; then echo "[SKIP] $(python3 --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y python3 python3-pip python3-venv; else sudo yum install -y python3 python3-pip; fi
pip3 install --user virtualenv boto3 --quiet
echo "[DONE] $(python3 --version)"` },

  'java': { name: 'Java 17 (OpenJDK)', category: 'runtime', script: `#!/bin/bash
set -e
if command -v java &>/dev/null; then echo "[SKIP] $(java -version 2>&1 | head -1)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y openjdk-17-jdk; else sudo yum install -y java-17-amazon-corretto 2>/dev/null || sudo amazon-linux-extras install java-openjdk17 -y; fi
echo "[DONE] $(java -version 2>&1 | head -1)"` },

  'golang': { name: 'Go 1.22', category: 'runtime', script: `#!/bin/bash
set -e
if command -v go &>/dev/null; then echo "[SKIP] $(go version)"; exit 0; fi
GO_VER="1.22.3"
curl -sLO "https://go.dev/dl/go\${GO_VER}.linux-amd64.tar.gz"
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf "go\${GO_VER}.linux-amd64.tar.gz"
rm "go\${GO_VER}.linux-amd64.tar.gz"
echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh
export PATH=$PATH:/usr/local/go/bin
echo "[DONE] $(go version)"` },

  'docker': { name: 'Docker + Compose', category: 'containers', script: `#!/bin/bash
set -e
if command -v docker &>/dev/null; then echo "[SKIP] $(docker --version)"; else
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
  else
    sudo amazon-linux-extras install docker -y 2>/dev/null || sudo yum install -y docker
  fi
  sudo systemctl start docker && sudo systemctl enable docker
  sudo usermod -aG docker $(whoami) 2>/dev/null || true
fi
COMPOSE_VER="v2.27.0"
sudo curl -sL "https://github.com/docker/compose/releases/download/\${COMPOSE_VER}/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
echo "[DONE] $(docker --version) | Compose: $(docker-compose --version)"` },

  'kubectl': { name: 'kubectl + kubectx', category: 'containers', script: `#!/bin/bash
set -e
if command -v kubectl &>/dev/null; then echo "[SKIP] kubectl installed"; exit 0; fi
KVER=$(curl -sL https://dl.k8s.io/release/stable.txt)
curl -sLO "https://dl.k8s.io/release/\${KVER}/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl
sudo git clone https://github.com/ahmetb/kubectx /opt/kubectx --quiet 2>/dev/null || true
sudo ln -sf /opt/kubectx/kubectx /usr/local/bin/kubectx 2>/dev/null || true
sudo ln -sf /opt/kubectx/kubens /usr/local/bin/kubens 2>/dev/null || true
echo "[DONE] $(kubectl version --client --short 2>/dev/null || echo kubectl installed)"` },

  'helm': { name: 'Helm 3 + Repos', category: 'containers', script: `#!/bin/bash
set -e
if command -v helm &>/dev/null; then echo "[SKIP] $(helm version --short)"; exit 0; fi
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx 2>/dev/null || true
helm repo add cert-manager https://charts.jetstack.io 2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add grafana https://grafana.github.io/helm-charts 2>/dev/null || true
helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null || true
helm repo update
echo "[DONE] $(helm version --short)"` },

  'eksctl': { name: 'eksctl', category: 'containers', script: `#!/bin/bash
set -e
if command -v eksctl &>/dev/null; then echo "[SKIP] eksctl $(eksctl version)"; exit 0; fi
curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz" | tar xz -C /tmp
sudo mv /tmp/eksctl /usr/local/bin
echo "[DONE] eksctl $(eksctl version)"` },

  'k9s': { name: 'k9s (K8s TUI)', category: 'containers', script: `#!/bin/bash
set -e
if command -v k9s &>/dev/null; then echo "[SKIP] k9s installed"; exit 0; fi
K9S_VER=$(curl -sI https://github.com/derailed/k9s/releases/latest | grep -i location | sed 's|.*/||' | tr -d '\r')
curl -sLO "https://github.com/derailed/k9s/releases/download/\${K9S_VER}/k9s_Linux_amd64.tar.gz"
tar xzf k9s_Linux_amd64.tar.gz k9s && sudo mv k9s /usr/local/bin/ && rm k9s_Linux_amd64.tar.gz
echo "[DONE] k9s installed"` },

  'terraform': { name: 'Terraform', category: 'iac', script: `#!/bin/bash
set -e
if command -v terraform &>/dev/null; then echo "[SKIP] $(terraform version | head -1)"; exit 0; fi
if command -v apt-get &>/dev/null; then
  wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
  sudo apt-get update -y && sudo apt-get install -y terraform
else
  sudo yum install -y yum-utils
  sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo
  sudo yum install -y terraform
fi
echo "[DONE] $(terraform version | head -1)"` },

  'ansible': { name: 'Ansible', category: 'iac', script: `#!/bin/bash
set -e
if command -v ansible &>/dev/null; then echo "[SKIP] $(ansible --version | head -1)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y ansible 2>/dev/null || pip3 install ansible; else sudo amazon-linux-extras install ansible2 -y 2>/dev/null || pip3 install ansible; fi
ansible-galaxy collection install community.aws amazon.aws --ignore-errors 2>/dev/null || true
echo "[DONE] $(ansible --version | head -1)"` },

  'pulumi': { name: 'Pulumi', category: 'iac', script: `#!/bin/bash
set -e
if command -v pulumi &>/dev/null; then echo "[SKIP] $(pulumi version)"; exit 0; fi
curl -fsSL https://get.pulumi.com | sh
echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.bashrc
export PATH=$PATH:$HOME/.pulumi/bin
echo "[DONE] $(pulumi version)"` },

  'jenkins': { name: 'Jenkins LTS', category: 'cicd', script: `#!/bin/bash
set -e
if systemctl is-active --quiet jenkins 2>/dev/null; then echo "[SKIP] Jenkins already running"; exit 0; fi
if command -v apt-get &>/dev/null; then
  sudo apt-get install -y openjdk-17-jdk 2>/dev/null || sudo apt-get install -y default-jdk
  curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null
  echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list
  sudo apt-get update -y && sudo apt-get install -y jenkins
else
  sudo yum install -y java-17-amazon-corretto 2>/dev/null || sudo amazon-linux-extras install java-openjdk17 -y
  sudo wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
  sudo rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
  sudo yum install -y jenkins
fi
sudo systemctl start jenkins && sudo systemctl enable jenkins
sleep 5
PASS=$(sudo cat /var/lib/jenkins/secrets/initialAdminPassword 2>/dev/null || echo "check /var/lib/jenkins/secrets/initialAdminPassword")
echo "[DONE] Jenkins running on port 8080"
echo "[INFO] Initial admin password: $PASS"` },

  'gitlab-runner': { name: 'GitLab Runner', category: 'cicd', script: `#!/bin/bash
set -e
if command -v gitlab-runner &>/dev/null; then echo "[SKIP] GitLab Runner installed"; exit 0; fi
curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.$(command -v apt-get &>/dev/null && echo deb || echo rpm).sh" | sudo bash
if command -v apt-get &>/dev/null; then sudo apt-get install -y gitlab-runner; else sudo yum install -y gitlab-runner; fi
sudo systemctl start gitlab-runner && sudo systemctl enable gitlab-runner
echo "[DONE] $(gitlab-runner --version | head -1)"` },

  'argocd-cli': { name: 'Argo CD CLI', category: 'cicd', script: `#!/bin/bash
set -e
if command -v argocd &>/dev/null; then echo "[SKIP] argocd installed"; exit 0; fi
ARGOCD_VER=$(curl -sI https://github.com/argoproj/argo-cd/releases/latest | grep -i location | sed 's|.*/||' | tr -d '\r')
curl -sLO "https://github.com/argoproj/argo-cd/releases/download/\${ARGOCD_VER}/argocd-linux-amd64"
sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd && rm argocd-linux-amd64
echo "[DONE] argocd installed"` },

  'awscli': { name: 'AWS CLI v2', category: 'cloud', script: `#!/bin/bash
set -e
if command -v aws &>/dev/null; then echo "[SKIP] $(aws --version)"; exit 0; fi
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install && rm -rf /tmp/aws /tmp/awscliv2.zip
echo "[DONE] $(aws --version)"` },

  'azure-cli': { name: 'Azure CLI', category: 'cloud', script: `#!/bin/bash
set -e
if command -v az &>/dev/null; then echo "[SKIP] Azure CLI installed"; exit 0; fi
if command -v apt-get &>/dev/null; then curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash; else
  sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
  echo -e "[azure-cli]\nname=Azure CLI\nbaseurl=https://packages.microsoft.com/yumrepos/azure-cli\nenabled=1\ngpgcheck=1\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc" | sudo tee /etc/yum.repos.d/azure-cli.repo
  sudo yum install -y azure-cli
fi
echo "[DONE] Azure CLI installed"` },

  'prometheus-node-exporter': { name: 'Prometheus Node Exporter', category: 'observability', script: `#!/bin/bash
set -e
if command -v node_exporter &>/dev/null; then echo "[SKIP] node_exporter installed"; exit 0; fi
NE_VER="1.8.1"
curl -sLO "https://github.com/prometheus/node_exporter/releases/download/v\${NE_VER}/node_exporter-\${NE_VER}.linux-amd64.tar.gz"
tar xzf "node_exporter-\${NE_VER}.linux-amd64.tar.gz"
sudo mv "node_exporter-\${NE_VER}.linux-amd64/node_exporter" /usr/local/bin/
rm -rf "node_exporter-\${NE_VER}.linux-amd64"*
sudo useradd -rs /bin/false node_exporter 2>/dev/null || true
sudo tee /etc/systemd/system/node_exporter.service > /dev/null << 'SVC'
[Unit]
Description=Prometheus Node Exporter
[Service]
User=node_exporter
ExecStart=/usr/local/bin/node_exporter
[Install]
WantedBy=multi-user.target
SVC
sudo systemctl daemon-reload && sudo systemctl start node_exporter && sudo systemctl enable node_exporter
echo "[DONE] Node Exporter running on :9100"` },

  'fail2ban': { name: 'Fail2ban', category: 'security', script: `#!/bin/bash
set -e
if command -v fail2ban-client &>/dev/null; then echo "[SKIP] fail2ban installed"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y fail2ban; else sudo yum install -y fail2ban; fi
sudo systemctl start fail2ban && sudo systemctl enable fail2ban
echo "[DONE] Fail2ban installed"` },

  'certbot': { name: "Certbot (Let's Encrypt)", category: 'security', script: `#!/bin/bash
set -e
if command -v certbot &>/dev/null; then echo "[SKIP] $(certbot --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y certbot python3-certbot-nginx; else sudo yum install -y certbot python3-certbot-nginx; fi
echo "[DONE] $(certbot --version)"` },

  'trivy': { name: 'Trivy (container scanner)', category: 'security', script: `#!/bin/bash
set -e
if command -v trivy &>/dev/null; then echo "[SKIP] $(trivy --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then
  sudo apt-get install -y wget apt-transport-https gnupg
  wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
  echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | sudo tee /etc/apt/sources.list.d/trivy.list
  sudo apt-get update && sudo apt-get install -y trivy
else
  TRIVY_VER=$(curl -s https://api.github.com/repos/aquasecurity/trivy/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/v//')
  wget -qO- "https://github.com/aquasecurity/trivy/releases/download/v\${TRIVY_VER}/trivy_\${TRIVY_VER}_Linux-64bit.tar.gz" | sudo tar xzf - -C /usr/local/bin trivy
fi
echo "[DONE] $(trivy --version)"` },

  'nginx': { name: 'Nginx', category: 'webserver', script: `#!/bin/bash
set -e
if command -v nginx &>/dev/null; then echo "[SKIP] $(nginx -v 2>&1)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y nginx; else sudo amazon-linux-extras install nginx1 -y 2>/dev/null || sudo yum install -y nginx; fi
sudo systemctl start nginx && sudo systemctl enable nginx
echo "[DONE] $(nginx -v 2>&1)"` },

  'mysql': { name: 'MySQL 8', category: 'database', script: `#!/bin/bash
set -e
if command -v mysql &>/dev/null; then echo "[SKIP] $(mysql --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y mysql-server && sudo systemctl start mysql && sudo systemctl enable mysql; else sudo yum install -y mysql mysql-server && sudo systemctl start mysqld && sudo systemctl enable mysqld; fi
echo "[DONE] $(mysql --version)"` },

  'postgresql': { name: 'PostgreSQL 16', category: 'database', script: `#!/bin/bash
set -e
if command -v psql &>/dev/null; then echo "[SKIP] $(psql --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y postgresql && sudo systemctl start postgresql && sudo systemctl enable postgresql; else sudo yum install -y postgresql-server && sudo postgresql-setup --initdb && sudo systemctl start postgresql && sudo systemctl enable postgresql; fi
echo "[DONE] $(psql --version)"` },

  'redis': { name: 'Redis', category: 'database', script: `#!/bin/bash
set -e
if command -v redis-server &>/dev/null; then echo "[SKIP] $(redis-server --version)"; exit 0; fi
if command -v apt-get &>/dev/null; then sudo apt-get install -y redis-server; else sudo amazon-linux-extras install redis6 -y 2>/dev/null || sudo yum install -y redis; fi
sudo systemctl start redis && sudo systemctl enable redis
echo "[DONE] $(redis-server --version)"` },

  'mongodb': { name: 'MongoDB 7', category: 'database', script: `#!/bin/bash
set -e
if command -v mongod &>/dev/null; then echo "[SKIP] $(mongod --version | head -1)"; exit 0; fi
if command -v apt-get &>/dev/null; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
  sudo apt-get update && sudo apt-get install -y mongodb-org
else
  sudo tee /etc/yum.repos.d/mongodb-org-7.0.repo > /dev/null << 'REPO'
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/amazon/2/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-7.0.asc
REPO
  sudo yum install -y mongodb-org
fi
sudo systemctl start mongod && sudo systemctl enable mongod
echo "[DONE] $(mongod --version | head -1)"` },

  'istio': { name: 'Istio CLI (istioctl)', category: 'cncf', script: `#!/bin/bash
set -e
if command -v istioctl &>/dev/null; then echo "[SKIP] istioctl installed"; exit 0; fi
curl -sL https://istio.io/downloadIstio | sh -
ISTIO_DIR=$(ls -d istio-* 2>/dev/null | head -1)
sudo mv "\${ISTIO_DIR}/bin/istioctl" /usr/local/bin/
rm -rf "\${ISTIO_DIR}"
echo "[DONE] istioctl installed"` },

  'fluxcd': { name: 'Flux CD CLI', category: 'cncf', script: `#!/bin/bash
set -e
if command -v flux &>/dev/null; then echo "[SKIP] $(flux --version)"; exit 0; fi
curl -s https://fluxcd.io/install.sh | sudo bash
echo "[DONE] $(flux --version)"` },

  'tekton-cli': { name: 'Tekton CLI (tkn)', category: 'cncf', script: `#!/bin/bash
set -e
if command -v tkn &>/dev/null; then echo "[SKIP] tkn installed"; exit 0; fi
TKN_VER=$(curl -sI https://github.com/tektoncd/cli/releases/latest | grep -i location | sed 's|.*/||' | tr -d '\r')
curl -sLO "https://github.com/tektoncd/cli/releases/download/\${TKN_VER}/tkn_\${TKN_VER#v}_Linux_x86_64.tar.gz"
sudo tar xzf "tkn_\${TKN_VER#v}_Linux_x86_64.tar.gz" -C /usr/local/bin tkn
rm -f "tkn_\${TKN_VER#v}_Linux_x86_64.tar.gz"
echo "[DONE] tkn installed"` },

  'velero': { name: 'Velero (K8s backup)', category: 'cncf', script: `#!/bin/bash
set -e
if command -v velero &>/dev/null; then echo "[SKIP] velero installed"; exit 0; fi
VELERO_VER=$(curl -sI https://github.com/vmware-tanzu/velero/releases/latest | grep -i location | sed 's|.*/||' | tr -d '\r')
curl -sLO "https://github.com/vmware-tanzu/velero/releases/download/\${VELERO_VER}/velero-\${VELERO_VER}-linux-amd64.tar.gz"
tar xzf "velero-\${VELERO_VER}-linux-amd64.tar.gz"
sudo mv "velero-\${VELERO_VER}-linux-amd64/velero" /usr/local/bin/
rm -rf "velero-\${VELERO_VER}-linux-amd64"*
echo "[DONE] velero installed"` },

  'kustomize': { name: 'Kustomize', category: 'cncf', script: `#!/bin/bash
set -e
if command -v kustomize &>/dev/null; then echo "[SKIP] $(kustomize version)"; exit 0; fi
curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash
sudo mv kustomize /usr/local/bin/
echo "[DONE] $(kustomize version)"` },

  'open-policy-agent': { name: 'OPA (Open Policy Agent)', category: 'cncf', script: `#!/bin/bash
set -e
if command -v opa &>/dev/null; then echo "[SKIP] $(opa version)"; exit 0; fi
curl -sL -o opa https://openpolicyagent.org/downloads/latest/opa_linux_amd64_static
chmod 755 opa && sudo mv opa /usr/local/bin/
echo "[DONE] $(opa version)"` },

  'devops-full-stack': { name: 'Full DevOps Stack (ALL)', category: 'bundle', script: `#!/bin/bash
set -e
echo "=== Full DevOps Stack Installer ==="
if command -v apt-get &>/dev/null; then sudo apt-get update -y; else sudo yum update -y; fi
sudo yum install -y curl wget git unzip jq vim htop 2>/dev/null || sudo apt-get install -y curl wget git unzip jq vim htop 2>/dev/null || true
if ! command -v node &>/dev/null; then
  if command -v apt-get &>/dev/null; then curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs; else curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs; fi
  sudo npm install -g pm2 yarn --silent
fi
echo "Node.js: $(node --version)"
if ! command -v docker &>/dev/null; then
  if command -v apt-get &>/dev/null; then curl -fsSL https://get.docker.com | sh; else sudo amazon-linux-extras install docker -y 2>/dev/null || sudo yum install -y docker; fi
  sudo systemctl start docker && sudo systemctl enable docker && sudo usermod -aG docker $(whoami) 2>/dev/null || true
fi
echo "Docker: $(docker --version)"
if ! command -v kubectl &>/dev/null; then KVER=$(curl -sL https://dl.k8s.io/release/stable.txt); curl -sLO "https://dl.k8s.io/release/\${KVER}/bin/linux/amd64/kubectl"; sudo install -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl; fi
echo "kubectl: installed"
if ! command -v helm &>/dev/null; then curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash; fi
echo "Helm: $(helm version --short)"
if ! command -v eksctl &>/dev/null; then curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz" | tar xz -C /tmp && sudo mv /tmp/eksctl /usr/local/bin; fi
echo "eksctl: $(eksctl version)"
if ! command -v terraform &>/dev/null; then
  if command -v apt-get &>/dev/null; then wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg; echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list; sudo apt-get update -y && sudo apt-get install -y terraform; else sudo yum install -y yum-utils; sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo; sudo yum install -y terraform; fi
fi
echo "Terraform: $(terraform version | head -1)"
if ! command -v aws &>/dev/null; then curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip && unzip -q /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install && rm -rf /tmp/aws /tmp/awscliv2.zip; fi
echo "AWS CLI: $(aws --version)"
if ! command -v nginx &>/dev/null; then if command -v apt-get &>/dev/null; then sudo apt-get install -y nginx; else sudo amazon-linux-extras install nginx1 -y 2>/dev/null || sudo yum install -y nginx; fi; sudo systemctl start nginx && sudo systemctl enable nginx; fi
echo "Nginx: $(nginx -v 2>&1)"
echo ""
echo "=== Full DevOps Stack Complete! ==="
for tool in git node docker kubectl helm eksctl terraform aws nginx; do command -v $tool &>/dev/null && echo "  OK $tool" || echo "  MISSING $tool"; done` },

  'kubernetes-apps': { name: 'CNCF Apps on K8s Cluster', category: 'bundle', script: `#!/bin/bash
set -e
echo "=== Installing CNCF Apps on Kubernetes ==="
if ! command -v kubectl &>/dev/null; then echo "[ERROR] kubectl required"; exit 1; fi
if ! command -v helm &>/dev/null; then echo "[ERROR] helm required"; exit 1; fi
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx 2>/dev/null || true
helm repo add cert-manager https://charts.jetstack.io 2>/dev/null || true
helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null || true
helm repo update
kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --wait --timeout 5m || echo "[WARN] ingress-nginx issue"
kubectl create namespace cert-manager --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
helm upgrade --install cert-manager cert-manager/cert-manager -n cert-manager --set installCRDs=true --wait --timeout 5m || echo "[WARN] cert-manager issue"
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
helm upgrade --install kube-prom prometheus-community/kube-prometheus-stack -n monitoring --wait --timeout 10m --set grafana.adminPassword=devops123 || echo "[WARN] prometheus issue"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
helm upgrade --install argocd argo/argo-cd -n argocd --wait --timeout 10m || echo "[WARN] argocd issue"
echo "=== CNCF Stack Done! ==="
kubectl get pods -A | grep -E "ingress|cert|monitoring|argocd" || kubectl get pods -A` }
};

router.get('/ec2-packages/list', (req, res) => {
  const categories = {};
  for (const [id, pkg] of Object.entries(SCRIPTS)) {
    if (!categories[pkg.category]) categories[pkg.category] = [];
    categories[pkg.category].push({ id, name: pkg.name, category: pkg.category });
  }
  res.json({ categories, total: Object.keys(SCRIPTS).length });
});

router.post('/ec2-packages/install', (req, res) => {
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ error: 'packageId required' });
  const pkg = SCRIPTS[packageId];
  if (!pkg) return res.status(404).json({ error: `Package "${packageId}" not found` });
  let connConfig;
  try { connConfig = getConnConfig(req.body); } catch(err) { return res.status(400).json({ error: err.message }); }
  sshStream(res, uuidv4().substring(0,8), connConfig, pkg.script);
});

router.post('/ec2-packages/install-many', (req, res) => {
  const { packageIds = [] } = req.body;
  if (!packageIds.length) return res.status(400).json({ error: 'packageIds required' });
  let connConfig;
  try { connConfig = getConnConfig(req.body); } catch(err) { return res.status(400).json({ error: err.message }); }
  const combined = packageIds.map(id => SCRIPTS[id]).filter(Boolean).map(p => `
echo ""; echo "======================================"; echo "  Installing: ${p.name}"; echo "======================================"
${p.script}`).join('\n');
  sshStream(res, uuidv4().substring(0,8), connConfig, combined);
});

router.post('/ec2-packages/check', (req, res) => {
  let connConfig;
  try { connConfig = getConnConfig(req.body); } catch(err) { return res.status(400).json({ error: err.message }); }
  const script = `#!/bin/bash
echo "=== System Info ===" && cat /etc/os-release | grep PRETTY_NAME && uname -r && echo ""
echo "=== DevOps Tools ==="
for tool in git node npm docker kubectl helm terraform ansible aws eksctl nginx caddy python3 java go jenkins argocd flux tkn k9s istioctl velero kustomize opa trivy certbot redis-server mongod psql mysql; do
  if command -v $tool &>/dev/null; then echo "OK $tool: $($tool --version 2>&1 | head -1 | cut -c1-50)"; else echo "MISSING $tool"; fi
done
echo ""; echo "=== Services ==="
for svc in docker nginx jenkins redis mongod postgresql mysql; do systemctl is-active --quiet $svc 2>/dev/null && echo "RUNNING $svc" || echo "STOPPED $svc"; done
echo ""; echo "=== Resources ===" && df -h / && free -h`;
  sshStream(res, uuidv4().substring(0,8), connConfig, script);
});

module.exports = router;
