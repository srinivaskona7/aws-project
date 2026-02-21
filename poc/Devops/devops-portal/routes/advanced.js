'use strict';
const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');

// SQLite for audit trail (using sqlite3 async driver)
let db = null;
try {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(process.cwd(), 'devops-portal.db');
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.warn('[DB] SQLite open error:', err.message); db = null; return; }
    db.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT,
      params TEXT,
      output TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      completed_at INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS saved_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      content TEXT NOT NULL,
      author TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    `);
    console.log('[DB] SQLite audit database initialized');
  });
} catch (err) {
  console.warn('[DB] SQLite not available, audit logging disabled:', err.message);
}

function getCfg(req) {
  if (!req.session.awsCreds) throw new Error('AWS credentials not configured');
  const { accessKeyId, secretAccessKey, region, sessionToken } = req.session.awsCreds;
  const credentials = { accessKeyId, secretAccessKey };
  if (sessionToken) credentials.sessionToken = sessionToken;
  return { region: region || 'us-east-1', credentials };
}

// ===== AUDIT TRAIL =====
router.post('/audit/log', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Audit DB not available' });
  const { action, resource, params, output, status = 'completed' } = req.body;
  const id = uuidv4();
  const user = req.session.user?.username || 'unknown';
  db.run('INSERT INTO audit_log (id, user, action, resource, params, output, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, user, action, resource, JSON.stringify(params), output, status],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id });
    });
});

router.get('/audit/logs', (req, res) => {
  if (!db) return res.json({ logs: [], message: 'Audit DB not available' });
  const { limit = 50, user, action } = req.query;
  let query = 'SELECT * FROM audit_log';
  const params = [];
  const conditions = [];
  if (user) { conditions.push('user = ?'); params.push(user); }
  if (action) { conditions.push('action LIKE ?'); params.push(`%${action}%`); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)}`;
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ logs: (rows || []).map(l => ({ ...l, params: (() => { try { return JSON.parse(l.params); } catch { return l.params; } })() })) });
  });
});

// ===== CI/CD PIPELINE GENERATOR =====
router.post('/cicd/generate', (req, res) => {
  const { type = 'github-actions', appType = 'node', deployTarget = 'ec2', repoName = 'my-app', region = 'us-east-1', ecr, eksCluster, s3Bucket } = req.body;

  let yaml = '';

  if (type === 'github-actions') {
    if (deployTarget === 'eks') {
      yaml = `name: Deploy to EKS

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  AWS_REGION: ${region}
  ECR_REPOSITORY: ${ecr || repoName}
  EKS_CLUSTER: ${eksCluster || repoName + '-cluster'}
  IMAGE_TAG: \${{ github.sha }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${region}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to ECR
        env:
          ECR_REGISTRY: \${{ steps.login-ecr.outputs.registry }}
        run: |
          docker build -t \$ECR_REGISTRY/\$ECR_REPOSITORY:\$IMAGE_TAG .
          docker push \$ECR_REGISTRY/\$ECR_REPOSITORY:\$IMAGE_TAG
          echo "image=\$ECR_REGISTRY/\$ECR_REPOSITORY:\$IMAGE_TAG" >> \$GITHUB_OUTPUT

      - name: Update kube config
        run: aws eks update-kubeconfig --name \$EKS_CLUSTER --region \$AWS_REGION

      - name: Deploy to EKS
        run: |
          kubectl set image deployment/${repoName} app=\${{ steps.login-ecr.outputs.registry }}/\$ECR_REPOSITORY:\$IMAGE_TAG
          kubectl rollout status deployment/${repoName}
          kubectl get services -o wide
`;
    } else if (deployTarget === 'ec2') {
      yaml = `name: Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - run: npm ci && npm test

      - name: Deploy to EC2 via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: \${{ secrets.EC2_HOST }}
          username: \${{ secrets.EC2_USER }}
          key: \${{ secrets.EC2_PRIVATE_KEY }}
          script: |
            cd /home/ec2-user/${repoName}
            git pull origin main
            npm ci --production
            pm2 restart ${repoName} || pm2 start app.js --name ${repoName}
            pm2 save
`;
    } else if (deployTarget === 's3') {
      yaml = `name: Deploy Static Site to S3

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - name: Deploy to S3
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${region}
      - run: aws s3 sync ./build s3://${s3Bucket || repoName} --delete
      - run: aws cloudfront create-invalidation --distribution-id \${{ secrets.CF_DISTRIBUTION_ID }} --paths "/*" || echo "No CloudFront"
`;
    }
  }

  res.json({ success: true, yaml, type, deployTarget, filename: '.github/workflows/deploy.yml' });
});

