'use strict';
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const WORK_DIR = path.join(os.tmpdir(), 'devops-portal');

function getCfg(req) {
  if (!req.session.awsCreds) throw new Error('AWS credentials not configured. POST /api/credentials first.');
  const { accessKeyId, secretAccessKey, region, sessionToken } = req.session.awsCreds;
  const credentials = { accessKeyId, secretAccessKey };
  if (sessionToken) credentials.sessionToken = sessionToken;
  return { region: region || 'us-east-1', credentials };
}

function streamOutput(res, jobId, cmd, args, cwd, env) {
  return new Promise((resolve, reject) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
    const send = (line) => res.write(`data: ${JSON.stringify({ jobId, line, ts: Date.now() })}\n\n`);
    send(`[JOB:${jobId}] $ ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, { cwd: cwd || WORK_DIR, env: { ...process.env, ...env }, shell: true });
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(send));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(`[STDERR] ${l}`)));
    proc.on('close', code => {
      send(`[JOB:${jobId}] Exited: ${code}`);
      res.write(`data: ${JSON.stringify({ jobId, done: true, exitCode: code })}\n\n`);
      res.end();
      code === 0 ? resolve() : reject(new Error(`Exit ${code}`));
    });
    proc.on('error', err => { send(`[ERROR] ${err.message}`); res.end(); reject(err); });
  });
}

// ===== 1. CLOUDFORMATION =====
const { CloudFormationClient, ListStacksCommand, DescribeStacksCommand, CreateStackCommand, UpdateStackCommand, DeleteStackCommand, DescribeStackEventsCommand, GetTemplateCommand } = require('@aws-sdk/client-cloudformation');

router.get('/cfn/stacks', async (req, res) => {
  try {
    const cfn = new CloudFormationClient(getCfg(req));
    const data = await cfn.send(new ListStacksCommand({ StackStatusFilter: ['CREATE_COMPLETE','UPDATE_COMPLETE','ROLLBACK_COMPLETE','CREATE_IN_PROGRESS','UPDATE_IN_PROGRESS','DELETE_FAILED','ROLLBACK_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE'] }));
    res.json({ stacks: (data.StackSummaries||[]).map(s => ({ name: s.StackName, status: s.StackStatus, created: s.CreationTime, updated: s.LastUpdatedTime })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/cfn/deploy', async (req, res) => {
  const { stackName, templateBody, templateUrl, parameters = {}, capabilities = ['CAPABILITY_IAM','CAPABILITY_NAMED_IAM'], dryRun = false } = req.body;
  if (!stackName) return res.status(400).json({ error: 'stackName required' });
  if (!templateBody && !templateUrl) return res.status(400).json({ error: 'templateBody or templateUrl required' });
  try {
    const cfg = getCfg(req);
    const cfn = new CloudFormationClient(cfg);
    const params = { StackName: stackName, Capabilities: capabilities };
    if (templateBody) params.TemplateBody = templateBody;
    if (templateUrl) params.TemplateURL = templateUrl;
    params.Parameters = Object.entries(parameters).map(([k,v]) => ({ ParameterKey: k, ParameterValue: v }));
    if (dryRun) {
      const creds = req.session.awsCreds;
      const script = `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="${creds.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${creds.secretAccessKey}"
export AWS_DEFAULT_REGION="${creds.region||'us-east-1'}"
echo "[DRY RUN] Validating CloudFormation template..."
aws cloudformation validate-template ${templateUrl ? `--template-url "${templateUrl}"` : `--template-body file:///dev/stdin`} && echo "[OK] Template is valid"
`;
      const jobDir = path.join(WORK_DIR, `cfn-${uuidv4().substring(0,8)}`);
      await fs.mkdir(jobDir, { recursive: true });
      const scriptPath = path.join(jobDir, 'validate.sh');
      await fs.writeFile(scriptPath, script, { mode: 0o755 });
      return streamOutput(res, uuidv4().substring(0,8), 'bash', [scriptPath], jobDir, {});
    }
    // Check if stack exists
    let isUpdate = false;
    try {
      await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
      isUpdate = true;
    } catch(e) { isUpdate = false; }
    if (isUpdate) {
      await cfn.send(new UpdateStackCommand(params));
    } else {
      await cfn.send(new CreateStackCommand(params));
    }
    res.json({ success: true, message: `Stack ${stackName} ${isUpdate ? 'update' : 'create'} initiated`, stackName });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/cfn/delete', async (req, res) => {
  const { stackName } = req.body;
  if (!stackName) return res.status(400).json({ error: 'stackName required' });
  try {
    const cfn = new CloudFormationClient(getCfg(req));
    await cfn.send(new DeleteStackCommand({ StackName: stackName }));
    res.json({ success: true, message: `Stack ${stackName} deletion initiated` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/cfn/stacks/:name/events', async (req, res) => {
  try {
    const cfn = new CloudFormationClient(getCfg(req));
    const data = await cfn.send(new DescribeStackEventsCommand({ StackName: req.params.name }));
    res.json({ events: (data.StackEvents||[]).slice(0,50).map(e => ({ time: e.Timestamp, resource: e.LogicalResourceId, type: e.ResourceType, status: e.ResourceStatus, reason: e.ResourceStatusReason })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 2. CODEBUILD =====
const { CodeBuildClient, ListProjectsCommand, StartBuildCommand, BatchGetBuildsCommand, StopBuildCommand, ListBuildsForProjectCommand } = require('@aws-sdk/client-codebuild');

router.get('/codebuild/projects', async (req, res) => {
  try {
    const cb = new CodeBuildClient(getCfg(req));
    const data = await cb.send(new ListProjectsCommand({ sortBy: 'LAST_MODIFIED_TIME', sortOrder: 'DESCENDING' }));
    res.json({ projects: data.projects || [] });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/codebuild/build', async (req, res) => {
  const { projectName, sourceVersion, envVars = {} } = req.body;
  if (!projectName) return res.status(400).json({ error: 'projectName required' });
  try {
    const cb = new CodeBuildClient(getCfg(req));
    const input = { projectName };
    if (sourceVersion) input.sourceVersion = sourceVersion;
    if (Object.keys(envVars).length) {
      input.environmentVariablesOverride = Object.entries(envVars).map(([n,v]) => ({ name: n, value: v, type: 'PLAINTEXT' }));
    }
    const data = await cb.send(new StartBuildCommand(input));
    res.json({ success: true, buildId: data.build.id, buildArn: data.build.arn, status: data.build.buildStatus, projectName });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/codebuild/builds/:id', async (req, res) => {
  try {
    const cb = new CodeBuildClient(getCfg(req));
    const data = await cb.send(new BatchGetBuildsCommand({ ids: [decodeURIComponent(req.params.id)] }));
    const b = data.builds?.[0];
    if (!b) return res.status(404).json({ error: 'Build not found' });
    res.json({ build: { id: b.id, status: b.buildStatus, startTime: b.startTime, endTime: b.endTime, duration: b.buildComplete ? Math.round((new Date(b.endTime)-new Date(b.startTime))/1000) + 's' : 'running', logs: b.logs?.deepLink, phases: (b.phases||[]).map(p => ({ name: p.phaseType, status: p.phaseStatus, duration: p.durationInSeconds })) } });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/codebuild/projects/:name/builds', async (req, res) => {
  try {
    const cb = new CodeBuildClient(getCfg(req));
    const list = await cb.send(new ListBuildsForProjectCommand({ projectName: req.params.name, sortOrder: 'DESCENDING' }));
    const ids = (list.ids||[]).slice(0,10);
    if (!ids.length) return res.json({ builds: [] });
    const data = await cb.send(new BatchGetBuildsCommand({ ids }));
    res.json({ builds: (data.builds||[]).map(b => ({ id: b.id, status: b.buildStatus, startTime: b.startTime, endTime: b.endTime })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 3. CODEPIPELINE =====
const { CodePipelineClient, ListPipelinesCommand, GetPipelineStateCommand, StartPipelineExecutionCommand, StopPipelineExecutionCommand, ListPipelineExecutionsCommand } = require('@aws-sdk/client-codepipeline');

router.get('/pipeline/list', async (req, res) => {
  try {
    const cp = new CodePipelineClient(getCfg(req));
    const data = await cp.send(new ListPipelinesCommand({}));
    res.json({ pipelines: (data.pipelines||[]).map(p => ({ name: p.name, created: p.created, updated: p.updated })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/pipeline/:name/state', async (req, res) => {
  try {
    const cp = new CodePipelineClient(getCfg(req));
    const data = await cp.send(new GetPipelineStateCommand({ name: req.params.name }));
    res.json({ name: data.pipelineName, stages: (data.stageStates||[]).map(s => ({ name: s.stageName, status: s.latestExecution?.status, lastRun: s.latestExecution?.lastStatusChange })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/pipeline/start', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'pipeline name required' });
  try {
    const cp = new CodePipelineClient(getCfg(req));
    const data = await cp.send(new StartPipelineExecutionCommand({ name }));
    res.json({ success: true, pipelineExecutionId: data.pipelineExecutionId, name });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/pipeline/stop', async (req, res) => {
  const { name, executionId, reason = 'Stopped by DevOps Portal' } = req.body;
  if (!name || !executionId) return res.status(400).json({ error: 'name and executionId required' });
  try {
    const cp = new CodePipelineClient(getCfg(req));
    await cp.send(new StopPipelineExecutionCommand({ pipelineName: name, pipelineExecutionId: executionId, reason }));
    res.json({ success: true, message: `Pipeline ${name} execution stopped` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 4. ELASTICACHE =====
const { ElastiCacheClient, DescribeCacheClustersCommand, DescribeReplicationGroupsCommand, CreateCacheClusterCommand, DeleteCacheClusterCommand, DescribeCacheSubnetGroupsCommand } = require('@aws-sdk/client-elasticache');

router.get('/cache/clusters', async (req, res) => {
  try {
    const ec = new ElastiCacheClient(getCfg(req));
    const [clusters, rgs] = await Promise.all([
      ec.send(new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true })).then(d => d.CacheClusters||[]).catch(() => []),
      ec.send(new DescribeReplicationGroupsCommand({})).then(d => d.ReplicationGroups||[]).catch(() => [])
    ]);
    res.json({
      clusters: clusters.map(c => ({ id: c.CacheClusterId, engine: c.Engine, engineVersion: c.EngineVersion, status: c.CacheClusterStatus, nodeType: c.CacheNodeType, numNodes: c.NumCacheNodes })),
      replicationGroups: rgs.map(r => ({ id: r.ReplicationGroupId, description: r.Description, status: r.Status, nodeType: r.CacheNodeType, numNodes: r.MemberClusters?.length }))
    });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/cache/create', async (req, res) => {
  const { clusterId, engine = 'redis', nodeType = 'cache.t3.micro', numNodes = 1, subnetGroupName, securityGroupIds = [] } = req.body;
  if (!clusterId) return res.status(400).json({ error: 'clusterId required' });
  try {
    const ec = new ElastiCacheClient(getCfg(req));
    const input = { CacheClusterId: clusterId, Engine: engine, CacheNodeType: nodeType, NumCacheNodes: numNodes };
    if (subnetGroupName) input.CacheSubnetGroupName = subnetGroupName;
    if (securityGroupIds.length) input.SecurityGroupIds = securityGroupIds;
    await ec.send(new CreateCacheClusterCommand(input));
    res.json({ success: true, message: `ElastiCache ${engine} cluster ${clusterId} creation initiated` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/cache/delete', async (req, res) => {
  const { clusterId } = req.body;
  if (!clusterId) return res.status(400).json({ error: 'clusterId required' });
  try {
    const ec = new ElastiCacheClient(getCfg(req));
    await ec.send(new DeleteCacheClusterCommand({ CacheClusterId: clusterId }));
    res.json({ success: true, message: `ElastiCache cluster ${clusterId} deletion initiated` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 5. DYNAMODB =====
const { DynamoDBClient, ListTablesCommand, DescribeTableCommand, CreateTableCommand, DeleteTableCommand, ScanCommand, PutItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');

router.get('/dynamo/tables', async (req, res) => {
  try {
    const ddb = new DynamoDBClient(getCfg(req));
    const data = await ddb.send(new ListTablesCommand({ Limit: 100 }));
    res.json({ tables: data.TableNames || [] });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/dynamo/tables/:name', async (req, res) => {
  try {
    const ddb = new DynamoDBClient(getCfg(req));
    const data = await ddb.send(new DescribeTableCommand({ TableName: req.params.name }));
    const t = data.Table;
    res.json({ table: { name: t.TableName, status: t.TableStatus, itemCount: t.ItemCount, sizeBytes: t.TableSizeBytes, keys: t.KeySchema, billing: t.BillingModeSummary?.BillingMode } });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/dynamo/tables', async (req, res) => {
  const { tableName, partitionKey, partitionKeyType = 'S', sortKey, sortKeyType = 'S', billingMode = 'PAY_PER_REQUEST' } = req.body;
  if (!tableName || !partitionKey) return res.status(400).json({ error: 'tableName and partitionKey required' });
  try {
    const ddb = new DynamoDBClient(getCfg(req));
    const keySchema = [{ AttributeName: partitionKey, KeyType: 'HASH' }];
    const attrDefs = [{ AttributeName: partitionKey, AttributeType: partitionKeyType }];
    if (sortKey) { keySchema.push({ AttributeName: sortKey, KeyType: 'RANGE' }); attrDefs.push({ AttributeName: sortKey, AttributeType: sortKeyType }); }
    const data = await ddb.send(new CreateTableCommand({ TableName: tableName, KeySchema: keySchema, AttributeDefinitions: attrDefs, BillingMode: billingMode }));
    res.json({ success: true, tableName: data.TableDescription.TableName, status: data.TableDescription.TableStatus });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/dynamo/scan', async (req, res) => {
  const { tableName, limit = 25 } = req.body;
  if (!tableName) return res.status(400).json({ error: 'tableName required' });
  try {
    const ddb = new DynamoDBClient(getCfg(req));
    const data = await ddb.send(new ScanCommand({ TableName: tableName, Limit: limit }));
    res.json({ items: data.Items || [], count: data.Count, scannedCount: data.ScannedCount });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.delete('/dynamo/tables/:name', async (req, res) => {
  try {
    const ddb = new DynamoDBClient(getCfg(req));
    await ddb.send(new DeleteTableCommand({ TableName: req.params.name }));
    res.json({ success: true, message: `Table ${req.params.name} deleted` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 6. SQS =====
const { SQSClient, ListQueuesCommand, CreateQueueCommand, DeleteQueueCommand, SendMessageCommand, ReceiveMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');

router.get('/sqs/queues', async (req, res) => {
  try {
    const sqs = new SQSClient(getCfg(req));
    const data = await sqs.send(new ListQueuesCommand({ MaxResults: 100 }));
    const urls = data.QueueUrls || [];
    res.json({ queues: urls.map(url => ({ url, name: url.split('/').pop() })), count: urls.length });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/sqs/queues', async (req, res) => {
  const { queueName, fifo = false, visibilityTimeout = 30, messageRetention = 345600 } = req.body;
  if (!queueName) return res.status(400).json({ error: 'queueName required' });
  const name = fifo && !queueName.endsWith('.fifo') ? queueName + '.fifo' : queueName;
  try {
    const sqs = new SQSClient(getCfg(req));
    const attrs = { VisibilityTimeout: String(visibilityTimeout), MessageRetentionPeriod: String(messageRetention) };
    if (fifo) { attrs.FifoQueue = 'true'; attrs.ContentBasedDeduplication = 'true'; }
    const data = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attrs }));
    res.json({ success: true, queueUrl: data.QueueUrl, queueName: name });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/sqs/send', async (req, res) => {
  const { queueUrl, message, messageGroupId } = req.body;
  if (!queueUrl || !message) return res.status(400).json({ error: 'queueUrl and message required' });
  try {
    const sqs = new SQSClient(getCfg(req));
    const input = { QueueUrl: queueUrl, MessageBody: typeof message === 'string' ? message : JSON.stringify(message) };
    if (messageGroupId) { input.MessageGroupId = messageGroupId; input.MessageDeduplicationId = uuidv4(); }
    const data = await sqs.send(new SendMessageCommand(input));
    res.json({ success: true, messageId: data.MessageId });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/sqs/receive', async (req, res) => {
  const { queueUrl, maxMessages = 10, waitTime = 0 } = req.body;
  if (!queueUrl) return res.status(400).json({ error: 'queueUrl required' });
  try {
    const sqs = new SQSClient(getCfg(req));
    const data = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: maxMessages, WaitTimeSeconds: waitTime, AttributeNames: ['All'] }));
    res.json({ messages: (data.Messages||[]).map(m => ({ id: m.MessageId, body: m.Body, receipt: m.ReceiptHandle, attributes: m.Attributes })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/sqs/purge', async (req, res) => {
  const { queueUrl } = req.body;
  if (!queueUrl) return res.status(400).json({ error: 'queueUrl required' });
  try {
    const sqs = new SQSClient(getCfg(req));
    await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    res.json({ success: true, message: 'Queue purged' });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 7. CLOUDFRONT =====
const { CloudFrontClient, ListDistributionsCommand, CreateInvalidationCommand, GetDistributionCommand, ListInvalidationsCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');

router.get('/cdn/distributions', async (req, res) => {
  try {
    const cf = new CloudFrontClient(getCfg(req));
    const data = await cf.send(new ListDistributionsCommand({}));
    const items = data.DistributionList?.Items || [];
    res.json({ distributions: items.map(d => ({ id: d.Id, domainName: d.DomainName, status: d.Status, enabled: d.Enabled, origins: (d.Origins?.Items||[]).map(o => o.DomainName), aliases: d.Aliases?.Items||[] })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/cdn/invalidate', async (req, res) => {
  const { distributionId, paths = ['/*'] } = req.body;
  if (!distributionId) return res.status(400).json({ error: 'distributionId required' });
  try {
    const cf = new CloudFrontClient(getCfg(req));
    const data = await cf.send(new CreateInvalidationCommand({ DistributionId: distributionId, InvalidationBatch: { CallerReference: uuidv4(), Paths: { Quantity: paths.length, Items: paths } } }));
    res.json({ success: true, invalidationId: data.Invalidation?.Id, status: data.Invalidation?.Status });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/cdn/distributions/:id', async (req, res) => {
  try {
    const cf = new CloudFrontClient(getCfg(req));
    const data = await cf.send(new GetDistributionCommand({ Id: req.params.id }));
    const d = data.Distribution;
    res.json({ id: d.Id, domainName: d.DomainName, status: d.Status, config: { enabled: d.DistributionConfig?.Enabled, priceClass: d.DistributionConfig?.PriceClass, origins: d.DistributionConfig?.Origins?.Items?.map(o => ({ id: o.Id, domain: o.DomainName })) } });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/cdn/distributions/:id/invalidations', async (req, res) => {
  try {
    const cf = new CloudFrontClient(getCfg(req));
    const data = await cf.send(new ListInvalidationsCommand({ DistributionId: req.params.id }));
    res.json({ invalidations: (data.InvalidationList?.Items||[]).map(i => ({ id: i.Id, status: i.Status, createTime: i.CreateTime })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 8. ELASTIC BEANSTALK =====
const { ElasticBeanstalkClient, DescribeApplicationsCommand, DescribeEnvironmentsCommand, DescribeEventsCommand, RestartAppServerCommand, TerminateEnvironmentCommand, UpdateEnvironmentCommand } = require('@aws-sdk/client-elastic-beanstalk');

router.get('/beanstalk/apps', async (req, res) => {
  try {
    const eb = new ElasticBeanstalkClient(getCfg(req));
    const [apps, envs] = await Promise.all([
      eb.send(new DescribeApplicationsCommand({})).then(d => d.Applications||[]),
      eb.send(new DescribeEnvironmentsCommand({ IncludeDeleted: false })).then(d => d.Environments||[])
    ]);
    res.json({
      applications: apps.map(a => ({ name: a.ApplicationName, description: a.Description, created: a.DateCreated })),
      environments: envs.map(e => ({ id: e.EnvironmentId, name: e.EnvironmentName, app: e.ApplicationName, status: e.Status, health: e.Health, url: e.CNAME, updated: e.DateUpdated }))
    });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/beanstalk/restart', async (req, res) => {
  const { environmentName } = req.body;
  if (!environmentName) return res.status(400).json({ error: 'environmentName required' });
  try {
    const eb = new ElasticBeanstalkClient(getCfg(req));
    await eb.send(new RestartAppServerCommand({ EnvironmentName: environmentName }));
    res.json({ success: true, message: `App server restart initiated for ${environmentName}` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/beanstalk/events', async (req, res) => {
  try {
    const eb = new ElasticBeanstalkClient(getCfg(req));
    const { environmentName, appName } = req.query;
    const input = { MaxRecords: 50 };
    if (environmentName) input.EnvironmentName = environmentName;
    if (appName) input.ApplicationName = appName;
    const data = await eb.send(new DescribeEventsCommand(input));
    res.json({ events: (data.Events||[]).map(e => ({ time: e.EventDate, severity: e.Severity, message: e.Message, environment: e.EnvironmentName })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 9. SSM PARAMETER STORE =====
const { SSMClient, GetParametersByPathCommand, GetParameterCommand, PutParameterCommand, DeleteParameterCommand, SendCommandCommand, ListCommandsCommand, GetCommandInvocationCommand } = require('@aws-sdk/client-ssm');

router.get('/ssm/parameters', async (req, res) => {
  try {
    const ssm = new SSMClient(getCfg(req));
    const { path: paramPath = '/', recursive = true } = req.query;
    const data = await ssm.send(new GetParametersByPathCommand({ Path: paramPath, Recursive: recursive === 'true', WithDecryption: false, MaxResults: 50 }));
    res.json({ parameters: (data.Parameters||[]).map(p => ({ name: p.Name, type: p.Type, description: p.Description, lastModified: p.LastModifiedDate, version: p.Version })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/ssm/parameters/:name(*)', async (req, res) => {
  try {
    const ssm = new SSMClient(getCfg(req));
    const data = await ssm.send(new GetParameterCommand({ Name: decodeURIComponent(req.params.name), WithDecryption: true }));
    res.json({ parameter: { name: data.Parameter.Name, value: data.Parameter.Value, type: data.Parameter.Type, version: data.Parameter.Version } });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/ssm/parameters', async (req, res) => {
  const { name, value, type = 'String', description, overwrite = true } = req.body;
  if (!name || !value) return res.status(400).json({ error: 'name and value required' });
  try {
    const ssm = new SSMClient(getCfg(req));
    const data = await ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: type, Description: description, Overwrite: overwrite }));
    res.json({ success: true, version: data.Version, tier: data.Tier });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.delete('/ssm/parameters/:name(*)', async (req, res) => {
  try {
    const ssm = new SSMClient(getCfg(req));
    await ssm.send(new DeleteParameterCommand({ Name: decodeURIComponent(req.params.name) }));
    res.json({ success: true, message: `Parameter ${req.params.name} deleted` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/ssm/run-command', async (req, res) => {
  const { instanceIds, commands, documentName = 'AWS-RunShellScript', comment = 'DevOps Portal command' } = req.body;
  if (!instanceIds?.length || !commands?.length) return res.status(400).json({ error: 'instanceIds and commands required' });
  try {
    const ssm = new SSMClient(getCfg(req));
    const data = await ssm.send(new SendCommandCommand({ InstanceIds: instanceIds, DocumentName: documentName, Parameters: { commands }, Comment: comment, TimeoutSeconds: 600 }));
    res.json({ success: true, commandId: data.Command.CommandId, status: data.Command.Status });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/ssm/commands/:id', async (req, res) => {
  try {
    const ssm = new SSMClient(getCfg(req));
    const data = await ssm.send(new ListCommandsCommand({ CommandId: req.params.id }));
    res.json({ command: data.Commands?.[0] });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 10. CLOUDWATCH ALARMS =====
const { CloudWatchClient, DescribeAlarmsCommand, PutMetricAlarmCommand, DeleteAlarmsCommand, DescribeAlarmHistoryCommand, EnableAlarmActionsCommand, DisableAlarmActionsCommand, SetAlarmStateCommand } = require('@aws-sdk/client-cloudwatch');

router.get('/alarms/list', async (req, res) => {
  try {
    const cw = new CloudWatchClient(getCfg(req));
    const data = await cw.send(new DescribeAlarmsCommand({ MaxRecords: 100 }));
    res.json({ alarms: (data.MetricAlarms||[]).map(a => ({ name: a.AlarmName, description: a.AlarmDescription, state: a.StateValue, metric: a.MetricName, namespace: a.Namespace, threshold: a.Threshold, comparison: a.ComparisonOperator, updatedAt: a.StateUpdatedTimestamp })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/alarms/create', async (req, res) => {
  const { alarmName, metricName, namespace = 'AWS/EC2', dimensions = {}, threshold, comparisonOperator = 'GreaterThanThreshold', evaluationPeriods = 2, period = 300, statistic = 'Average', alarmActions = [], description } = req.body;
  if (!alarmName || !metricName || threshold === undefined) return res.status(400).json({ error: 'alarmName, metricName, threshold required' });
  try {
    const cw = new CloudWatchClient(getCfg(req));
    await cw.send(new PutMetricAlarmCommand({ AlarmName: alarmName, AlarmDescription: description || `${metricName} alarm`, MetricName: metricName, Namespace: namespace, Dimensions: Object.entries(dimensions).map(([Name,Value]) => ({ Name, Value })), Threshold: parseFloat(threshold), ComparisonOperator: comparisonOperator, EvaluationPeriods: evaluationPeriods, Period: period, Statistic: statistic, AlarmActions: alarmActions, TreatMissingData: 'notBreaching' }));
    res.json({ success: true, message: `Alarm ${alarmName} created` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/alarms/delete', async (req, res) => {
  const { alarmNames } = req.body;
  if (!alarmNames?.length) return res.status(400).json({ error: 'alarmNames array required' });
  try {
    const cw = new CloudWatchClient(getCfg(req));
    await cw.send(new DeleteAlarmsCommand({ AlarmNames: alarmNames }));
    res.json({ success: true, message: `${alarmNames.length} alarm(s) deleted` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/alarms/:name/history', async (req, res) => {
  try {
    const cw = new CloudWatchClient(getCfg(req));
    const data = await cw.send(new DescribeAlarmHistoryCommand({ AlarmName: req.params.name, MaxRecords: 50 }));
    res.json({ history: (data.AlarmHistoryItems||[]).map(h => ({ time: h.Timestamp, type: h.HistoryItemType, summary: h.HistorySummary })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
