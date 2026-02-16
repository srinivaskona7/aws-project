# ──────────────────────────────────────────────
# Input Variables
# ──────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "ap-south-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t2.micro"
}

variable "ami_name_filter" {
  description = "Name filter pattern for Amazon Linux AMI lookup"
  type        = string
  default     = "al2023-ami-2023.*-x86_64"
}

variable "key_name" {
  description = "Name of the existing AWS Key Pair for SSH access"
  type        = string
  default     = "aws"
}

variable "instance_name" {
  description = "Name tag for the EC2 instance"
  type        = string
  default     = "sri-ec2-instance"
}

variable "project_name" {
  description = "Project identifier used for resource tagging"
  type        = string
  default     = "sri-ec2"
}

# ── AWS Credentials (loaded from terraform.tfvars) ──

variable "aws_access_key" {
  description = "AWS access key ID"
  type        = string
  sensitive   = true
}

variable "aws_secret_key" {
  description = "AWS secret access key"
  type        = string
  sensitive   = true
}