// ===== COST EXPLORER =====
router.get('/cost/summary', async (req, res) => {
  try {
    const cfg = getCfg(req);
    const ce = new CostExplorerClient({ ...cfg, region: 'us-east-1' }); // CE is global
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);

    const data = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: {
        Start: start.toISOString().split('T')[0],
        End: end.toISOString().split('T')[0]
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
    }));

    const services = [];
    for (const result of data.ResultsByTime || []) {
      for (const group of result.Groups || []) {
        const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount || 0);
        if (cost > 0.01) {
          services.push({ service: group.Keys?.[0], cost: cost.toFixed(4), currency: group.Metrics?.UnblendedCost?.Unit });
        }
      }
    }
    services.sort((a, b) => parseFloat(b.cost) - parseFloat(a.cost));
    const total = services.reduce((sum, s) => sum + parseFloat(s.cost), 0);
    res.json({ success: true, services, totalCost: total.toFixed(4), period: '30 days' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== TEMPLATE MARKETPLACE =====
const builtinTemplates = [
  {
    id: 'tpl-001',
    name: 'MEAN Stack on EC2',
    description: 'MongoDB, Express, Angular, Node.js on single EC2 instance with nginx reverse proxy',
    category: 'Web Application',
    tags: ['nodejs', 'mongodb', 'nginx', 'ec2'],
    params: [
      { name: 'instanceType', label: 'Instance Type', default: 't3.small', type: 'select', options: ['t3.micro', 't3.small', 't3.medium', 't3.large'] },
      { name: 'dbPassword', label: 'MongoDB Password', type: 'password', required: true },
      { name: 'keyName', label: 'EC2 Key Pair', type: 'text', required: true }
    ]
  },
  {
    id: 'tpl-002',
    name: 'Microservices on EKS',
    description: 'API Gateway + 3 microservices + PostgreSQL RDS on EKS with ALB ingress',
    category: 'Kubernetes',
    tags: ['eks', 'kubernetes', 'microservices', 'rds', 'alb'],
    params: [
      { name: 'clusterName', label: 'Cluster Name', type: 'text', default: 'microservices-cluster' },
      { name: 'nodeType', label: 'Node Instance Type', default: 't3.medium', type: 'select', options: ['t3.small', 't3.medium', 't3.large'] },
      { name: 'minNodes', label: 'Min Nodes', type: 'number', default: 2 },
      { name: 'maxNodes', label: 'Max Nodes', type: 'number', default: 10 }
    ]
  },
  {
    id: 'tpl-003',
    name: '3-Tier Architecture',
    description: 'VPC + ALB + Auto Scaling web tier + RDS MySQL with full security hardening',
    category: 'Infrastructure',
    tags: ['vpc', 'alb', 'asg', 'rds', '3-tier'],
    params: [
      { name: 'appName', label: 'Application Name', type: 'text', required: true },
      { name: 'vpcCidr', label: 'VPC CIDR', type: 'text', default: '10.0.0.0/16' },
      { name: 'dbPassword', label: 'DB Master Password', type: 'password', required: true }
    ]
  },
  {
    id: 'tpl-004',
    name: 'Static Site + CDN',
    description: 'S3 + CloudFront + ACM certificate + Route53 for blazing fast static sites',
    category: 'Static Web',
    tags: ['s3', 'cloudfront', 'acm', 'route53'],
    params: [
      { name: 'domainName', label: 'Domain Name', type: 'text', required: true },
      { name: 'bucketName', label: 'S3 Bucket Name', type: 'text', required: true }
    ]
  },
  {
    id: 'tpl-005',
    name: 'Serverless API',
    description: 'API Gateway + Lambda + DynamoDB serverless stack with IAM roles',
    category: 'Serverless',
    tags: ['lambda', 'api-gateway', 'dynamodb', 'serverless'],
    params: [
      { name: 'apiName', label: 'API Name', type: 'text', required: true },
      { name: 'runtime', label: 'Runtime', type: 'select', options: ['nodejs18.x', 'python3.11', 'java17'], default: 'nodejs18.x' }
    ]
  }
];

router.get('/templates', (req, res) => {
  const { category, search } = req.query;
  let templates = [...builtinTemplates];
  if (category) templates = templates.filter(t => t.category.toLowerCase().includes(category.toLowerCase()));
  if (search) templates = templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()));
  res.json({ templates, total: templates.length });
});

router.get('/templates/:id', (req, res) => {
  const tpl = builtinTemplates.find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: tpl });
});

// POST /api/templates/:id/deploy - Deploy a template
router.post('/templates/:id/deploy', async (req, res) => {
  const tpl = builtinTemplates.find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const { params } = req.body;

  // Log to audit
  if (db) {
    db.run('INSERT INTO audit_log (id, user, action, resource, params, status) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.session.user?.username || 'unknown', 'template_deploy', tpl.name, JSON.stringify(params), 'initiated']);
  }

  res.json({ success: true, message: `Template "${tpl.name}" deployment initiated`, templateId: req.params.id, params, jobId: uuidv4().substring(0, 8) });
});

module.exports = router;
