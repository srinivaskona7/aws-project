# 🖥️ AWS Console Manual Setup Guide

This guide walks you through creating the entire infrastructure manually via the **AWS Management Console**, step by step.

> **Region**: `ap-south-1` (Mumbai) — Ensure this is selected in the top-right corner before proceeding.

---

## Step 1: Create a VPC

1. Navigate to **VPC** → **Your VPCs** → **Create VPC**
2. Configure:
   - **Name tag**: `sri-vpc`
   - **IPv4 CIDR block**: `10.0.0.0/16`
   - **Tenancy**: Default
3. Click **Create VPC**

---

## Step 2: Create an Internet Gateway

1. Navigate to **VPC** → **Internet Gateways** → **Create internet gateway**
2. **Name tag**: `sri-igw`
3. Click **Create internet gateway**
4. Select the newly created IGW → **Actions** → **Attach to VPC**
5. Select `sri-vpc` → Click **Attach**

---

## Step 3: Create Subnets

### Public Subnet 1

1. Navigate to **VPC** → **Subnets** → **Create subnet**
2. **VPC**: Select `sri-vpc`
3. Configure:
   - **Name**: `sri-public-subnet-1`
   - **Availability Zone**: `ap-south-1a`
   - **IPv4 CIDR block**: `10.0.1.0/24`
4. Click **Create subnet**

### Public Subnet 2

- Repeat with: Name `sri-public-subnet-2`, AZ `ap-south-1b`, CIDR `10.0.2.0/24`

### Private Subnet 1

- Repeat with: Name `sri-private-subnet-1`, AZ `ap-south-1a`, CIDR `10.0.3.0/24`

### Private Subnet 2

- Repeat with: Name `sri-private-subnet-2`, AZ `ap-south-1b`, CIDR `10.0.4.0/24`

### Enable Auto-Assign Public IP (Public Subnets Only)

1. Select `sri-public-subnet-1` → **Actions** → **Edit subnet settings**
2. Check ✅ **Enable auto-assign public IPv4 address**
3. Repeat for `sri-public-subnet-2`

---

## Step 4: Create Route Tables

### Public Route Table

1. Navigate to **VPC** → **Route Tables** → **Create route table**
2. **Name**: `sri-public-rt`, **VPC**: `sri-vpc`
3. Click **Create**
4. Select the route table → **Routes** tab → **Edit routes** → **Add route**:
   - **Destination**: `0.0.0.0/0`
   - **Target**: Select `sri-igw` (Internet Gateway)
5. **Subnet Associations** tab → **Edit** → Associate both public subnets

### Private Route Table

1. Create another route table: Name `sri-private-rt`, VPC `sri-vpc`
2. Add route: `0.0.0.0/0` → Target: NAT Gateway (create in Step 5 first)
3. Associate both private subnets

---

## Step 5: Create NAT Gateway

1. Navigate to **VPC** → **NAT Gateways** → **Create NAT gateway**
2. Configure:
   - **Name**: `sri-nat-gw`
   - **Subnet**: Select `sri-public-subnet-1`
   - **Elastic IP allocation ID**: Click **Allocate Elastic IP** → Select it
3. Click **Create NAT gateway**
4. Go back to `sri-private-rt` route table and add: `0.0.0.0/0` → `sri-nat-gw`

---

## Step 6: Create Security Groups

### ALB Security Group

1. Navigate to **EC2** → **Security Groups** → **Create security group**
2. **Name**: `sri-alb-sg`, **VPC**: `sri-vpc`
3. **Inbound Rules**:
   - Type: `HTTP` (80), Source: `0.0.0.0/0`
   - Type: `HTTPS` (443), Source: `0.0.0.0/0`
4. **Outbound**: All traffic → `0.0.0.0/0`

### Bastion Security Group

- **Name**: `sri-bastion-sg`
- **Inbound**: Type `SSH` (22), Source: `My IP`
- **Outbound**: All traffic

### App Security Group

