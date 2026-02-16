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
  description = "Name filter pattern for Amazon Linux AMI"
  type        = string
  default     = "al2023-ami-2023.*-x86_64"
}

variable "key_name" {
  description = "Name of the AWS Key Pair to use for SSH access"
  type        = string
  default     = "aws"
}
