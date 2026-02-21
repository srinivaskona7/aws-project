#!/bin/bash
#
# Example Usage Scripts
#

echo "=== EC2 Root Password Setup - Example Usage ==="
echo ""

# Example 1: Basic usage
echo "Example 1: Basic usage with defaults"
echo "  ./create-password.sh MySecurePass123"
echo "  (Will prompt for EC2 IP, uses ec2-user and ./key.pem)"
echo ""

# Example 2: Ubuntu instance
echo "Example 2: Ubuntu EC2 instance"
echo "  ./create-password.sh MySecurePass123 ubuntu ./my-ubuntu-key.pem"
echo ""

# Example 3: Amazon Linux
echo "Example 3: Amazon Linux 2 instance"
echo "  ./create-password.sh MySecurePass123 ec2-user ./my-amz-key.pem"
echo ""

# Example 4: With environment variable
echo "Example 4: Using environment variable for host"
echo "  EC2_HOST=54.123.45.67 ./create-password.sh MySecurePass123"
echo ""

# Example 5: RHEL instance
echo "Example 5: RHEL instance"
echo "  ./create-password.sh MySecurePass123 ec2-user ./rhel-key.pem"
echo ""

# Example 6: Multiple instances
echo "Example 6: Configure multiple instances"
cat << 'SCRIPT'
#!/bin/bash
instances=(
  "54.123.45.67:ubuntu:ubuntu-key.pem"
  "54.123.45.68:ec2-user:amzn-key.pem"
  "54.123.45.69:centos:centos-key.pem"
)

for instance in "${instances[@]}"; do
  IFS=':' read -r host user key <<< "$instance"
  echo "Configuring $host..."
  EC2_HOST=$host ./create-password.sh "CommonPassword123" "$user" "$key"
done
SCRIPT
echo ""

# AWS CLI Examples
echo "=== AWS CLI Examples ==="
echo ""

# Launch with user data
echo "Launch EC2 with user data:"
cat << 'AWSCLI'
aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type t2.micro \
  --key-name my-key \
  --security-group-ids sg-xxxxxxxxx \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=root-pwd-test}]'
AWSCLI
echo ""

# Get instance IP
echo "Get instance public IP:"
echo "  aws ec2 describe-instances --instance-ids i-xxxxxxxxx --query 'Reservations[0].Instances[0].PublicIpAddress' --output text"
echo ""

# Terraform Example
echo "=== Terraform Example ==="
cat << 'TERRAFORM'
# main.tf
resource "aws_instance" "web" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t2.micro"
  key_name      = "my-key"

  vpc_security_group_ids = [aws_security_group.allow_ssh.id]

  user_data = file("${path.module}/user-data.sh")

  tags = {
    Name = "root-password-enabled"
  }
}

resource "aws_security_group" "allow_ssh" {
  name        = "allow_ssh"
  description = "Allow SSH inbound traffic"

  ingress {
    description = "SSH from anywhere"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # Restrict this in production!
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

output "instance_ip" {
  value = aws_instance.web.public_ip
}
TERRAFORM
echo ""

echo "=== After Setup ==="
echo ""
echo "Test root login:"
echo "  ssh root@<ec2-ip>"
echo ""
echo "Check logs:"
echo "  ssh -i key.pem ec2-user@<ec2-ip> 'sudo cat /var/log/root-password-setup.log'"
echo ""
echo "Disable password auth when done:"
cat << 'DISABLE'
sudo sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo systemctl restart sshd
DISABLE
