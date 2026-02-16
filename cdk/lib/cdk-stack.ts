import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────
// Stack Configuration Interface
// ─────────────────────────────────────────────────────────────
export interface LoadBalancerStackProps extends cdk.StackProps {
  projectName: string;
  domainName: string;
  vpcCidr: string;
  publicSubnetCidrs: string[];
  privateSubnetCidrs: string[];
  availabilityZones: string[];
  instanceType: string;
  keyName: string;
  certFolder: string;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LoadBalancerStackProps) {
    super(scope, id, props);

    const { projectName } = props;

    // ═══════════════════════════════════════════════════════════
    // 1. NETWORKING — VPC, Subnets, Gateways, Route Tables
    // ═══════════════════════════════════════════════════════════

    // VPC (DNS support enabled)
    const vpc = new ec2.CfnVPC(this, 'VPC', {
      cidrBlock: props.vpcCidr,
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: [{ key: 'Name', value: `${projectName}-vpc` }],
    });

    // Internet Gateway
    const igw = new ec2.CfnInternetGateway(this, 'IGW', {
      tags: [{ key: 'Name', value: `${projectName}-igw` }],
    });

    new ec2.CfnVPCGatewayAttachment(this, 'IGWAttachment', {
      vpcId: vpc.ref,
      internetGatewayId: igw.ref,
    });

    // Public Subnets
    const publicSubnets: ec2.CfnSubnet[] = [];
    props.publicSubnetCidrs.forEach((cidr, index) => {
      const subnet = new ec2.CfnSubnet(this, `PublicSubnet${index + 1}`, {
        vpcId: vpc.ref,
        cidrBlock: cidr,
        availabilityZone: props.availabilityZones[index],
        mapPublicIpOnLaunch: true,
        tags: [{ key: 'Name', value: `${projectName}-public-subnet-${index + 1}` }],
      });
      publicSubnets.push(subnet);
    });

    // Private Subnets
    const privateSubnets: ec2.CfnSubnet[] = [];
    props.privateSubnetCidrs.forEach((cidr, index) => {
      const subnet = new ec2.CfnSubnet(this, `PrivateSubnet${index + 1}`, {
        vpcId: vpc.ref,
        cidrBlock: cidr,
        availabilityZone: props.availabilityZones[index],
        tags: [{ key: 'Name', value: `${projectName}-private-subnet-${index + 1}` }],
      });
      privateSubnets.push(subnet);
    });

    // Elastic IP for NAT Gateway
    const natEip = new ec2.CfnEIP(this, 'NatEIP', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: `${projectName}-nat-eip` }],
    });

    // NAT Gateway (in first public subnet)
    const natGw = new ec2.CfnNatGateway(this, 'NatGateway', {
      allocationId: natEip.attrAllocationId,
      subnetId: publicSubnets[0].ref,
      tags: [{ key: 'Name', value: `${projectName}-nat-gw` }],
    });
    natGw.addDependency(igw);

    // Public Route Table (→ IGW)
    const publicRt = new ec2.CfnRouteTable(this, 'PublicRouteTable', {
      vpcId: vpc.ref,
      tags: [{ key: 'Name', value: `${projectName}-public-rt` }],
    });

    new ec2.CfnRoute(this, 'PublicRoute', {
      routeTableId: publicRt.ref,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: igw.ref,
    });

    publicSubnets.forEach((subnet, index) => {
      new ec2.CfnSubnetRouteTableAssociation(this, `PublicRTAssoc${index + 1}`, {
        subnetId: subnet.ref,
        routeTableId: publicRt.ref,
      });
    });

    // Private Route Table (→ NAT GW)
    const privateRt = new ec2.CfnRouteTable(this, 'PrivateRouteTable', {
      vpcId: vpc.ref,
      tags: [{ key: 'Name', value: `${projectName}-private-rt` }],
    });

    new ec2.CfnRoute(this, 'PrivateRoute', {
      routeTableId: privateRt.ref,
      destinationCidrBlock: '0.0.0.0/0',
      natGatewayId: natGw.ref,
    });

    privateSubnets.forEach((subnet, index) => {
      new ec2.CfnSubnetRouteTableAssociation(this, `PrivateRTAssoc${index + 1}`, {
        subnetId: subnet.ref,
        routeTableId: privateRt.ref,
      });
    });

    // ═══════════════════════════════════════════════════════════
    // 2. SECURITY — Security Groups
    // ═══════════════════════════════════════════════════════════

    // ALB Security Group (HTTP/HTTPS from anywhere)
    const albSg = new ec2.CfnSecurityGroup(this, 'AlbSG', {
      groupDescription: 'Allow HTTP and HTTPS inbound traffic from anywhere',
      groupName: `${projectName}-alb-sg`,
      vpcId: vpc.ref,
      securityGroupIngress: [
        { ipProtocol: 'tcp', fromPort: 80, toPort: 80, cidrIp: '0.0.0.0/0', description: 'HTTP from anywhere' },
        { ipProtocol: 'tcp', fromPort: 443, toPort: 443, cidrIp: '0.0.0.0/0', description: 'HTTPS from anywhere' },
      ],
      securityGroupEgress: [
        { ipProtocol: '-1', cidrIp: '0.0.0.0/0' },
      ],
      tags: [{ key: 'Name', value: `${projectName}-alb-sg` }],
    });

    // Bastion Security Group (SSH from anywhere)
    const bastionSg = new ec2.CfnSecurityGroup(this, 'BastionSG', {
      groupDescription: 'Allow SSH inbound traffic',
      groupName: `${projectName}-bastion-sg`,
      vpcId: vpc.ref,
      securityGroupIngress: [
        { ipProtocol: 'tcp', fromPort: 22, toPort: 22, cidrIp: '0.0.0.0/0', description: 'SSH from anywhere' },
      ],
      securityGroupEgress: [
        { ipProtocol: '-1', cidrIp: '0.0.0.0/0' },
      ],
      tags: [{ key: 'Name', value: `${projectName}-bastion-sg` }],
    });

    // Application Security Group (HTTP from ALB, SSH from Bastion)
    const appSg = new ec2.CfnSecurityGroup(this, 'AppSG', {
      groupDescription: 'Allow HTTP from ALB and SSH from Bastion',
      groupName: `${projectName}-app-sg`,
      vpcId: vpc.ref,
      securityGroupIngress: [
        { ipProtocol: 'tcp', fromPort: 80, toPort: 80, sourceSecurityGroupId: albSg.attrGroupId, description: 'HTTP from ALB' },
        { ipProtocol: 'tcp', fromPort: 22, toPort: 22, sourceSecurityGroupId: bastionSg.attrGroupId, description: 'SSH from Bastion' },
      ],
      securityGroupEgress: [
        { ipProtocol: '-1', cidrIp: '0.0.0.0/0' },
      ],
      tags: [{ key: 'Name', value: `${projectName}-app-sg` }],
    });

    // ═══════════════════════════════════════════════════════════
    // 3. CERTIFICATE — ACM Certificate ARN
    // ═══════════════════════════════════════════════════════════
    // CloudFormation does NOT support ACM certificate import.
    // Import your certificate via AWS CLI first, then pass the ARN:
    //
    //   aws acm import-certificate \
    //     --certificate-body fileb://certs/garden/body.pem \
    //     --private-key fileb://certs/garden/tls.key \
    //     --certificate-chain fileb://certs/garden/chain.pem \
    //     --region ap-south-1
    //
    //   npx cdk deploy -c certArn=arn:aws:acm:ap-south-1:ACCOUNT:certificate/ID

    const certArnInput = this.node.tryGetContext('certArn') as string | undefined;
    const certArn = certArnInput || 'arn:aws:acm:ap-south-1:000000000000:certificate/placeholder';
    if (!certArnInput) {
      process.stderr.write(
        '\n⚠️  WARNING: No certArn provided. Using placeholder for synth validation.\n' +
        '   For deployment, import your certificate first, then:\n' +
        '   npx cdk deploy -c certArn=arn:aws:acm:ap-south-1:ACCOUNT:certificate/ID\n\n'
      );
    }


    // ═══════════════════════════════════════════════════════════
    // 4. LOAD BALANCER — ALB, Target Group, Listeners
    // ═══════════════════════════════════════════════════════════

    // Application Load Balancer
    const alb = new elbv2.CfnLoadBalancer(this, 'ALB', {
      name: `${projectName}-alb`,
      scheme: 'internet-facing',
      type: 'application',
      securityGroups: [albSg.attrGroupId],
      subnets: publicSubnets.map(s => s.ref),
      tags: [{ key: 'Name', value: `${projectName}-alb` }],
    });

    // Target Group
    const targetGroup = new elbv2.CfnTargetGroup(this, 'TargetGroup', {
      name: `${projectName}-tg`,
      port: 80,
      protocol: 'HTTP',
      vpcId: vpc.ref,
      targetType: 'instance',
      healthCheckEnabled: true,
      healthCheckPath: '/',
      healthCheckIntervalSeconds: 30,
      healthCheckTimeoutSeconds: 5,
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 2,
      matcher: { httpCode: '200' },
      tags: [{ key: 'Name', value: `${projectName}-tg` }],
    });

    // HTTP Listener (Redirect to HTTPS)
    new elbv2.CfnListener(this, 'HttpListener', {
      loadBalancerArn: alb.ref,
      port: 80,
      protocol: 'HTTP',
      defaultActions: [{
        type: 'redirect',
        redirectConfig: {
          port: '443',
          protocol: 'HTTPS',
          statusCode: 'HTTP_301',
        },
      }],
    });

    // HTTPS Listener
    new elbv2.CfnListener(this, 'HttpsListener', {
      loadBalancerArn: alb.ref,
      port: 443,
      protocol: 'HTTPS',
      sslPolicy: 'ELBSecurityPolicy-2016-08',
      certificates: [{ certificateArn: certArn }],
      defaultActions: [{
        type: 'forward',
        targetGroupArn: targetGroup.ref,
      }],
    });

    // ═══════════════════════════════════════════════════════════
    // 5. COMPUTE — Bastion Host, Launch Template, ASG
    // ═══════════════════════════════════════════════════════════

    // Latest Amazon Linux 2023 AMI (using SSM parameter)
    const ami = ec2.MachineImage.latestAmazonLinux2023();
    const amiId = new cdk.CfnParameter(this, 'AmiId', {
      type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
      default: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
      description: 'Latest Amazon Linux 2023 AMI ID',
    });

    // Bastion Host (Public Subnet)
    const bastion = new ec2.CfnInstance(this, 'BastionHost', {
      imageId: amiId.valueAsString,
      instanceType: props.instanceType,
      subnetId: publicSubnets[0].ref,
      keyName: props.keyName,
      securityGroupIds: [bastionSg.attrGroupId],
      tags: [{ key: 'Name', value: `${projectName}-bastion` }],
    });

    // User Data Script
    const userDataScript = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'user_data.sh'),
      'utf8'
    );
    const userDataBase64 = cdk.Fn.base64(userDataScript);

    // Launch Template
    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateName: `${projectName}-lt`,
      launchTemplateData: {
        imageId: amiId.valueAsString,
        instanceType: props.instanceType,
        keyName: props.keyName,
        userData: userDataBase64,
        networkInterfaces: [{
          associatePublicIpAddress: false,
          deviceIndex: 0,
          groups: [appSg.attrGroupId],
        }],
        tagSpecifications: [{
          resourceType: 'instance',
          tags: [{ key: 'Name', value: `${projectName}-app` }],
        }],
      },
    });

    // Auto Scaling Group
    const asg = new autoscaling.CfnAutoScalingGroup(this, 'ASG', {
      autoScalingGroupName: `${projectName}-asg`,
      desiredCapacity: '2',
      maxSize: '3',
      minSize: '2',
      vpcZoneIdentifier: privateSubnets.map(s => s.ref),
      targetGroupArns: [targetGroup.ref],
      healthCheckType: 'ELB',
      launchTemplate: {
        launchTemplateId: launchTemplate.ref,
        version: launchTemplate.attrLatestVersionNumber,
      },
      tags: [{
        key: 'Name',
        value: `${projectName}-app-asg`,
        propagateAtLaunch: true,
      }],
    });

    // ═══════════════════════════════════════════════════════════
    // 6. SCALING POLICIES
    // ═══════════════════════════════════════════════════════════

    // CPU Utilization Policy (Target: 50%)
    new autoscaling.CfnScalingPolicy(this, 'CpuScalingPolicy', {
      autoScalingGroupName: asg.ref,
      policyType: 'TargetTrackingScaling',
      targetTrackingConfiguration: {
        predefinedMetricSpecification: {
          predefinedMetricType: 'ASGAverageCPUUtilization',
        },
        targetValue: 50.0,
      },
    });

    // Request Count Policy (Target: 100 requests per target)
    new autoscaling.CfnScalingPolicy(this, 'RequestCountPolicy', {
      autoScalingGroupName: asg.ref,
      policyType: 'TargetTrackingScaling',
      targetTrackingConfiguration: {
        predefinedMetricSpecification: {
          predefinedMetricType: 'ALBRequestCountPerTarget',
          resourceLabel: cdk.Fn.join('/', [
            alb.attrLoadBalancerFullName,
            targetGroup.attrTargetGroupFullName,
          ]),
        },
        targetValue: 100.0,
      },
    });

    // ═══════════════════════════════════════════════════════════
    // 7. DNS — Route 53 Hosted Zone & Records
    // ═══════════════════════════════════════════════════════════

    // Hosted Zone
    const hostedZone = new route53.CfnHostedZone(this, 'HostedZone', {
      name: props.domainName,
      hostedZoneTags: [{ key: 'Name', value: `${projectName}-zone` }],
    });

    // Root Domain → ALB (A Alias Record)
    new route53.CfnRecordSet(this, 'RootRecord', {
      hostedZoneId: hostedZone.ref,
      name: props.domainName,
      type: 'A',
      aliasTarget: {
        dnsName: alb.attrDnsName,
        hostedZoneId: alb.attrCanonicalHostedZoneId,
        evaluateTargetHealth: true,
      },
    });

    // www Record → ALB (A Alias Record)
    new route53.CfnRecordSet(this, 'WwwRecord', {
      hostedZoneId: hostedZone.ref,
      name: `www.${props.domainName}`,
      type: 'A',
      aliasTarget: {
        dnsName: alb.attrDnsName,
        hostedZoneId: alb.attrCanonicalHostedZoneId,
        evaluateTargetHealth: true,
      },
    });

    // ═══════════════════════════════════════════════════════════
    // 8. OUTPUTS
    // ═══════════════════════════════════════════════════════════

    new cdk.CfnOutput(this, 'VpcId', {
      description: 'ID of the VPC',
      value: vpc.ref,
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      description: 'The DNS name of the Load Balancer',
      value: alb.attrDnsName,
    });

    new cdk.CfnOutput(this, 'BastionPublicIp', {
      description: 'Public IP of the Bastion Host',
      value: bastion.attrPublicIp,
    });

    new cdk.CfnOutput(this, 'IgwId', {
      description: 'ID of the Internet Gateway',
      value: igw.ref,
    });

    new cdk.CfnOutput(this, 'NatGatewayId', {
      description: 'ID of the NAT Gateway',
      value: natGw.ref,
    });

    new cdk.CfnOutput(this, 'Nameservers', {
      description: 'The nameservers for the Route53 zone (Update these in GoDaddy)',
      value: cdk.Fn.join(', ', hostedZone.attrNameServers),
    });
  }
}
