# DevOps as a Service Platform

[\![Docker Image](https://img.shields.io/badge/docker-sriniv7654%2Fdevops--as--a--service-blue)](https://hub.docker.com/r/sriniv7654/devops-as-a-service)

A production-grade DevOps-as-a-Service portal that runs on any Linux server. Single-click provisioning of AWS infrastructure, Kubernetes, Docker, CI/CD, and more — with real-time log streaming and idempotent operations.

---

## Quick Start (One Command)

```bash
git clone https://github.com/sriniv7654/devops-as-a-service.git
cd devops-as-a-service
bash start.sh
```

The `start.sh` script will present a menu:

```
  1) Run app locally         (Node.js, port 8080)
  2) Containerize & run      (Docker, port 80)
  3) Check status            (verify if app is running)
```

- **Option 1** — Installs Node.js dependencies and starts the app on port 8080
- **Option 2** — Builds a Docker image, runs it on port 80, and optionally pushes to Docker Hub
- **Option 3** — Checks if the app is running and prints the URL

After starting, open: `http://<YOUR_IP>:8080`  
**Login: `admin` / `password`**

---

## Prerequisites

| Tool | Required For |
|------|-------------|
| Node.js v18+ | Option 1 (local) |
| Docker | Option 2 (container) |
| `curl` | Status checks |

Install DevOps tools (AWS CLI, kubectl, Helm, eksctl, Terraform) on the server:

```bash
bash scripts/install-tools.sh
```

---

## Deploy on AWS EC2

```bash
# 1. Launch EC2 (Amazon Linux 2 or Ubuntu, t3.medium+)
# 2. Allow port 8080 (or 80) in Security Group

# 3. SSH in and run:
curl -fsSL https://raw.githubusercontent.com/sriniv7654/devops-as-a-service/main/scripts/install-tools.sh | bash
git clone https://github.com/sriniv7654/devops-as-a-service.git
cd devops-as-a-service
bash start.sh
# Choose option 1 or 2
```

---

## Docker

```bash
# Pull from Docker Hub
docker pull sriniv7654/devops-as-a-service:latest

# Run on port 80
docker run -d \
  --name devops-portal \
  -p 80:8080 \
  --restart unless-stopped \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  sriniv7654/devops-as-a-service:latest

# Build locally
docker build -t sriniv7654/devops-as-a-service .
```

---

## Top 30 Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | IAM Credential Vault | Store AWS keys session-based, never persisted to disk |
| 2 | Terraform EC2 Provisioner | AMI, instance type, VPC, SG — generates & applies Terraform |
| 3 | EKS Cluster Deployer | Full EKS with managed nodes, OIDC, metrics-server via eksctl |
| 4 | Auto Scaling Group Wizard | Launch template, scaling policies, min/max/desired |
| 5 | Virtual SSH Shell Terminal | Browser-based SSH terminal with PEM key or password auth |
| 6 | Nginx Config Generator | Server blocks, SSL/TLS, reverse proxy, security headers |
| 7 | Docker Task Runner | Build, run, inspect, logs, container listing |
| 8 | Kubernetes Resource Manager | apply, get, describe, rollout, scale via kubectl |
| 9 | Helm Chart Deployer | repo add, install/upgrade, rollback |
| 10 | S3 Bucket Manager | Create, list, browse, versioning, encryption, public block |
| 11 | RDS Instance Provisioner | Engine, size, multi-AZ, subnet group, backup |
| 12 | VPC Builder | CIDR, public/private subnets, IGW, NAT via Terraform |
| 13 | IAM Role/Policy Creator | Trust policy, managed policy attachment |
| 14 | CloudWatch Log Viewer | Log groups, filter events, pattern matching |
| 15 | Route53 DNS Manager | Hosted zones, A/CNAME/TXT/MX UPSERT |
| 16 | ALB Load Balancer Wizard | Target groups, listeners, health checks |
| 17 | Lambda Invoker | Invoke functions, view logs and response |
| 18 | ECR Registry Manager | Create repo, ECR login, push commands |
| 19 | Secrets Manager | Store, retrieve, list secrets |
| 20 | ACM Certificate Manager | Request, list certificates |
| 21 | Security Group Manager | Create, list, add inbound rules |
| 22 | Cost Explorer Dashboard | Last 30 days by service with cost bars |
| 23 | Template Marketplace | 5 built-in templates (MEAN, EKS microservices, 3-tier, static site, serverless) |
| 24 | CI/CD Pipeline Generator | GitHub Actions YAML for EC2, EKS, S3 deploy targets |
| 25 | Real-time Log Console | WebSocket-streamed output from all jobs |
| 26 | Idempotent Script Runner | dry-run mode on every resource |
| 27 | Infrastructure State Viewer | Live EC2/EKS/S3/ASG/ALB resource counts |
| 28 | SNS Notifications | Publish to SNS topics |
| 29 | Audit Trail | SQLite-backed history of every action (user, action, status) |
| 30 | One-Click Template Deploy | Parametrized templates with form-driven input |

---

## Architecture

```
devops-portal/
├── app.js                    # Express server + WebSocket (port 8080)
├── middleware/
│   └── auth.js               # Session-based login
├── routes/
│   ├── aws-core.js           # Credentials, regions, resources, SGs
│   ├── infrastructure.js     # EC2/VPC Terraform, ASG, RDS, ALB
│   ├── containers.js         # EKS, K8s, Helm, Docker, ECR
│   ├── services.js           # S3, IAM, Secrets, Lambda, R53, ACM, Logs, SNS, Nginx
│   ├── terminal.js           # SSH exec + session management
│   ├── terminal-ws.js        # WebSocket SSH shell
│   └── advanced.js           # Audit trail, CI/CD gen, Cost Explorer, Templates
├── public/
│   ├── index.html            # Full SPA frontend (industrial terminal theme)
│   └── app.js                # Frontend JS (all 19 service modules)
├── scripts/
│   ├── install-tools.sh      # Install AWS CLI, kubectl, helm, eksctl, terraform
│   ├── deploy-app.sh         # Deploy on EC2 with PM2
│   ├── templates/            # Terraform templates
│   └── k8s/                  # Kubernetes manifests
├── Dockerfile
├── start.sh                  # Interactive quick-start
└── README.md
```

---

## Security Notes

- Credentials stored in server-side session only (not in DB or logs)
- All routes behind session auth
- Helmet.js security headers
- Rate limiting on all `/api/` routes
- Session expires after 8 hours
- For production: change `SESSION_SECRET` in `.env` and enable HTTPS

---

## Default Credentials

| Username | Password | Role |
|----------|----------|------|
| `admin` | `password` | admin |
| `ec2-user` | `password` | user |

**Change these before deploying to production.**
