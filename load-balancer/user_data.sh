#!/bin/bash
yum update -y
yum install -y httpd
systemctl start httpd
systemctl enable httpd

# Fetch Internal IP using IMDSv2
TOKEN=`curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"`
LOCAL_IP=`curl -H "X-aws-ec2-metadata-token: $TOKEN" -v http://169.254.169.254/latest/meta-data/local-ipv4`

# Create Index Page
echo "<h1>Hello from Terraform EC2 (Apache)</h1><p>Running from internal IP address: $LOCAL_IP</p>" > /var/www/html/index.html
