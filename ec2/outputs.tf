# ──────────────────────────────────────────────
# Outputs
# ──────────────────────────────────────────────

output "instance_details_table" {
  description = "Formatted table of EC2 instance details"
  value = <<EOT

┌──────────────────────────────────────────────────────────────┐
│                   EC2 INSTANCE DETAILS                      │
├──────────────────────┬───────────────────────────────────────┤
│ Instance ID          │ ${aws_instance.app_server.id}         │
│ Public IP            │ ${aws_instance.app_server.public_ip}  │
│ Public DNS           │ ${aws_instance.app_server.public_dns} │
│ Key Pair Name        │ ${aws_instance.app_server.key_name}   │
│ Security Group ID    │ ${aws_security_group.ec2_sg.id}       │
│ AMI ID               │ ${aws_instance.app_server.ami}        │
│ Instance Type        │ ${aws_instance.app_server.instance_type} │
│ Availability Zone    │ ${aws_instance.app_server.availability_zone} │
└──────────────────────┴───────────────────────────────────────┘
EOT
}

# Keeping raw outputs for programmatic access if needed
output "instance_id" { value = aws_instance.app_server.id }
output "public_ip" { value = aws_instance.app_server.public_ip }
output "key_name" { value = aws_instance.app_server.key_name }
