# ⌨️ AWS CLI Commands Guide

This guide provides the exact AWS CLI commands to build the entire infrastructure step by step, matching the Terraform configuration.

> **Prerequisites**: AWS CLI v2 installed, credentials configured (`aws configure`), Region: `ap-south-1`

---

## Step 1: Create VPC

```bash
# Create the VPC
VPC_ID=$(aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=sri-vpc}]' \
  --query 'Vpc.VpcId' --output text)

# Enable DNS hostnames
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames

echo "VPC Created: $VPC_ID"
```

---

## Step 2: Create Internet Gateway

```bash
# Create IGW
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=sri-igw}]' \
  --query 'InternetGateway.InternetGatewayId' --output text)

# Attach to VPC
aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID

echo "IGW Created: $IGW_ID"
```

---

## Step 3: Create Subnets

```bash
# Public Subnet 1
PUB_SUB1=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 \
  --availability-zone ap-south-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=sri-public-subnet-1}]' \
  --query 'Subnet.SubnetId' --output text)

# Public Subnet 2
PUB_SUB2=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 \
  --availability-zone ap-south-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=sri-public-subnet-2}]' \
  --query 'Subnet.SubnetId' --output text)

# Private Subnet 1
PRI_SUB1=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID --cidr-block 10.0.3.0/24 \
  --availability-zone ap-south-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=sri-private-subnet-1}]' \
  --query 'Subnet.SubnetId' --output text)

# Private Subnet 2
PRI_SUB2=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID --cidr-block 10.0.4.0/24 \
  --availability-zone ap-south-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=sri-private-subnet-2}]' \
  --query 'Subnet.SubnetId' --output text)

# Enable auto-assign public IP for public subnets
aws ec2 modify-subnet-attribute --subnet-id $PUB_SUB1 --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id $PUB_SUB2 --map-public-ip-on-launch

echo "Subnets: $PUB_SUB1, $PUB_SUB2, $PRI_SUB1, $PRI_SUB2"
```

---

## Step 4: Create Route Tables

```bash
# Public Route Table
PUB_RT=$(aws ec2 create-route-table \
  --vpc-id $VPC_ID \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=sri-public-rt}]' \
  --query 'RouteTable.RouteTableId' --output text)

# Add route to IGW
aws ec2 create-route --route-table-id $PUB_RT --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID

# Associate public subnets
aws ec2 associate-route-table --route-table-id $PUB_RT --subnet-id $PUB_SUB1
aws ec2 associate-route-table --route-table-id $PUB_RT --subnet-id $PUB_SUB2

# Private Route Table (NAT route added in Step 5)
PRI_RT=$(aws ec2 create-route-table \
  --vpc-id $VPC_ID \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=sri-private-rt}]' \
  --query 'RouteTable.RouteTableId' --output text)

# Associate private subnets
aws ec2 associate-route-table --route-table-id $PRI_RT --subnet-id $PRI_SUB1
aws ec2 associate-route-table --route-table-id $PRI_RT --subnet-id $PRI_SUB2
```

---

## Step 5: Create NAT Gateway

```bash
# Allocate Elastic IP
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=sri-nat-eip}]' \
  --query 'AllocationId' --output text)

# Create NAT Gateway in Public Subnet 1
NAT_ID=$(aws ec2 create-nat-gateway \
  --subnet-id $PUB_SUB1 --allocation-id $EIP_ALLOC \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=sri-nat-gw}]' \
  --query 'NatGateway.NatGatewayId' --output text)

# Wait for NAT Gateway to become available
aws ec2 wait nat-gateway-available --nat-gateway-ids $NAT_ID

# Add route to private route table
aws ec2 create-route --route-table-id $PRI_RT --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT_ID

echo "NAT Gateway: $NAT_ID"
```

---

## Step 6: Create Security Groups

```bash
# ALB Security Group
ALB_SG=$(aws ec2 create-security-group \
  --group-name sri-alb-sg --description "Allow HTTP/HTTPS from anywhere" \
  --vpc-id $VPC_ID --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 443 --cidr 0.0.0.0/0

# Bastion Security Group
BASTION_SG=$(aws ec2 create-security-group \
  --group-name sri-bastion-sg --description "Allow SSH" \
  --vpc-id $VPC_ID --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id $BASTION_SG --protocol tcp --port 22 --cidr 0.0.0.0/0

# App Security Group
APP_SG=$(aws ec2 create-security-group \
  --group-name sri-app-sg --description "Allow HTTP from ALB and SSH from Bastion" \
  --vpc-id $VPC_ID --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id $APP_SG --protocol tcp --port 80 \
  --source-group $ALB_SG
aws ec2 authorize-security-group-ingress --group-id $APP_SG --protocol tcp --port 22 \
  --source-group $BASTION_SG

echo "Security Groups: ALB=$ALB_SG, Bastion=$BASTION_SG, App=$APP_SG"
```

---

## Step 7: Import SSL Certificate

```bash
CERT_ARN=$(aws acm import-certificate \
  --certificate fileb://certs/garden/body.pem \
  --private-key fileb://certs/garden/tls.key \
  --certificate-chain fileb://certs/garden/chain.pem \
  --query 'CertificateArn' --output text)

echo "Certificate ARN: $CERT_ARN"
```

