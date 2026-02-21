'use strict';
const express = require('express');
const router = express.Router();
const { EC2Client, DescribeInstancesCommand, DescribeRegionsCommand, DescribeVpcsCommand, DescribeSecurityGroupsCommand, DescribeSubnetsCommand, DescribeKeyPairsCommand, DescribeImagesCommand, CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand, DeleteSecurityGroupCommand } = require('@aws-sdk/client-ec2');
const { EKSClient, ListClustersCommand, DescribeClusterCommand } = require('@aws-sdk/client-eks');
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
const { AutoScalingClient, DescribeAutoScalingGroupsCommand } = require('@aws-sdk/client-auto-scaling');
const { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } = require('@aws-sdk/client-elastic-load-balancing-v2');

function getAwsConfig(req) {
  if (!req.session.awsCreds) throw new Error('AWS credentials not configured. POST /api/credentials first.');
  const { accessKeyId, secretAccessKey, region, sessionToken } = req.session.awsCreds;
  const creds = { accessKeyId, secretAccessKey };
  if (sessionToken) creds.sessionToken = sessionToken;
  return { region: region || 'us-east-1', credentials: creds };
}

// GET /api/regions
router.get('/regions', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const client = new EC2Client(cfg);
    const data = await client.send(new DescribeRegionsCommand({ AllRegions: false }));
    res.json({ regions: data.Regions.map(r => r.RegionName).sort() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/resources - overview of all running resources
router.get('/resources', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const results = {};

    // EC2 Instances
    try {
      const ec2 = new EC2Client(cfg);
      const data = await ec2.send(new DescribeInstancesCommand({ Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped', 'pending'] }] }));
      results.ec2 = data.Reservations.flatMap(r => r.Instances).map(i => ({
        id: i.InstanceId,
        type: i.InstanceType,
        state: i.State.Name,
        publicIp: i.PublicIpAddress,
        privateIp: i.PrivateIpAddress,
        name: (i.Tags || []).find(t => t.Key === 'Name')?.Value || 'unnamed',
        az: i.Placement?.AvailabilityZone,
        launchTime: i.LaunchTime
      }));
    } catch (e) { results.ec2Error = e.message; }

    // EKS Clusters
    try {
      const eks = new EKSClient(cfg);
      const clusterList = await eks.send(new ListClustersCommand({}));
      results.eks = clusterList.clusters || [];
    } catch (e) { results.eksError = e.message; }

    // S3 Buckets
    try {
      const s3 = new S3Client(cfg);
      const data = await s3.send(new ListBucketsCommand({}));
      results.s3 = (data.Buckets || []).map(b => ({ name: b.Name, created: b.CreationDate }));
    } catch (e) { results.s3Error = e.message; }

    // RDS
    try {
      const rds = new RDSClient(cfg);
      const data = await rds.send(new DescribeDBInstancesCommand({}));
      results.rds = (data.DBInstances || []).map(d => ({
        id: d.DBInstanceIdentifier,
        engine: d.Engine,
        status: d.DBInstanceStatus,
        endpoint: d.Endpoint?.Address,
        size: d.DBInstanceClass
      }));
    } catch (e) { results.rdsError = e.message; }

    // Auto Scaling Groups
    try {
      const asg = new AutoScalingClient(cfg);
      const data = await asg.send(new DescribeAutoScalingGroupsCommand({}));
      results.asg = (data.AutoScalingGroups || []).map(g => ({
        name: g.AutoScalingGroupName,
        desired: g.DesiredCapacity,
        min: g.MinSize,
        max: g.MaxSize,
        instances: g.Instances?.length || 0
      }));
    } catch (e) { results.asgError = e.message; }

    // Load Balancers
    try {
      const elb = new ElasticLoadBalancingV2Client(cfg);
      const data = await elb.send(new DescribeLoadBalancersCommand({}));
      results.alb = (data.LoadBalancers || []).map(lb => ({
        name: lb.LoadBalancerName,
        dns: lb.DNSName,
        state: lb.State?.Code,
        type: lb.Type
      }));
    } catch (e) { results.albError = e.message; }

    res.json({ success: true, region: cfg.region, resources: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/vpcs
router.get('/vpcs', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const ec2 = new EC2Client(cfg);
    const data = await ec2.send(new DescribeVpcsCommand({}));
    res.json({ vpcs: data.Vpcs.map(v => ({ id: v.VpcId, cidr: v.CidrBlock, isDefault: v.IsDefault, name: (v.Tags||[]).find(t=>t.Key==='Name')?.Value })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/subnets
router.get('/subnets', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const ec2 = new EC2Client(cfg);
    const data = await ec2.send(new DescribeSubnetsCommand({}));
    res.json({ subnets: data.Subnets.map(s => ({ id: s.SubnetId, cidr: s.CidrBlock, az: s.AvailabilityZone, vpcId: s.VpcId, public: s.MapPublicIpOnLaunch, name: (s.Tags||[]).find(t=>t.Key==='Name')?.Value })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/keypairs
router.get('/keypairs', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const ec2 = new EC2Client(cfg);
    const data = await ec2.send(new DescribeKeyPairsCommand({}));
    res.json({ keypairs: data.KeyPairs.map(k => ({ name: k.KeyName, fingerprint: k.KeyFingerprint })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/security-groups
router.get('/security-groups', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const ec2 = new EC2Client(cfg);
    const { vpcId } = req.query;
    const filters = vpcId ? [{ Name: 'vpc-id', Values: [vpcId] }] : [];
    const data = await ec2.send(new DescribeSecurityGroupsCommand({ Filters: filters }));
    res.json({ securityGroups: data.SecurityGroups.map(sg => ({ id: sg.GroupId, name: sg.GroupName, desc: sg.Description, vpcId: sg.VpcId, inbound: sg.IpPermissions, outbound: sg.IpPermissionsEgress })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/security-groups - create SG
router.post('/security-groups', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const { name, description, vpcId } = req.body;
    const ec2 = new EC2Client(cfg);
    const data = await ec2.send(new CreateSecurityGroupCommand({ GroupName: name, Description: description, VpcId: vpcId }));
    res.json({ success: true, groupId: data.GroupId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/security-groups/:id/rules
router.post('/security-groups/:id/rules', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const { protocol, fromPort, toPort, cidr } = req.body;
    const ec2 = new EC2Client(cfg);
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: req.params.id,
      IpPermissions: [{ IpProtocol: protocol, FromPort: parseInt(fromPort), ToPort: parseInt(toPort), IpRanges: [{ CidrIp: cidr }] }]
    }));
    res.json({ success: true, message: `Rule added to ${req.params.id}` });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/ec2/amis - popular AMIs
router.get('/ec2/amis', async (req, res) => {
  try {
    const cfg = getAwsConfig(req);
    const ec2 = new EC2Client(cfg);
    const data = await ec2.send(new DescribeImagesCommand({
      Owners: ['amazon'],
      Filters: [
        { Name: 'name', Values: ['amzn2-ami-hvm-*-x86_64-gp2', 'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*'] },
        { Name: 'state', Values: ['available'] }
      ]
    }));
    const sorted = (data.Images || []).sort((a, b) => new Date(b.CreationDate) - new Date(a.CreationDate)).slice(0, 20);
    res.json({ amis: sorted.map(i => ({ id: i.ImageId, name: i.Name, desc: i.Description, date: i.CreationDate, arch: i.Architecture })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
