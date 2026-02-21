'use strict';
const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const WORK_DIR = path.join(os.tmpdir(), 'devops-portal');

async function ensureDirs() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
}
ensureDirs();

function streamOutput(res, jobId, command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendLine = (line) => res.write(`data: ${JSON.stringify({ jobId, line, ts: Date.now() })}\n\n`);
    sendLine(`[JOB:${jobId}] Starting: ${command} ${args.join(' ')}`);

    const proc = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: true });
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(sendLine));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => sendLine(`[STDERR] ${l}`)));
    proc.on('close', code => {
      sendLine(`[JOB:${jobId}] Exit code: ${code}`);
      res.write(`data: ${JSON.stringify({ jobId, done: true, exitCode: code })}\n\n`);
      res.end();
      code === 0 ? resolve(code) : reject(new Error(`Exit code ${code}`));
    });
    proc.on('error', err => {
      sendLine(`[ERROR] ${err.message}`);
      res.end();
      reject(err);
    });
  });
}

// POST /api/terraform/ec2 - Generate Terraform and apply
router.post('/terraform/ec2', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    instanceName = 'devops-ec2',
    instanceType = 't3.micro',
    amiId = 'ami-0c55b159cbfafe1f0',
    keyName,
    vpcId,
    subnetId,
    securityGroupIds = [],
    tags = {},
    dryRun = false,
    region = 'us-east-1',
    accessKeyId,
    secretAccessKey
  } = req.body;

  const creds = req.session.awsCreds || {};
  const awsKey = accessKeyId || creds.accessKeyId;
  const awsSecret = secretAccessKey || creds.secretAccessKey;
  const awsRegion = region || creds.region || 'us-east-1';

  const jobDir = path.join(WORK_DIR, `tf-ec2-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });

  const tagBlock = Object.entries({ Name: instanceName, ManagedBy: 'devops-portal', ...tags })
    .map(([k, v]) => `    ${k} = "${v}"`).join('\n');

  const tfContent = `
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region     = "${awsRegion}"
  access_key = "${awsKey}"
  secret_key = "${awsSecret}"
}

resource "aws_instance" "${instanceName.replace(/-/g,'_')}" {
  ami           = "${amiId}"
  instance_type = "${instanceType}"
  ${keyName ? `key_name      = "${keyName}"` : ''}
  ${subnetId ? `subnet_id     = "${subnetId}"` : ''}
  ${securityGroupIds.length ? `vpc_security_group_ids = ${JSON.stringify(securityGroupIds)}` : ''}

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = {
${tagBlock}
  }

  lifecycle {
    create_before_destroy = true
  }
}