---

## Step 8: Create Target Group

```bash
TG_ARN=$(aws elbv2 create-target-group \
  --name sri-tg --protocol HTTP --port 80 \
  --vpc-id $VPC_ID --target-type instance \
  --health-check-path "/" --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 --unhealthy-threshold-count 2 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

echo "Target Group: $TG_ARN"
```

---

## Step 9: Create Application Load Balancer

```bash
# Create ALB
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name sri-alb --scheme internet-facing \
  --type application --security-groups $ALB_SG \
  --subnets $PUB_SUB1 $PUB_SUB2 \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

# HTTP Listener (Redirect to HTTPS)
aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'

# HTTPS Listener
aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
  --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-2016-08 \
  --certificates CertificateArn=$CERT_ARN \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN

# Get ALB DNS Name
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' --output text)

echo "ALB DNS: $ALB_DNS"
```

---

## Step 10: Create Launch Template

```bash
# Base64 encode user data
USER_DATA=$(base64 -i user_data.sh)

# Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)

# Create Launch Template
aws ec2 create-launch-template \
  --launch-template-name sri-lt \
  --version-description "v1" \
  --launch-template-data "{
    \"ImageId\": \"$AMI_ID\",
    \"InstanceType\": \"t2.micro\",
    \"KeyName\": \"aws\",
    \"NetworkInterfaces\": [{
      \"AssociatePublicIpAddress\": false,
      \"DeviceIndex\": 0,
      \"Groups\": [\"$APP_SG\"]
    }],
    \"UserData\": \"$USER_DATA\"
  }"
```

---

## Step 11: Create Auto Scaling Group

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name sri-asg \
  --launch-template LaunchTemplateName=sri-lt,Version='$Latest' \
  --min-size 2 --max-size 3 --desired-capacity 2 \
  --vpc-zone-identifier "$PRI_SUB1,$PRI_SUB2" \
  --target-group-arns $TG_ARN \
  --health-check-type ELB \
  --health-check-grace-period 300

# CPU Scaling Policy (Target: 50%)
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name sri-asg \
  --policy-name sri-cpu-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 50.0
  }'
```

---

## Step 12: Launch Bastion Host

```bash
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name aws \
  --subnet-id $PUB_SUB1 \
  --security-group-ids $BASTION_SG \
  --associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=sri-bastion}]'
```

---

## Step 13: Configure Route 53

```bash
# Create Hosted Zone
ZONE_ID=$(aws route53 create-hosted-zone \
  --name srinivaskona.life \
  --caller-reference "$(date +%s)" \
  --query 'HostedZone.Id' --output text)

# Get ALB Hosted Zone ID
ALB_ZONE=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)

# Create A Record (Alias to ALB)
aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID --change-batch '{
  "Changes": [{
    "Action": "CREATE",
    "ResourceRecordSet": {
      "Name": "garden.srinivaskona.life",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "'$ALB_ZONE'",
        "DNSName": "'$ALB_DNS'",
        "EvaluateTargetHealth": true
      }
    }
  }]
}'

# Get Nameservers (update in GoDaddy)
aws route53 get-hosted-zone --id $ZONE_ID --query 'DelegationSet.NameServers'
```

---

## 🗑️ Cleanup (Destroy Everything)

Run in reverse order to avoid dependency errors:

```bash
# 1. Delete ASG
aws autoscaling delete-auto-scaling-group --auto-scaling-group-name sri-asg --force-delete

# 2. Delete Launch Template
aws ec2 delete-launch-template --launch-template-name sri-lt

# 3. Delete ALB Listeners, then ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN

# 4. Delete Target Group (wait for ALB to finish deleting)
sleep 30
aws elbv2 delete-target-group --target-group-arn $TG_ARN

# 5. Delete NAT Gateway
aws ec2 delete-nat-gateway --nat-gateway-id $NAT_ID

# 6. Release EIP (wait for NAT to finish deleting)
sleep 60
aws ec2 release-address --allocation-id $EIP_ALLOC

# 7. Delete Bastion
BASTION_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=sri-bastion" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 terminate-instances --instance-ids $BASTION_ID

# 8. Delete Security Groups
aws ec2 delete-security-group --group-id $APP_SG
aws ec2 delete-security-group --group-id $BASTION_SG
aws ec2 delete-security-group --group-id $ALB_SG

# 9. Delete Subnets
for SUB in $PUB_SUB1 $PUB_SUB2 $PRI_SUB1 $PRI_SUB2; do
  aws ec2 delete-subnet --subnet-id $SUB
done

# 10. Delete Route Tables
aws ec2 delete-route-table --route-table-id $PUB_RT
aws ec2 delete-route-table --route-table-id $PRI_RT

# 11. Detach and Delete IGW
aws ec2 detach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID
aws ec2 delete-internet-gateway --internet-gateway-id $IGW_ID

# 12. Delete VPC
aws ec2 delete-vpc --vpc-id $VPC_ID

# 13. Delete Route 53 Zone
aws route53 delete-hosted-zone --id $ZONE_ID

echo "✅ All resources destroyed."
```
