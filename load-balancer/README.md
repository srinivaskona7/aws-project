# Secure AWS Load Balancer with Autoscaling & Custom Domain

This project automates the deployment of a highly available, secure, and scalable web application infrastructure on AWS using Terraform. It includes a custom domain, SSL termination, and autoscaling capabilities.

## 📑 Table of Contents

1.  [High-Level Architecture](#-high-level-architecture)
2.  [Architectural Provisioning Flow](#-architectural-provisioning-flow-execution-order)
3.  [Detailed Request Flow](#-detailed-request-flow)
4.  [Resource Definitions](#-resource-definitions)
5.  [AWS Credentials & Configuration](#-aws-credentials--configuration)
6.  [Deployment Instructions](#-deployment-instructions)
7.  [Verification](#-verification)
8.  [Project Structure](#-project-structure)
9.  [Technical Deep Dive](#-technical-deep-dive-how-alb-asg-and-target-groups-work-together)
10. [Detailed Cost Analysis](#-detailed-cost-analysis-estimated)

### 📘 Additional Guides

| Guide                                      | Description                                                   |
| :----------------------------------------- | :------------------------------------------------------------ |
| [aws-console.md](aws-console.md)           | Step-by-step manual setup via AWS Management Console          |
| [aws-cli-commands.md](aws-cli-commands.md) | Full AWS CLI commands to build the infrastructure             |
| [workflow.md](workflow.md)                 | Detailed traffic flow diagrams with step-by-step explanations |

## 🌟 High-Level Architecture

This diagram illustrates the overall architecture, from user request to backend processing.

![AWS Architecture Diagram](images/aws_architecture_diagram.png)

---

## 🏗️ Architectural Provisioning Flow (Execution Order)

When the script runs, it builds the cloud data center in this specific "Architect's Order", ensuring every layer is ready before the next relies on it:

| Step   | Layer           | Service Created             | Why/Purpose                                                   |
| :----- | :-------------- | :-------------------------- | :------------------------------------------------------------ |
| **1**  | **Foundation**  | `AWS VPC`                   | The private cloud network boundary.                           |
| **2**  | **Access**      | `Internet Gateway`          | The physical door to the internet.                            |
| **3**  | **Network**     | `Subnets` (Public/Private)  | Logical rooms to separate secure vs. public resources.        |
| **4**  | **Routing**     | `Route Tables`              | The maps telling traffic where to go (Internet vs Local).     |
| **5**  | **Security**    | `Security Groups`           | Firewalls wrapping every resource (ALB, App, Bastion).        |
| **6**  | **Identity**    | `ACM Certificate`           | The digital ID card (SSL) for HTTPS trust.                    |
| **7**  | **Traffic**     | `Target Groups`             | The waiting room list for application instances.              |
| **8**  | **Entry Point** | `Application Load Balancer` | The receptionist that handles public web traffic.             |
| **9**  | **Compute**     | `Launch Template`           | The blueprint for creating identical servers.                 |
| **10** | **Scaling**     | `Auto Scaling Group`        | The manager that hires/fires servers (EC2) based on demand.   |
| **11** | **Egress**      | `NAT Gateway`               | The proxy allowing private servers to fetch updates securely. |
| **12** | **DNS**         | `Route 53 Zone`             | The public address book connecting your domain to the ALB.    |

---

## 📖 Detailed Request Flow

This section breaks down the request lifecycle into logical steps.

### Step 1: Ingress (Entry)

**Visual Flow:** `User` -> `Route 53` -> `IGW` -> `ALB`

![Ingress Flow](images/aws_flow_step_1_ingress.png)

1.  **User Request**: A user visits `https://garden.srinivaskona.life`.
2.  **DNS Resolution (Route 53)**: AWS Route 53 resolves the domain name to the IP addresses of the Application Load Balancer (ALB).
3.  **VPC Entry (IGW)**: The request enters the VPC through the Internet Gateway (IGW).
4.  **SSL Termination (ALB)**: The Application Load Balancer (in Public Subnets) receives the encrypted traffic on Port 443. It uses the ACM Certificate (`tls.crt`) to decrypt the request and inspect the traffic.

### Step 2: Distribution & Scaling

**Visual Flow:** `ALB` -> `Target Group` -> `ASG` -> `EC2`

![Scaling Flow](images/aws_flow_step_2_scaling.png)

5.  **Traffic Routing (Target Group)**: The ALB forwards the decrypted request to a logical Target Group.
6.  **Load Balancing**: The Target Group selects a healthy EC2 instance from the Auto Scaling Group (ASG).
7.  **Processing (EC2)**: The request is processed by an EC2 instance residing in a **Private Subnet** (security best practice). The instance returns the web page content.
8.  **Auto Scaling**: If traffic increases (Cpu > 50% or Requests > 100), the ASG automatically launches new instances. If traffic decreases, it removes them to save costs.

### Step 3: Secure Egress (Outbound)

**Visual Flow:** `EC2` -> `NAT Gateway` -> `IGW` -> `Internet`

![Egress Flow](images/aws_flow_step_3_egress.png)

9.  **Outbound Requests**: If a Private EC2 instance needs to access the internet (e.g., for software updates), it cannot go directly.
10. **NAT Gateway**: The traffic is routed to a NAT Gateway in the Public Subnet.
11. **Internet Access**: The NAT Gateway forwards the traffic through the Internet Gateway (IGW) to the external internet, ensuring basic security by hiding the private IP.

---

## 🏗️ Resource Definitions

| Resource                            | Type     | Description                                                               |
| :---------------------------------- | :------- | :------------------------------------------------------------------------ |
| **VPC**                             | Network  | The isolated network environment for all resources.                       |
| **Internet Gateway (IGW)**          | Network  | Doorway for traffic to enter/exit the VPC from the internet.              |
| **Public Subnet**                   | Network  | Subnet with direct internet access. Hosts ALB and NAT Gateway.            |
| **Private Subnet**                  | Network  | Subnet with NO direct internet access. Hosts Application Instances.       |
| **NAT Gateway**                     | Network  | Allows private instances to access the internet securely (outbound only). |
| **Application Load Balancer (ALB)** | Compute  | Distributes incoming app traffic across multiple targets.                 |
| **Target Group (TG)**               | Compute  | Logical group of targets (EC2 instances) for routing requests.            |
| **Auto Scaling Group (ASG)**        | Compute  | Manages the fleet of EC2 instances, scaling up/down automatically.        |
| **Launch Template**                 | Config   | Blueprint for creating new EC2 instances (AMI, Instance Type, Key Pair).  |
| **Route 53**                        | DNS      | Scalable Domain Name System web service.                                  |
| **ACM**                             | Security | Handles SSL/TLS certificates for secure HTTPS connections.                |

---

## 🔐 AWS Credentials & Configuration

Before running Terraform, you must provide AWS credentials. Terraform automatically looks for them in the following order:

### Option 1: Environment Variables (Recommended for CI/CD or Temporary Sessions)

You can export your credentials directly in your terminal. This does not save them to disk.

**Mac/Linux:**

```bash
export AWS_ACCESS_KEY_ID="AKIAxxxxxxxxxxxxxxxx"
export AWS_SECRET_ACCESS_KEY="wJalrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export AWS_DEFAULT_REGION="ap-south-1"
```

**Windows (PowerShell):**

```powershell
$Env:AWS_ACCESS_KEY_ID="AKIAxxxxxxxxxxxxxxxx"
$Env:AWS_SECRET_ACCESS_KEY="wJalrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
$Env:AWS_DEFAULT_REGION="ap-south-1"
```

### Option 2: Shared Credentials File (Recommended for Local Dev)

If you have the AWS CLI installed, you can configure a profile that Terraform will use.

1.  Run `aws configure` and enter your keys.
2.  Or manually edit `~/.aws/credentials` (Mac/Linux) or `%USERPROFILE%\.aws\credentials` (Windows):

```ini
[default]
aws_access_key_id = AKIAxxxxxxxxxxxxxxxx
aws_secret_access_key = wJalrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Terraform will automatically pick up the `[default]` profile. If you want to use a specific profile:

```bash
export AWS_PROFILE=my-profile
```

---

## 🚀 Deployment Instructions

### Prerequisites

- AWS CLI installed and configured.
- Terraform installed.
- Valid Domain Name and SSL Certificate (`tls.crt`, `tls.key`).

### Quick Start (Automation Script)

We have provided a comprehensive script `deploy_garden.sh` that handles the entire process:

```bash
./deploy_garden.sh
```

**What the script does:**

1. **Checks Credentials**: Verifies AWS access.
2. **Imports Certificates**: Uploads your local SSL certs to AWS ACM.
3. **Configures Terraform**: Updates variable files with the new Certificate ARN.
4. **Deploys Infrastructure**: Runs `terraform apply` to create all resources.
5. **Outputs Nameservers**: Provides the Route 53 nameservers for your domain registrar.

### Manual Deployment Steps

If you prefer running Terraform manually:

1. **Initialize Terraform:**

   ```bash
   terraform init
   ```

2. **Import Certificate (Optional if already imported):**

   ```bash
   aws acm import-certificate --certificate fileb://cert.crt --private-key fileb://key.key
   ```

3. **Apply Configuration:**

   ```bash
   terraform apply
   ```

4. **Update DNS:**
   - Copy the `nameservers` output from Terraform.
   - Update your domain registrar (e.g., GoDaddy) with these checks.

### Retrieving Outputs (Post-Deployment)

If you need to see the connection details (DNS, IPs, Nameservers) later, simply run:

```bash
terraform output
```

Or for a specific value:

```bash
terraform output alb_dns_name
```

---

## 🔍 Verification

Once deployed, you can verify the status:

- **Web Access**: Visit `https://garden.srinivaskona.life`
  - Should load the application securely.
  - Browser should show a valid lock icon.

- **Load Balancing**: Refresh the page multiple times. You may see the "Server IP" or hostname change in the application response, indicating traffic distribution.

### DNS Verification (Troubleshooting)

If the site is not loading, check if the DNS has propagated.

**Option 1: Check AWS Nameservers Directly (Bypass Propagation Delay)**
This confirms AWS is ready, even if GoDaddy hasn't updated yet.

```bash
# Replace 'ns-xxxx...' with one of your nameservers from 'terraform output'
dig @ns-1335.awsdns-38.org garden.srinivaskona.life
```

- **Success**: Returns IP addresses in `ANSWER SECTION`.
- **Failure**: `NXDOMAIN` or `REFUSED`.

**Option 2: Global Check (Standard)**

```bash
dig garden.srinivaskona.life
```

- **Note**: This may take 10-15 minutes after updating GoDaddy.

---

## 📂 Project Structure

```
load-balancer/
│
├── 📄 README.md                  # High-level overview (this file)
├── 📄 aws-console.md             # Manual AWS Console setup guide
├── 📄 aws-cli-commands.md        # AWS CLI commands reference
├── 📄 workflow.md                # Traffic flow diagrams & explanations
├── 📄 MANUAL.md                  # Additional manual notes
├── 📄 elb.md                     # ELB deep-dive notes
│
├── 🔧 Terraform Modules
│   ├── provider.tf               # AWS Provider configuration
│   ├── variables.tf              # Input variables (Region, CIDRs, etc.)
│   ├── terraform.tfvars          # Variable values
│   ├── vpc.tf                    # VPC, IGW, NAT Gateway
│   ├── subnets.tf                # Subnets & Route Tables
│   ├── security.tf               # Security Groups (ALB, App, Bastion)
│   ├── acm.tf                    # SSL Certificate (ACM Import)
│   ├── alb.tf                    # Load Balancer & Listeners
│   ├── instances.tf              # Bastion Host, Launch Template, ASG
│   ├── route53.tf                # DNS Zone & Records
│   └── outputs.tf                # Terraform Outputs
│
├── 🛠️ Scripts
│   ├── deploy_garden.sh          # One-click deployment automation
│   ├── process_certs.sh          # Certificate processing utility
│   └── user_data.sh              # EC2 boot script (Apache setup)
│
├── 🔒 Certificates
│   ├── certs/                    # Processed PEM files (body, chain, key)
│   └── raw-certs/                # Original certificate files
│
└── 🖼️ Images
    ├── images/
    │   ├── aws_architecture_diagram.png
    │   ├── aws_flow_step_1_ingress.png
    │   ├── aws_flow_step_2_scaling.png
    │   ├── aws_flow_step_3_egress.png
    │   ├── architect_flow_ingress_tls.png
    │   ├── architect_flow_egress_nat.png
    │   ├── architect_flow_access_bastion.png
    │   ├── architecture.png
    │   ├── architecture-detailed.png
    │   ├── manual_step_1_vpc_map.png
    │   ├── manual_step_3_asg_config.png
    │   └── manual_step_4_alb_dns.png
```

---

## 🧠 Technical Deep Dive: How ALB, ASG, and Target Groups Work Together

It can be confusing to understand how these three components talk to each other. Here is the internal process:

### The "Glue": Target Group (TG)

Think of the **Target Group** as a dynamic "Contact List" for the Load Balancer. The ALB doesn't know about specific EC2 instances; it only knows to send traffic to the Target Group.

### The Workflow

1.  **Scale Out Event**:
    - The **Auto Scaling Group (ASG)** detects high CPU usage (>50%).
    - It launches a new EC2 Instance.
2.  **Automatic Registration**:
    - Because we attached the ASG to the Target Group (in `autoscaling.tf`), the ASG automatically **registers** the new instance's ID and IP with the Target Group.
    - Status changes to: `initial`.
3.  **Health Checks**:
    - The ALB sees a new member in the Target Group.
    - It immediately starts pinging the instance (e.g., `GET /` on Port 80).
    - If the instance responds with `200 OK`, the status changes to `healthy`.
4.  **Traffic Routing**:

---

## 💰 Detailed Cost Analysis (Estimated)

Below is the breakdown comparing a **New AWS Account (Free Tier Eligible)** vs. a **Standard Account**.

> **Note**: These prices are estimates for the `ap-south-1` (Mumbai) region.

| Component         | Architecture Role                 | Hourly Cost (Std) | Monthly (Std) | **Trial Account (Free Tier)** | **Standard Account**   |
| :---------------- | :-------------------------------- | :---------------- | :------------ | :---------------------------- | :--------------------- |
| **NAT Gateway**   | Secure Egress for Private Subnets | **$0.045**        | **$32.40**    | 🔴 **Billable** ($32.40)      | 🔴 **$32.40**          |
| **ALB**           | Traffic Distribution & SSL        | $0.0225           | $16.20        | 🟢 **Free** (750 Hrs)         | 🔴 **$16.20**          |
| **EC2 Instances** | Compute (2x t2.micro)             | $0.0116           | $8.35         | 🟢 **Free** (750 Hrs)         | 🔴 **$16.70** (for 2)  |
| **EBS Storage**   | Disk Space (2x 8GB)               | $0.00             | $1.60         | 🟢 **Free** (30 GB)           | 🔴 **$1.60**           |
| **Elastic IP**    | Static IP for NAT                 | $0.005            | $3.60         | 🟢 **Free** (Attached)        | 🟢 **Free** (Attached) |
| **Route 53**      | DNS Hosted Zone                   | N/A               | $0.50         | 🔴 **Billable** ($0.50)       | 🔴 **$0.50**           |
| **Data Transfer** | Outbound Traffic                  | varies            | varies        | 🟢 **Free** (100 GB)          | 🔴 **Varies**          |
| **TOTAL**         | **Estimated Monthly Run Rate**    |                   |               | **~$32.90 / mo**              | **~$67.40 / mo**       |

### 🚨 Critical Billing Warning

Even on a **Free Tier** account, you **WILL BE CHARGED ~$32.90/month** primarily due to the **NAT Gateway**. This component is NOT part of the Free Tier.

- **Recommendation**: If this is for learning, run `terraform destroy` immediately after testing to avoid costs.