output "instance_id"  { value = aws_instance.${instanceName.replace(/-/g,'_')}.id }
output "public_ip"    { value = aws_instance.${instanceName.replace(/-/g,'_')}.public_ip }
output "private_ip"   { value = aws_instance.${instanceName.replace(/-/g,'_')}.private_ip }
`;

  await fs.writeFile(path.join(jobDir, 'main.tf'), tfContent);

  const action = dryRun ? 'plan' : 'apply -auto-approve';
  try {
    await streamOutput(res, jobId, 'bash', ['-c', `terraform init && terraform ${action}`], jobDir, {});
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/terraform/vpc - Full VPC with subnets, IGW, NAT
router.post('/terraform/vpc', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    vpcName = 'devops-vpc',
    cidr = '10.0.0.0/16',
    publicSubnets = ['10.0.1.0/24', '10.0.2.0/24'],
    privateSubnets = ['10.0.11.0/24', '10.0.12.0/24'],
    azs = ['us-east-1a', 'us-east-1b'],
    enableNat = true,
    dryRun = false,
    region = 'us-east-1'
  } = req.body;

  const creds = req.session.awsCreds || {};
  const jobDir = path.join(WORK_DIR, `tf-vpc-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });

  const publicSubnetBlocks = publicSubnets.map((cidr, i) => `
resource "aws_subnet" "public_${i}" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "${cidr}"
  availability_zone       = "${azs[i] || azs[0]}"
  map_public_ip_on_launch = true
  tags = { Name = "${vpcName}-public-${i+1}" }
}`).join('\n');

  const privateSubnetBlocks = privateSubnets.map((cidr, i) => `
resource "aws_subnet" "private_${i}" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "${cidr}"
  availability_zone = "${azs[i] || azs[0]}"
  tags = { Name = "${vpcName}-private-${i+1}" }
}`).join('\n');

  const tfContent = `
terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
provider "aws" {
  region     = "${region || creds.region || 'us-east-1'}"
  access_key = "${creds.accessKeyId}"
  secret_key = "${creds.secretAccessKey}"
}

resource "aws_vpc" "main" {
  cidr_block           = "${cidr}"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${vpcName}", ManagedBy = "devops-portal" }
}

${publicSubnetBlocks}
${privateSubnetBlocks}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${vpcName}-igw" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.igw.id }
  tags = { Name = "${vpcName}-public-rt" }
}

${publicSubnets.map((_, i) => `resource "aws_route_table_association" "pub_${i}" { subnet_id = aws_subnet.public_${i}.id; route_table_id = aws_route_table.public.id }`).join('\n')}

${enableNat ? `
resource "aws_eip" "nat" { domain = "vpc" }
resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_0.id
  tags = { Name = "${vpcName}-nat" }
  depends_on = [aws_internet_gateway.igw]
}
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; nat_gateway_id = aws_nat_gateway.nat.id }
  tags = { Name = "${vpcName}-private-rt" }
}
${privateSubnets.map((_, i) => `resource "aws_route_table_association" "priv_${i}" { subnet_id = aws_subnet.private_${i}.id; route_table_id = aws_route_table.private.id }`).join('\n')}
` : ''}

output "vpc_id" { value = aws_vpc.main.id }
output "public_subnet_ids" { value = [${publicSubnets.map((_, i) => `aws_subnet.public_${i}.id`).join(', ')}] }
`;

  await fs.writeFile(path.join(jobDir, 'main.tf'), tfContent);
  const action = dryRun ? 'plan' : 'apply -auto-approve';
  try {
    await streamOutput(res, jobId, 'bash', ['-c', `terraform init && terraform ${action}`], jobDir, {});
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/asg - Auto Scaling Group script
router.post('/asg', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    asgName = 'devops-asg',
    minSize = 1,
    maxSize = 5,
    desiredCapacity = 2,
    instanceType = 't3.micro',
    amiId = 'ami-0c55b159cbfafe1f0',
    keyName,
    subnetIds = [],
    targetGroupArn,
    dryRun = false,
    region = 'us-east-1'
  } = req.body;

  const creds = req.session.awsCreds || {};
  const awsRegion = region || creds.region || 'us-east-1';

  const script = `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="${creds.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${creds.secretAccessKey}"
export AWS_DEFAULT_REGION="${awsRegion}"

echo "[INFO] Creating Launch Template for ASG: ${asgName}"

# Create Launch Template (idempotent - check if exists)
LT_NAME="${asgName}-lt"
EXISTING_LT=$(aws ec2 describe-launch-templates --filters "Name=launch-template-name,Values=$LT_NAME" --query 'LaunchTemplates[0].LaunchTemplateId' --output text 2>/dev/null || echo "None")

if [ "$EXISTING_LT" = "None" ] || [ -z "$EXISTING_LT" ]; then
  echo "[INFO] Creating new Launch Template..."
  LT_ID=$(aws ec2 create-launch-template \\
    --launch-template-name "$LT_NAME" \\
    --version-description "v1" \\
    --launch-template-data '{
      "ImageId": "${amiId}",
      "InstanceType": "${instanceType}",
      ${keyName ? `"KeyName": "${keyName}",` : ''}
      "BlockDeviceMappings": [{"DeviceName": "/dev/xvda", "Ebs": {"VolumeSize": 20, "VolumeType": "gp3", "Encrypted": true}}],
      "TagSpecifications": [{"ResourceType": "instance", "Tags": [{"Key": "Name", "Value": "${asgName}-instance"}, {"Key": "ManagedBy", "Value": "devops-portal"}]}]
    }' \\
    --query 'LaunchTemplate.LaunchTemplateId' --output text)
  echo "[INFO] Launch Template created: $LT_ID"
else
  LT_ID="$EXISTING_LT"
  echo "[INFO] Using existing Launch Template: $LT_ID"
fi

# Create or update ASG
EXISTING_ASG=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "${asgName}" --query 'AutoScalingGroups[0].AutoScalingGroupName' --output text 2>/dev/null || echo "None")

if [ "$EXISTING_ASG" = "None" ] || [ -z "$EXISTING_ASG" ]; then
  echo "[INFO] Creating Auto Scaling Group: ${asgName}"
  aws autoscaling create-auto-scaling-group \\
    --auto-scaling-group-name "${asgName}" \\
    --launch-template "LaunchTemplateId=$LT_ID,Version=\\$Latest" \\
    --min-size ${minSize} \\
    --max-size ${maxSize} \\
    --desired-capacity ${desiredCapacity} \\
    ${subnetIds.length ? `--vpc-zone-identifier "${subnetIds.join(',')}"` : ''} \\
    ${targetGroupArn ? `--target-group-arns "${targetGroupArn}"` : ''} \\
    --health-check-type EC2 \\
    --health-check-grace-period 300 \\
    --tags "Key=ManagedBy,Value=devops-portal,PropagateAtLaunch=true"
  echo "[SUCCESS] ASG ${asgName} created"
else
  echo "[INFO] ASG ${asgName} already exists. Updating capacity..."
  aws autoscaling update-auto-scaling-group \\
    --auto-scaling-group-name "${asgName}" \\
    --min-size ${minSize} \\
    --max-size ${maxSize} \\
    --desired-capacity ${desiredCapacity}
  echo "[SUCCESS] ASG ${asgName} updated"
fi

# Create scaling policies
echo "[INFO] Creating scale-out policy..."
SCALE_OUT=$(aws autoscaling put-scaling-policy \\
  --auto-scaling-group-name "${asgName}" \\
  --policy-name "${asgName}-scale-out" \\
  --policy-type TargetTrackingScaling \\
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {"PredefinedMetricType": "ASGAverageCPUUtilization"},
    "TargetValue": 70.0
  }' --query 'PolicyARN' --output text)
echo "[INFO] Scale-out policy: $SCALE_OUT"

echo "[DONE] Auto Scaling Group setup complete!"
`;

  const jobDir = path.join(WORK_DIR, `asg-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'setup-asg.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });

  if (dryRun) {
    res.json({ success: true, script, message: 'Dry run - script generated but not executed' });
    return;
  }

  try {
    await streamOutput(res, jobId, 'bash', [scriptPath], jobDir, {});
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/rds - Provision RDS instance
router.post('/rds', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    dbIdentifier = 'devops-db',
    engine = 'mysql',
    engineVersion = '8.0',
    instanceClass = 'db.t3.micro',
    allocatedStorage = 20,
    masterUsername = 'admin',
    masterPassword,
    subnetIds = [],
    securityGroupIds = [],
    multiAz = false,
    dryRun = false
  } = req.body;

  if (!masterPassword) return res.status(400).json({ error: 'masterPassword is required' });
  const creds = req.session.awsCreds || {};

  const script = `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="${creds.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${creds.secretAccessKey}"
export AWS_DEFAULT_REGION="${creds.region || 'us-east-1'}"

echo "[INFO] Provisioning RDS instance: ${dbIdentifier}"

# Check if DB subnet group exists, create if not
SG_NAME="${dbIdentifier}-subnet-group"
EXISTING_SG=$(aws rds describe-db-subnet-groups --db-subnet-group-name "$SG_NAME" --query 'DBSubnetGroups[0].DBSubnetGroupName' --output text 2>/dev/null || echo "None")
if [ "$EXISTING_SG" = "None" ] || [ -z "$EXISTING_SG" ]; then
  ${subnetIds.length ? `aws rds create-db-subnet-group --db-subnet-group-name "$SG_NAME" --db-subnet-group-description "Created by devops-portal" --subnet-ids ${subnetIds.join(' ')}` : 'echo "[WARN] No subnets specified, using default"'}
fi

# Check if RDS instance already exists (idempotent)
EXISTING=$(aws rds describe-db-instances --db-instance-identifier "${dbIdentifier}" --query 'DBInstances[0].DBInstanceIdentifier' --output text 2>/dev/null || echo "None")
if [ "$EXISTING" != "None" ] && [ -n "$EXISTING" ]; then
  echo "[INFO] RDS instance ${dbIdentifier} already exists"
  STATUS=$(aws rds describe-db-instances --db-instance-identifier "${dbIdentifier}" --query 'DBInstances[0].DBInstanceStatus' --output text)
  ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "${dbIdentifier}" --query 'DBInstances[0].Endpoint.Address' --output text)
  echo "[STATUS] Status: $STATUS | Endpoint: $ENDPOINT"
  exit 0
fi

echo "[INFO] Creating RDS instance..."
aws rds create-db-instance \\
  --db-instance-identifier "${dbIdentifier}" \\
  --db-instance-class "${instanceClass}" \\
  --engine "${engine}" \\
  --engine-version "${engineVersion}" \\
  --master-username "${masterUsername}" \\
  --master-user-password "${masterPassword}" \\
  --allocated-storage ${allocatedStorage} \\
  --storage-type gp3 \\
  --storage-encrypted \\
  ${multiAz ? '--multi-az' : '--no-multi-az'} \\
  ${securityGroupIds.length ? `--vpc-security-group-ids ${securityGroupIds.join(' ')}` : ''} \\
  ${subnetIds.length ? `--db-subnet-group-name "$SG_NAME"` : ''} \\
  --backup-retention-period 7 \\
  --auto-minor-version-upgrade \\
  --deletion-protection \\
  --tags Key=ManagedBy,Value=devops-portal

echo "[INFO] Waiting for RDS to become available (this may take several minutes)..."
aws rds wait db-instance-available --db-instance-identifier "${dbIdentifier}"
ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "${dbIdentifier}" --query 'DBInstances[0].Endpoint.Address' --output text)
echo "[SUCCESS] RDS instance ready! Endpoint: $ENDPOINT"
`;

  if (dryRun) return res.json({ success: true, script });
  const jobDir = path.join(WORK_DIR, `rds-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'setup-rds.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  try {
    await streamOutput(res, jobId, 'bash', [scriptPath], jobDir, {});
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/alb - Application Load Balancer
router.post('/alb', async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const {
    albName = 'devops-alb',
    scheme = 'internet-facing',
    subnetIds = [],
    securityGroupIds = [],
    targetPort = 80,
    targetProtocol = 'HTTP',
    healthCheckPath = '/health',
    dryRun = false
  } = req.body;

  const creds = req.session.awsCreds || {};
  const script = `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="${creds.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${creds.secretAccessKey}"
export AWS_DEFAULT_REGION="${creds.region || 'us-east-1'}"

echo "[INFO] Creating ALB: ${albName}"

# Check if ALB exists
EXISTING_ARN=$(aws elbv2 describe-load-balancers --names "${albName}" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")
if [ "$EXISTING_ARN" != "None" ] && [ -n "$EXISTING_ARN" ]; then
  echo "[INFO] ALB ${albName} already exists: $EXISTING_ARN"
else
  ALB_ARN=$(aws elbv2 create-load-balancer \\
    --name "${albName}" \\
    --type application \\
    --scheme "${scheme}" \\
    --subnets ${subnetIds.join(' ')} \\
    --security-groups ${securityGroupIds.join(' ')} \\
    --ip-address-type ipv4 \\
    --tags Key=ManagedBy,Value=devops-portal \\
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  EXISTING_ARN="$ALB_ARN"
  echo "[INFO] ALB created: $ALB_ARN"
fi

# Create target group (idempotent)
TG_NAME="${albName}-tg"
EXISTING_TG=$(aws elbv2 describe-target-groups --names "$TG_NAME" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || echo "None")
if [ "$EXISTING_TG" = "None" ] || [ -z "$EXISTING_TG" ]; then
  VPC_ID=$(aws elbv2 describe-load-balancers --load-balancer-arns "$EXISTING_ARN" --query 'LoadBalancers[0].VpcId' --output text)
  TG_ARN=$(aws elbv2 create-target-group \\
    --name "$TG_NAME" \\
    --protocol "${targetProtocol}" \\
    --port ${targetPort} \\
    --vpc-id "$VPC_ID" \\
    --health-check-path "${healthCheckPath}" \\
    --health-check-interval-seconds 30 \\
    --healthy-threshold-count 2 \\
    --unhealthy-threshold-count 3 \\
    --target-type instance \\
    --query 'TargetGroups[0].TargetGroupArn' --output text)
  echo "[INFO] Target Group created: $TG_ARN"

  # Create listener
  aws elbv2 create-listener \\
    --load-balancer-arn "$EXISTING_ARN" \\
    --protocol HTTP \\
    --port 80 \\
    --default-actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
  echo "[INFO] Listener created on port 80"
fi

DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$EXISTING_ARN" --query 'LoadBalancers[0].DNSName' --output text)
echo "[SUCCESS] ALB ready! DNS: $DNS"
`;

  if (dryRun) return res.json({ success: true, script });
  const jobDir = path.join(WORK_DIR, `alb-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'setup-alb.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  try {
    await streamOutput(res, jobId, 'bash', [scriptPath], jobDir, {});
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/scripts/templates - list available templates
router.get('/scripts/templates', async (req, res) => {
  const templates = [
    { id: 'ec2-basic', name: 'Basic EC2 Instance', desc: 'Single EC2 with SG and EIP', service: 'terraform' },
    { id: 'eks-cluster', name: 'EKS Cluster', desc: 'EKS with managed node groups', service: 'eks' },
    { id: 'vpc-3tier', name: '3-Tier VPC', desc: 'VPC with public/private/db subnets', service: 'terraform' },
    { id: 'asg-web', name: 'Auto Scaling Web Fleet', desc: 'ASG with ALB for web tier', service: 'asg' },
    { id: 'rds-mysql', name: 'MySQL RDS', desc: 'Multi-AZ MySQL with backups', service: 'rds' },
    { id: 'mean-stack', name: 'MEAN Stack', desc: 'MongoDB, Express, Angular, Node on EC2', service: 'template' },
    { id: 'microservices', name: 'Microservices on EKS', desc: 'API gateway, services, DB on EKS', service: 'template' },
    { id: 'static-site', name: 'Static Site on S3+CloudFront', desc: 'S3 bucket + CloudFront + ACM', service: 'template' }
  ];
  res.json({ templates });
});

module.exports = router;
