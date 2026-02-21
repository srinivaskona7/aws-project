# 3-Tier VPC Architecture Template
# Usage: terraform init && terraform apply -var="project_name=myapp"

variable "project_name" { default = "devops-app" }
variable "region"       { default = "us-east-1" }
variable "vpc_cidr"     { default = "10.0.0.0/16" }

provider "aws" { region = var.region }

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${var.project_name}-vpc", ManagedBy = "devops-portal" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}

# Public subnets (web tier)
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = true
  tags = { Name = "${var.project_name}-public-a", Tier = "web" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.region}b"
  map_public_ip_on_launch = true
  tags = { Name = "${var.project_name}-public-b", Tier = "web" }
}

# Private subnets (app tier)
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "${var.region}a"
  tags = { Name = "${var.project_name}-private-a", Tier = "app" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.12.0/24"
  availability_zone = "${var.region}b"
  tags = { Name = "${var.project_name}-private-b", Tier = "app" }
}

# DB subnets (data tier)
resource "aws_subnet" "db_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.21.0/24"
  availability_zone = "${var.region}a"
  tags = { Name = "${var.project_name}-db-a", Tier = "data" }
}

resource "aws_subnet" "db_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.22.0/24"
  availability_zone = "${var.region}b"
  tags = { Name = "${var.project_name}-db-b", Tier = "data" }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_a.id
  tags          = { Name = "${var.project_name}-nat" }
  depends_on    = [aws_internet_gateway.igw]
}

resource "aws_eip" "nat" { domain = "vpc" }

output "vpc_id"              { value = aws_vpc.main.id }
output "public_subnet_ids"   { value = [aws_subnet.public_a.id, aws_subnet.public_b.id] }
output "private_subnet_ids"  { value = [aws_subnet.private_a.id, aws_subnet.private_b.id] }
output "db_subnet_ids"       { value = [aws_subnet.db_a.id, aws_subnet.db_b.id] }
