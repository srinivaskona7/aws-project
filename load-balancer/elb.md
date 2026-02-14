# Secure Load Balanced Web App on AWS

This project deploys a secure, highly available 2-tier web architecture using Terraform. It provisions a custom VPC, Public/Private subnets, an Application Load Balancer (ALB), and private EC2 instances running Apache Web Server.

## 🏗 Architecture

The architecture follows AWS best practices for security and high availability:

- **VPC**: A custom Virtual Private Cloud (`10.0.0.0/16`) to isolate resources.
- **Public Subnets**: Host the **Application Load Balancer (ALB)**, **NAT Gateway**, and **Bastion Host**.
  - _Role_: Internet-facing entry points.
- **Private Subnets**: Host the **Application Instances** (Web Servers).
  - _Role_: Secure processing layer. No direct internet access (ingress). Outbound access via NAT Gateway.
- **Security Groups**: Chained rules to enforce traffic flow:
  - `ALB SG`: Allows HTTP (80) from Anywhere (`0.0.0.0/0`).
  - `Bastion SG`: Allows SSH (22) from User IPs.
  - `App SG`: Allows HTTP _only_ from `ALB SG` and SSH _only_ from `Bastion SG`.

### Traffic Flow Diagram

![Architecture Diagram](images/architecture-detailed.png)

### Request Flow Explained

1.  **Web Traffic (HTTP)**:
    - **User** sends a request to the **Application Load Balancer (ALB)** via the Internet Gateway.
    - **ALB** (in Public Subnet) forwards the traffic to a healthy **App Instance** (in Private Subnet) on Port 80.
    - _Security_: The App Instance accepts traffic **only** from the ALB's Security Group.

2.  **Administrative Access (SSH)**:
    - **Admin** connects to the **Bastion Host** (in Public Subnet) on Port 22.
    - From the Bastion, the Admin initiates an SSH connection to the **App Instance** (Private IP).
    - _Security_: The App Instance accepts SSH **only** from the Bastion's Security Group.

3.  **Outbound Traffic (Updates)**:
    - **App Instances** initiate requests (e.g., `yum update`) to the **NAT Gateway** (in Public Subnet).
    - **NAT Gateway** forwards the traffic to the internet via the Internet Gateway.
    - _Note_: This allows patches/installation without exposing the instances to inbound internet traffic.

## 🚀 Deployment Instructions

### Prerequisites

- Terraform installed.
- AWS Credentials configured (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- An existing AWS Key Pair (default name: `aws`).

### 1. Initialize

Download the required AWS provider plugins.

```bash
cd load-balancer
terraform init
```

### 2. Plan

Preview the resources that will be created (VPC, Subnets, EC2, ALB, etc.).

```bash
terraform plan
```

### 3. Apply

Provision the infrastructure. This will take ~3-5 minutes (mainly for the NAT Gateway).

```bash
terraform apply -auto-approve
```

## ✅ Verification

Once the deployment is complete, Terraform will output the **ALB DNS Name**.

1.  **Access the Web App**:
    Open the ALB URL in your browser or use `curl`:

    ```bash
    curl http://sri-alb-example-12345.ap-south-1.elb.amazonaws.com
    ```

    **Expected Output**:

    ```html
    <h1>Hello from Terraform EC2 (Apache)</h1>
    <p>Running from internal IP address: 10.0.3.50</p>
    ```

    _(The IP address `10.0.3.50` validates that the request was served by a private instance)._

2.  **Verify High Availability**:
    Refresh the page multiple times. The internal IP should toggle between the instances in different Availability Zones (e.g., `10.0.3.x` and `10.0.4.x`).

3.  **Verify Security**:
    Try to access the private IPs directly (e.g., `http://10.0.3.50`). This should **fail**, confirming the private subnet isolation.

## 🧹 Cleanup

To destroy all resources and stop billing:

```bash
terraform destroy -auto-approve
```