- **Name**: `sri-app-sg`
- **Inbound**:
  - Type `HTTP` (80), Source: `sri-alb-sg` (Security Group ID)
  - Type `SSH` (22), Source: `sri-bastion-sg` (Security Group ID)
- **Outbound**: All traffic

---

## Step 7: Import SSL Certificate (ACM)

1. Navigate to **Certificate Manager (ACM)** → **Import a certificate**
2. Paste:
   - **Certificate body**: Contents of `body.pem`
   - **Certificate private key**: Contents of `tls.key`
   - **Certificate chain**: Contents of `chain.pem`
3. Click **Import**
4. Note the **Certificate ARN** for later use

---

## Step 8: Create a Target Group

1. Navigate to **EC2** → **Target Groups** → **Create target group**
2. Configure:
   - **Target type**: Instances
   - **Name**: `sri-tg`
   - **Protocol**: HTTP, **Port**: 80
   - **VPC**: `sri-vpc`
   - **Health check path**: `/`
   - **Healthy threshold**: 2
   - **Unhealthy threshold**: 2
3. Click **Create** (do NOT register targets yet — ASG will handle this)

---

## Step 9: Create Application Load Balancer

1. Navigate to **EC2** → **Load Balancers** → **Create Load Balancer**
2. Select **Application Load Balancer**
3. Configure:
   - **Name**: `sri-alb`
   - **Scheme**: Internet-facing
   - **IP address type**: IPv4
   - **Network mapping**: Select `sri-vpc`, both public subnets
   - **Security group**: `sri-alb-sg`
4. **Listeners**:
   - **HTTP:80** → Redirect to HTTPS:443
   - **HTTPS:443** → Forward to `sri-tg`, Certificate: select your ACM cert
5. Click **Create load balancer**

---

## Step 10: Create Launch Template

1. Navigate to **EC2** → **Launch Templates** → **Create launch template**
2. Configure:
   - **Name**: `sri-lt`
   - **AMI**: Amazon Linux 2023 (latest)
   - **Instance type**: `t2.micro`
   - **Key pair**: `aws`
   - **Security group**: `sri-app-sg`
   - **Advanced details** → **User data**: Paste contents of `user_data.sh`
3. Click **Create launch template**

---

## Step 11: Create Auto Scaling Group

1. Navigate to **EC2** → **Auto Scaling Groups** → **Create**
2. Configure:
   - **Name**: `sri-asg`
   - **Launch template**: `sri-lt`
   - **VPC**: `sri-vpc`, **Subnets**: Select both private subnets
   - **Load balancing**: Attach to `sri-tg`
   - **Health check type**: ELB
   - **Desired**: 2, **Min**: 2, **Max**: 3
3. **Scaling policies**:
   - Target tracking: Average CPU Utilization → Target 50%
4. Click **Create**

---

## Step 12: Create Bastion Host

1. Navigate to **EC2** → **Instances** → **Launch instances**
2. Configure:
   - **Name**: `sri-bastion`
   - **AMI**: Amazon Linux 2023
   - **Instance type**: `t2.micro`
   - **Key pair**: `aws`
   - **Network**: `sri-vpc`, Subnet: `sri-public-subnet-1`
   - **Auto-assign public IP**: Enable
   - **Security group**: `sri-bastion-sg`
3. Click **Launch instance**

---

## Step 13: Configure Route 53

1. Navigate to **Route 53** → **Hosted Zones** → **Create hosted zone**
2. **Domain name**: `srinivaskona.life` (or your domain)
3. Click **Create hosted zone**
4. Note the 4 **NS records** → Update them in your domain registrar (GoDaddy)
5. **Create Record**:
   - **Name**: `garden` (or leave blank for root)
   - **Type**: A — Alias
   - **Route traffic to**: Application Load Balancer → Select `sri-alb`
6. Create another record for `www` subdomain (same alias)

---

## ✅ Verification

1. Wait 10-15 minutes for DNS propagation
2. Open browser → Visit `https://garden.srinivaskona.life`
3. Check for valid SSL lock icon
4. Refresh multiple times to see load balancing across instances
