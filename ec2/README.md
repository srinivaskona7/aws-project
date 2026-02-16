# EC2 Instance — Terraform Module

Provisions a single EC2 instance on **Amazon Linux 2023** in `ap-south-1` with an existing `aws` key pair and a security group exposing ports **22, 80, 443, 8089, 8090**.

## Architecture

```
┌─────────────────────────────────────────┐
│  AWS Region: ap-south-1                 │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Security Group (sri-ec2-sg)      │  │
│  │  Ingress: 22, 80, 443, 8089, 8090│  │
│  │  Egress : All                     │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  EC2 Instance               │  │  │
│  │  │  AMI : Amazon Linux 2023    │  │  │
│  │  │  Type: t2.micro             │  │  │
│  │  │  Key : aws                  │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Prerequisites

| Requirement | Details                                          |
| ----------- | ------------------------------------------------ |
| Terraform   | >= 1.5.0                                         |
| AWS CLI     | Configured with valid credentials                |
| Key Pair    | An existing key pair named `aws` in `ap-south-1` |

## Quick Start

```bash
# Initialise providers
terraform init

# Preview changes
terraform plan

# Deploy
terraform apply

# Connect via SSH
ssh -i ~/.ssh/aws.pem ec2-user@$(terraform output -raw public_ip)
```

## Inputs

| Variable          | Default                    | Description        |
| ----------------- | -------------------------- | ------------------ |
| `aws_region`      | `ap-south-1`               | AWS region         |
| `instance_type`   | `t2.micro`                 | Instance size      |
| `ami_name_filter` | `al2023-ami-2023.*-x86_64` | AMI lookup pattern |
| `key_name`        | `aws`                      | Existing key pair  |
| `instance_name`   | `sri-ec2-instance`         | Instance Name tag  |
| `project_name`    | `sri-ec2`                  | Project tag        |

## Outputs

| Output              | Description         |
| ------------------- | ------------------- |
| `instance_id`       | EC2 instance ID     |
| `public_ip`         | Public IP address   |
| `public_dns`        | Public DNS hostname |
| `security_group_id` | Security group ID   |
| `ami_id`            | Resolved AMI ID     |

## Cleanup

```bash
terraform destroy
```
