# Data source for latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

# 1. Bastion Host (in Public Subnet)
resource "aws_instance" "bastion" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public[0].id
  associate_public_ip_address = true
  key_name                    = var.key_name
  vpc_security_group_ids      = [aws_security_group.bastion.id]

  tags = {
    Name = "${var.project_name}-bastion"
  }
}

# 2. Application Instances (in Private Subnets)
resource "aws_instance" "app" {
  count                  = length(var.private_subnet_cidrs)
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.private[count.index].id
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.app.id]

  # User Data from script
  user_data = file("${path.module}/user_data.sh")
  user_data_replace_on_change = true

  tags = {
    Name = "${var.project_name}-app-${count.index + 1}"
  }
}
