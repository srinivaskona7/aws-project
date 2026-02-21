'use strict';
const express = require('express');
const router = express.Router();
const { S3Client, CreateBucketCommand, ListObjectsV2Command, PutBucketVersioningCommand, PutBucketEncryptionCommand, PutPublicAccessBlockCommand, DeleteBucketCommand, PutBucketPolicyCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, ListRolesCommand, ListPoliciesCommand, CreatePolicyCommand, GetRoleCommand, DetachRolePolicyCommand, DeleteRoleCommand } = require('@aws-sdk/client-iam');
const { SecretsManagerClient, CreateSecretCommand, GetSecretValueCommand, ListSecretsCommand, UpdateSecretCommand, DeleteSecretCommand, RotateSecretCommand } = require('@aws-sdk/client-secrets-manager');
const { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, InvokeCommand, ListFunctionsCommand, GetFunctionCommand, UpdateFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
const { Route53Client, ListHostedZonesCommand, ChangeResourceRecordSetsCommand, ListResourceRecordSetsCommand, CreateHostedZoneCommand } = require('@aws-sdk/client-route-53');
const { ACMClient, RequestCertificateCommand, ListCertificatesCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');
const { CloudWatchLogsClient, DescribeLogGroupsCommand, DescribeLogStreamsCommand, GetLogEventsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { SNSClient, CreateTopicCommand, SubscribeCommand, PublishCommand, ListTopicsCommand } = require('@aws-sdk/client-sns');
const { v4: uuidv4 } = require('uuid');

function getCfg(req) {
  if (!req.session.awsCreds) throw new Error('AWS credentials not configured');
  const { accessKeyId, secretAccessKey, region, sessionToken } = req.session.awsCreds;
  const credentials = { accessKeyId, secretAccessKey };
  if (sessionToken) credentials.sessionToken = sessionToken;
  return { region: region || 'us-east-1', credentials };
}

// ===== S3 =====
router.get('/s3/buckets', async (req, res) => {
  try {
    const s3 = new S3Client(getCfg(req));
    const data = await s3.send(new (require('@aws-sdk/client-s3').ListBucketsCommand)({}));
    res.json({ buckets: data.Buckets });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/s3/buckets', async (req, res) => {
  try {
    const cfg = getCfg(req);
    const { bucketName, region, versioning = false, publicBlock = true } = req.body;
    if (!bucketName) return res.status(400).json({ error: 'bucketName required' });
    const s3 = new S3Client(cfg);
    const createCmd = region && region !== 'us-east-1'
      ? new CreateBucketCommand({ Bucket: bucketName, CreateBucketConfiguration: { LocationConstraint: region } })
      : new CreateBucketCommand({ Bucket: bucketName });
    await s3.send(createCmd);

    if (publicBlock) {
      await s3.send(new PutPublicAccessBlockCommand({ Bucket: bucketName, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } }));
    }
    if (versioning) {
      await s3.send(new PutBucketVersioningCommand({ Bucket: bucketName, VersioningConfiguration: { Status: 'Enabled' } }));
    }
    await s3.send(new PutBucketEncryptionCommand({
      Bucket: bucketName,
      ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }
    }));
    res.json({ success: true, bucket: bucketName, message: 'Bucket created with encryption + public block' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/s3/buckets/:bucket/objects', async (req, res) => {
  try {
    const s3 = new S3Client(getCfg(req));
    const data = await s3.send(new ListObjectsV2Command({ Bucket: req.params.bucket, MaxKeys: 100, Prefix: req.query.prefix || '' }));
    res.json({ objects: data.Contents || [], prefix: req.query.prefix, count: data.KeyCount });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== IAM =====
router.get('/iam/roles', async (req, res) => {
  try {
    const iam = new IAMClient(getCfg(req));
    const data = await iam.send(new ListRolesCommand({ MaxItems: 100 }));
    res.json({ roles: data.Roles.map(r => ({ name: r.RoleName, arn: r.Arn, created: r.CreateDate, description: r.Description })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/iam/roles', async (req, res) => {
  try {
    const cfg = getCfg(req);
    const { roleName, assumeService, description, policies = [] } = req.body;
    if (!roleName || !assumeService) return res.status(400).json({ error: 'roleName and assumeService required' });
    const iam = new IAMClient(cfg);

    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: assumeService }, Action: 'sts:AssumeRole' }]
    };

    const data = await iam.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
      Description: description || `Created by devops-portal`,
      Tags: [{ Key: 'ManagedBy', Value: 'devops-portal' }]
    }));

    for (const policyArn of policies) {
      await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: policyArn }));
    }

    res.json({ success: true, roleArn: data.Role.Arn, roleName: data.Role.RoleName });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/iam/policies', async (req, res) => {
  try {
    const cfg = getCfg(req);
    const { policyName, policyDocument, description } = req.body;
    if (!policyName || !policyDocument) return res.status(400).json({ error: 'policyName and policyDocument required' });
    const iam = new IAMClient(cfg);
    const data = await iam.send(new CreatePolicyCommand({
      PolicyName: policyName,
      PolicyDocument: typeof policyDocument === 'string' ? policyDocument : JSON.stringify(policyDocument),
      Description: description || 'Created by devops-portal'
    }));
    res.json({ success: true, policyArn: data.Policy.Arn });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Common managed policies list
router.get('/iam/managed-policies', (req, res) => {
  res.json({ policies: [
    { name: 'AdministratorAccess', arn: 'arn:aws:iam::aws:policy/AdministratorAccess' },
    { name: 'AmazonEC2FullAccess', arn: 'arn:aws:iam::aws:policy/AmazonEC2FullAccess' },
    { name: 'AmazonEKSClusterPolicy', arn: 'arn:aws:iam::aws:policy/AmazonEKSClusterPolicy' },
    { name: 'AmazonEKSWorkerNodePolicy', arn: 'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy' },
    { name: 'AmazonS3FullAccess', arn: 'arn:aws:iam::aws:policy/AmazonS3FullAccess' },
    { name: 'AmazonRDSFullAccess', arn: 'arn:aws:iam::aws:policy/AmazonRDSFullAccess' },
    { name: 'CloudWatchFullAccess', arn: 'arn:aws:iam::aws:policy/CloudWatchFullAccess' },
    { name: 'AWSLambda_FullAccess', arn: 'arn:aws:iam::aws:policy/AWSLambda_FullAccess' }
  ]});
});

// ===== SECRETS MANAGER =====
router.get('/secrets', async (req, res) => {
  try {
    const sm = new SecretsManagerClient(getCfg(req));
    const data = await sm.send(new ListSecretsCommand({ MaxResults: 50 }));
    res.json({ secrets: data.SecretList.map(s => ({ name: s.Name, arn: s.ARN, lastChanged: s.LastChangedDate, description: s.Description })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/secrets', async (req, res) => {
  try {
    const { name, value, description, kmsKeyId } = req.body;
    if (!name || !value) return res.status(400).json({ error: 'name and value required' });
    const sm = new SecretsManagerClient(getCfg(req));
    const input = { Name: name, SecretString: typeof value === 'string' ? value : JSON.stringify(value), Description: description };
    if (kmsKeyId) input.KmsKeyId = kmsKeyId;
    const data = await sm.send(new CreateSecretCommand(input));
    res.json({ success: true, arn: data.ARN, name: data.Name });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/secrets/:name', async (req, res) => {
  try {
    const sm = new SecretsManagerClient(getCfg(req));
    const data = await sm.send(new GetSecretValueCommand({ SecretId: req.params.name }));
    res.json({ success: true, name: data.Name, value: data.SecretString, arn: data.ARN });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== CLOUDWATCH LOGS =====
router.get('/logs/groups', async (req, res) => {
  try {
    const cw = new CloudWatchLogsClient(getCfg(req));
    const data = await cw.send(new DescribeLogGroupsCommand({ limit: 50, logGroupNamePrefix: req.query.prefix }));
    res.json({ logGroups: data.logGroups.map(g => ({ name: g.logGroupName, size: g.storedBytes, retention: g.retentionInDays })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/logs/filter', async (req, res) => {
  try {
    const { logGroupName, filterPattern, startTime, endTime, limit = 50 } = req.body;
    if (!logGroupName) return res.status(400).json({ error: 'logGroupName required' });
    const cw = new CloudWatchLogsClient(getCfg(req));
    const data = await cw.send(new FilterLogEventsCommand({
      logGroupName,
      filterPattern: filterPattern || '',
      startTime: startTime || Date.now() - 3600000,
      endTime: endTime || Date.now(),
      limit
    }));
    res.json({ events: data.events, nextToken: data.nextToken });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== LAMBDA =====
router.get('/lambda/functions', async (req, res) => {
  try {
    const lambda = new LambdaClient(getCfg(req));
    const data = await lambda.send(new ListFunctionsCommand({ MaxItems: 50 }));
    res.json({ functions: data.Functions.map(f => ({ name: f.FunctionName, runtime: f.Runtime, memory: f.MemorySize, timeout: f.Timeout, lastModified: f.LastModified, arn: f.FunctionArn })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/lambda/invoke', async (req, res) => {
  try {
    const { functionName, payload } = req.body;
    if (!functionName) return res.status(400).json({ error: 'functionName required' });
    const lambda = new LambdaClient(getCfg(req));
    const data = await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      Payload: payload ? Buffer.from(JSON.stringify(payload)) : undefined,
      LogType: 'Tail'
    }));
    const logs = data.LogResult ? Buffer.from(data.LogResult, 'base64').toString() : '';
    const result = data.Payload ? Buffer.from(data.Payload).toString() : '';
    res.json({ success: true, statusCode: data.StatusCode, result, logs });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== ROUTE53 =====
router.get('/route53/zones', async (req, res) => {
  try {
    const r53 = new Route53Client(getCfg(req));
    const data = await r53.send(new ListHostedZonesCommand({}));
    res.json({ zones: data.HostedZones.map(z => ({ id: z.Id, name: z.Name, private: z.Config?.PrivateZone, count: z.ResourceRecordSetCount })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/route53/records', async (req, res) => {
  try {
    const { zoneId, name, type, value, ttl = 300, action = 'UPSERT' } = req.body;
    if (!zoneId || !name || !type || !value) return res.status(400).json({ error: 'zoneId, name, type, value required' });
    const r53 = new Route53Client(getCfg(req));
    await r53.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [{
          Action: action,
          ResourceRecordSet: {
            Name: name,
            Type: type,
            TTL: ttl,
            ResourceRecords: [{ Value: value }]
          }
        }]
      }
    }));
    res.json({ success: true, message: `DNS record ${name} ${type} ${action}d` });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== ACM =====
router.get('/acm/certificates', async (req, res) => {
  try {
    const acm = new ACMClient(getCfg(req));
    const data = await acm.send(new ListCertificatesCommand({}));
    res.json({ certificates: data.CertificateSummaryList.map(c => ({ arn: c.CertificateArn, domain: c.DomainName, status: c.Status })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/acm/request', async (req, res) => {
  try {
    const { domainName, subjectAlternativeNames = [], validationMethod = 'DNS' } = req.body;
    if (!domainName) return res.status(400).json({ error: 'domainName required' });
    const acm = new ACMClient(getCfg(req));
    const data = await acm.send(new RequestCertificateCommand({ DomainName: domainName, SubjectAlternativeNames: subjectAlternativeNames, ValidationMethod: validationMethod }));
    res.json({ success: true, certificateArn: data.CertificateArn });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== SNS =====
router.post('/sns/notify', async (req, res) => {
  try {
    const { topicArn, subject, message } = req.body;
    if (!topicArn || !message) return res.status(400).json({ error: 'topicArn and message required' });
    const sns = new SNSClient(getCfg(req));
    const data = await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }));
    res.json({ success: true, messageId: data.MessageId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/sns/topics', async (req, res) => {
  try {
    const sns = new SNSClient(getCfg(req));
    const data = await sns.send(new ListTopicsCommand({}));
    res.json({ topics: data.Topics });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== NGINX CONFIG GENERATOR =====
router.post('/nginx/generate', (req, res) => {
  const {
    serverName,
    proxyPass,
    sslEnabled = false,
    certPath,
    keyPath,
    listenPort = 80,
    locations = []
  } = req.body;

  if (!serverName) return res.status(400).json({ error: 'serverName required' });

  const locationBlocks = locations.length
    ? locations.map(l => `
    location ${l.path || '/'} {
        proxy_pass ${l.upstream};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        ${l.timeout ? `proxy_read_timeout ${l.timeout};` : ''}
    }`).join('\n')
    : `
    location / {
        ${proxyPass ? `proxy_pass ${proxyPass};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;` : 'root /var/www/html;\n        index index.html;'}
    }`;

  const config = `# Generated by DevOps Portal - ${new Date().toISOString()}
# Server: ${serverName}

server {
    listen ${sslEnabled ? '443 ssl http2' : listenPort};
    server_name ${serverName};
    ${sslEnabled && certPath ? `
    ssl_certificate     ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;` : ''}

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    # Access and error logs
    access_log /var/log/nginx/${serverName}.access.log;
    error_log  /var/log/nginx/${serverName}.error.log;

    # Client limits
    client_max_body_size 50M;
    keepalive_timeout 65;

${locationBlocks}
}
${sslEnabled ? `
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name ${serverName};
    return 301 https://$host$request_uri;
}` : ''}
`;

  res.json({ success: true, config, filename: `${serverName}.conf` });
});

module.exports = router;
