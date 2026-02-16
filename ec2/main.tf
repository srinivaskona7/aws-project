# ──────────────────────────────────────────────
# EC2 Instance
# ──────────────────────────────────────────────

resource "aws_instance" "app_server" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]

  root_block_device {
    volume_size           = 8
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name      = var.instance_name
    Project   = var.project_name
    ManagedBy = "Terraform"
  }
}
