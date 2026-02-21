'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

function getCfg(req) {
  if (!req.session.awsCreds) throw new Error('AWS credentials not configured. POST /api/credentials first.');
  const { accessKeyId, secretAccessKey, region, sessionToken } = req.session.awsCreds;
  const credentials = { accessKeyId, secretAccessKey };
  if (sessionToken) credentials.sessionToken = sessionToken;
  return { region: region || 'us-east-1', credentials };
}

// ===== 11. ECS / FARGATE =====
const { ECSClient, ListClustersCommand, ListServicesCommand, ListTasksCommand, DescribeTasksCommand, DescribeServicesCommand, RegisterTaskDefinitionCommand, RunTaskCommand, UpdateServiceCommand, ListTaskDefinitionsCommand } = require('@aws-sdk/client-ecs');

router.get('/ecs/clusters', async (req, res) => {
  try {
    const ecs = new ECSClient(getCfg(req));
    const data = await ecs.send(new ListClustersCommand({}));
    res.json({ clusters: (data.clusterArns||[]).map(arn => ({ arn, name: arn.split('/').pop() })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/ecs/clusters/:cluster/services', async (req, res) => {
  try {
    const ecs = new ECSClient(getCfg(req));
    const list = await ecs.send(new ListServicesCommand({ cluster: req.params.cluster, maxResults: 100 }));
    if (!list.serviceArns?.length) return res.json({ services: [] });
    const data = await ecs.send(new DescribeServicesCommand({ cluster: req.params.cluster, services: list.serviceArns.slice(0,10) }));
    res.json({ services: (data.services||[]).map(s => ({ name: s.serviceName, status: s.status, desired: s.desiredCount, running: s.runningCount, pending: s.pendingCount, taskDef: s.taskDefinition?.split('/').pop() })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/ecs/clusters/:cluster/tasks', async (req, res) => {
  try {
    const ecs = new ECSClient(getCfg(req));
    const list = await ecs.send(new ListTasksCommand({ cluster: req.params.cluster, maxResults: 100 }));
    if (!list.taskArns?.length) return res.json({ tasks: [] });
    const data = await ecs.send(new DescribeTasksCommand({ cluster: req.params.cluster, tasks: list.taskArns.slice(0,10) }));
    res.json({ tasks: (data.tasks||[]).map(t => ({ arn: t.taskArn, status: t.lastStatus, desired: t.desiredStatus, cpu: t.cpu, memory: t.memory, launchType: t.launchType, startedAt: t.startedAt })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/ecs/task-def', async (req, res) => {
  const { family, image, cpu = '256', memory = '512', containerPort = 80, envVars = {}, executionRoleArn } = req.body;
  if (!family || !image) return res.status(400).json({ error: 'family and image required' });
  try {
    const ecs = new ECSClient(getCfg(req));
    const environment = Object.entries(envVars).map(([name,value]) => ({ name, value }));
    const data = await ecs.send(new RegisterTaskDefinitionCommand({
      family,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: String(cpu),
      memory: String(memory),
      executionRoleArn,
      containerDefinitions: [{
        name: family,
        image,
        portMappings: [{ containerPort: parseInt(containerPort), protocol: 'tcp' }],
        environment,
        logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': `/ecs/${family}`, 'awslogs-region': getCfg(req).region, 'awslogs-stream-prefix': 'ecs' } }
      }]
    }));
    res.json({ success: true, taskDefinition: data.taskDefinition?.taskDefinitionArn, revision: data.taskDefinition?.revision });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/ecs/run-task', async (req, res) => {
  const { cluster, taskDefinition, subnets = [], securityGroups = [], assignPublicIp = 'ENABLED', count = 1 } = req.body;
  if (!cluster || !taskDefinition) return res.status(400).json({ error: 'cluster and taskDefinition required' });
  try {
    const ecs = new ECSClient(getCfg(req));
    const data = await ecs.send(new RunTaskCommand({ cluster, taskDefinition, count, launchType: 'FARGATE', networkConfiguration: { awsvpcConfiguration: { subnets, securityGroups, assignPublicIp } } }));
    res.json({ success: true, tasks: (data.tasks||[]).map(t => ({ arn: t.taskArn, status: t.lastStatus })), failures: data.failures });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/ecs/scale', async (req, res) => {
  const { cluster, service, desiredCount } = req.body;
  if (!cluster || !service || desiredCount === undefined) return res.status(400).json({ error: 'cluster, service, desiredCount required' });
  try {
    const ecs = new ECSClient(getCfg(req));
    await ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount: parseInt(desiredCount) }));
    res.json({ success: true, message: `Service ${service} scaled to ${desiredCount}` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 12. STEP FUNCTIONS =====
const { SFNClient, ListStateMachinesCommand, StartExecutionCommand, ListExecutionsCommand, DescribeExecutionCommand, StopExecutionCommand, GetExecutionHistoryCommand } = require('@aws-sdk/client-sfn');

router.get('/stepfn/machines', async (req, res) => {
  try {
    const sfn = new SFNClient(getCfg(req));
    const data = await sfn.send(new ListStateMachinesCommand({ maxResults: 100 }));
    res.json({ stateMachines: (data.stateMachines||[]).map(m => ({ arn: m.stateMachineArn, name: m.name, type: m.type, created: m.creationDate })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/stepfn/execute', async (req, res) => {
  const { stateMachineArn, input = {}, name } = req.body;
  if (!stateMachineArn) return res.status(400).json({ error: 'stateMachineArn required' });
  try {
    const sfn = new SFNClient(getCfg(req));
    const data = await sfn.send(new StartExecutionCommand({ stateMachineArn, input: JSON.stringify(input), name: name || `exec-${Date.now()}` }));
    res.json({ success: true, executionArn: data.executionArn, startDate: data.startDate });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/stepfn/executions', async (req, res) => {
  const { stateMachineArn, statusFilter } = req.query;
  if (!stateMachineArn) return res.status(400).json({ error: 'stateMachineArn query param required' });
  try {
    const sfn = new SFNClient(getCfg(req));
    const input = { stateMachineArn, maxResults: 20 };
    if (statusFilter) input.statusFilter = statusFilter;
    const data = await sfn.send(new ListExecutionsCommand(input));
    res.json({ executions: (data.executions||[]).map(e => ({ arn: e.executionArn, name: e.name, status: e.status, startDate: e.startDate, stopDate: e.stopDate })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/stepfn/executions/:arn(*)', async (req, res) => {
  try {
    const sfn = new SFNClient(getCfg(req));
    const data = await sfn.send(new DescribeExecutionCommand({ executionArn: decodeURIComponent(req.params.arn) }));
    res.json({ execution: { arn: data.executionArn, name: data.name, status: data.status, input: data.input, output: data.output, startDate: data.startDate, stopDate: data.stopDate } });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 13. EVENTBRIDGE =====
const { EventBridgeClient, ListEventBusesCommand, ListRulesCommand, PutRuleCommand, PutTargetsCommand, PutEventsCommand, DeleteRuleCommand, RemoveTargetsCommand } = require('@aws-sdk/client-eventbridge');

router.get('/events/buses', async (req, res) => {
  try {
    const eb = new EventBridgeClient(getCfg(req));
    const data = await eb.send(new ListEventBusesCommand({ Limit: 50 }));
    res.json({ buses: (data.EventBuses||[]).map(b => ({ name: b.Name, arn: b.Arn })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/events/rules', async (req, res) => {
  try {
    const eb = new EventBridgeClient(getCfg(req));
    const data = await eb.send(new ListRulesCommand({ EventBusName: req.query.busName || 'default', Limit: 50 }));
    res.json({ rules: (data.Rules||[]).map(r => ({ name: r.Name, arn: r.Arn, state: r.State, schedule: r.ScheduleExpression, eventPattern: r.EventPattern })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/events/rules', async (req, res) => {
  const { ruleName, schedule, eventPattern, targetArn, targetId, busName = 'default', state = 'ENABLED' } = req.body;
  if (!ruleName || !targetArn) return res.status(400).json({ error: 'ruleName and targetArn required' });
  if (!schedule && !eventPattern) return res.status(400).json({ error: 'schedule or eventPattern required' });
  try {
    const eb = new EventBridgeClient(getCfg(req));
    const ruleInput = { Name: ruleName, EventBusName: busName, State: state };
    if (schedule) ruleInput.ScheduleExpression = schedule;
    if (eventPattern) ruleInput.EventPattern = typeof eventPattern === 'string' ? eventPattern : JSON.stringify(eventPattern);
    const ruleData = await eb.send(new PutRuleCommand(ruleInput));
    await eb.send(new PutTargetsCommand({ Rule: ruleName, EventBusName: busName, Targets: [{ Id: targetId || uuidv4().substring(0,8), Arn: targetArn }] }));
    res.json({ success: true, ruleArn: ruleData.RuleArn });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/events/put', async (req, res) => {
  const { source, detailType, detail, busName = 'default' } = req.body;
  if (!source || !detailType || !detail) return res.status(400).json({ error: 'source, detailType, detail required' });
  try {
    const eb = new EventBridgeClient(getCfg(req));
    const data = await eb.send(new PutEventsCommand({ Entries: [{ EventBusName: busName, Source: source, DetailType: detailType, Detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }] }));
    res.json({ success: true, failedCount: data.FailedEntryCount, entries: data.Entries });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 14. KINESIS =====
const { KinesisClient, ListStreamsCommand, CreateStreamCommand, DeleteStreamCommand, PutRecordCommand, GetShardIteratorCommand, GetRecordsCommand, DescribeStreamCommand } = require('@aws-sdk/client-kinesis');

router.get('/kinesis/streams', async (req, res) => {
  try {
    const kn = new KinesisClient(getCfg(req));
    const data = await kn.send(new ListStreamsCommand({ Limit: 100 }));
    res.json({ streams: data.StreamNames || [], hasMore: data.HasMoreStreams });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/kinesis/streams', async (req, res) => {
  const { streamName, shardCount = 1 } = req.body;
  if (!streamName) return res.status(400).json({ error: 'streamName required' });
  try {
    const kn = new KinesisClient(getCfg(req));
    await kn.send(new CreateStreamCommand({ StreamName: streamName, ShardCount: shardCount }));
    res.json({ success: true, message: `Kinesis stream ${streamName} creation initiated with ${shardCount} shard(s)` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/kinesis/put', async (req, res) => {
  const { streamName, data: record, partitionKey } = req.body;
  if (!streamName || !record) return res.status(400).json({ error: 'streamName and data required' });
  try {
    const kn = new KinesisClient(getCfg(req));
    const result = await kn.send(new PutRecordCommand({ StreamName: streamName, Data: Buffer.from(typeof record === 'string' ? record : JSON.stringify(record)), PartitionKey: partitionKey || uuidv4() }));
    res.json({ success: true, shardId: result.ShardId, sequenceNumber: result.SequenceNumber });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/kinesis/streams/:name', async (req, res) => {
  try {
    const kn = new KinesisClient(getCfg(req));
    const data = await kn.send(new DescribeStreamCommand({ StreamName: req.params.name }));
    const s = data.StreamDescription;
    res.json({ name: s.StreamName, arn: s.StreamARN, status: s.StreamStatus, shards: s.Shards?.length, retentionHours: s.RetentionPeriodHours });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 15. WAF v2 =====
const { WAFV2Client, ListWebACLsCommand, ListIPSetsCommand, CreateIPSetCommand, GetWebACLCommand, AssociateWebACLCommand } = require('@aws-sdk/client-wafv2');

router.get('/waf/acls', async (req, res) => {
  try {
    const cfg = getCfg(req);
    const waf = new WAFV2Client(cfg);
    const scope = req.query.scope || 'REGIONAL';
    const data = await waf.send(new ListWebACLsCommand({ Scope: scope, Limit: 100 }));
    res.json({ webAcls: (data.WebACLs||[]).map(a => ({ id: a.Id, name: a.Name, arn: a.ARN, description: a.Description })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/waf/ip-sets', async (req, res) => {
  try {
    const waf = new WAFV2Client(getCfg(req));
    const scope = req.query.scope || 'REGIONAL';
    const data = await waf.send(new ListIPSetsCommand({ Scope: scope, Limit: 100 }));
    res.json({ ipSets: (data.IPSets||[]).map(s => ({ id: s.Id, name: s.Name, arn: s.ARN, description: s.Description })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/waf/ip-sets', async (req, res) => {
  const { name, addresses = [], ipVersion = 'IPV4', scope = 'REGIONAL', description } = req.body;
  if (!name || !addresses.length) return res.status(400).json({ error: 'name and addresses required' });
  try {
    const waf = new WAFV2Client(getCfg(req));
    const data = await waf.send(new CreateIPSetCommand({ Name: name, Scope: scope, IPAddressVersion: ipVersion, Addresses: addresses, Description: description || `Created by DevOps Portal` }));
    res.json({ success: true, id: data.Summary?.Id, arn: data.Summary?.ARN, name: data.Summary?.Name });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/waf/associate', async (req, res) => {
  const { webAclArn, resourceArn } = req.body;
  if (!webAclArn || !resourceArn) return res.status(400).json({ error: 'webAclArn and resourceArn required' });
  try {
    const waf = new WAFV2Client(getCfg(req));
    await waf.send(new AssociateWebACLCommand({ WebACLArn: webAclArn, ResourceArn: resourceArn }));
    res.json({ success: true, message: `WAF ACL associated with resource` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 16. AWS BACKUP =====
const { BackupClient, ListBackupPlansCommand, CreateBackupPlanCommand, ListBackupJobsCommand, StartBackupJobCommand, ListRecoveryPointsByBackupVaultCommand, ListBackupVaultsCommand } = require('@aws-sdk/client-backup');

router.get('/backup/plans', async (req, res) => {
  try {
    const bk = new BackupClient(getCfg(req));
    const data = await bk.send(new ListBackupPlansCommand({ MaxResults: 50 }));
    res.json({ plans: (data.BackupPlansList||[]).map(p => ({ id: p.BackupPlanId, name: p.BackupPlanName, arn: p.BackupPlanArn, created: p.CreationDate })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/backup/plans', async (req, res) => {
  const { planName, scheduleExpression = 'cron(0 5 ? * * *)', deleteAfterDays = 30, resourceArn } = req.body;
  if (!planName) return res.status(400).json({ error: 'planName required' });
  try {
    const bk = new BackupClient(getCfg(req));
    const data = await bk.send(new CreateBackupPlanCommand({
      BackupPlan: {
        BackupPlanName: planName,
        Rules: [{ RuleName: `${planName}-rule`, TargetBackupVaultName: 'Default', ScheduleExpression: scheduleExpression, Lifecycle: { DeleteAfterDays: deleteAfterDays } }]
      }
    }));
    res.json({ success: true, planId: data.BackupPlanId, arn: data.BackupPlanArn });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/backup/jobs', async (req, res) => {
  try {
    const bk = new BackupClient(getCfg(req));
    const data = await bk.send(new ListBackupJobsCommand({ MaxResults: 50 }));
    res.json({ jobs: (data.BackupJobs||[]).map(j => ({ id: j.BackupJobId, status: j.State, resource: j.ResourceArn, vault: j.BackupVaultName, created: j.CreationDate, size: j.BackupSizeInBytes })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/backup/start', async (req, res) => {
  const { resourceArn, vaultName = 'Default', iamRoleArn } = req.body;
  if (!resourceArn) return res.status(400).json({ error: 'resourceArn required' });
  try {
    const bk = new BackupClient(getCfg(req));
    const data = await bk.send(new StartBackupJobCommand({ ResourceArn: resourceArn, BackupVaultName: vaultName, IamRoleArn: iamRoleArn || `arn:aws:iam::${(await import('crypto')).randomUUID().split('-')[0]}:role/AWSBackupDefaultServiceRole` }));
    res.json({ success: true, jobId: data.BackupJobId, recoveryPointArn: data.RecoveryPointArn });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/backup/vaults', async (req, res) => {
  try {
    const bk = new BackupClient(getCfg(req));
    const data = await bk.send(new ListBackupVaultsCommand({ MaxResults: 50 }));
    res.json({ vaults: (data.BackupVaultList||[]).map(v => ({ name: v.BackupVaultName, arn: v.BackupVaultArn, created: v.CreationDate, numberOfRecoveryPoints: v.NumberOfRecoveryPoints })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 17. AWS CONFIG =====
const { ConfigServiceClient, DescribeConfigRulesCommand, GetComplianceSummaryByConfigRuleCommand, DescribeComplianceByConfigRuleCommand, GetResourceConfigHistoryCommand, DescribeConfigurationRecordersCommand, StartConfigurationRecorderCommand } = require('@aws-sdk/client-config-service');

router.get('/awsconfig/rules', async (req, res) => {
  try {
    const cfg = new ConfigServiceClient(getCfg(req));
    const data = await cfg.send(new DescribeConfigRulesCommand({ Limit: 50 }));
    res.json({ rules: (data.ConfigRules||[]).map(r => ({ name: r.ConfigRuleName, arn: r.ConfigRuleArn, state: r.ConfigRuleState, source: r.Source?.Owner })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/awsconfig/compliance', async (req, res) => {
  try {
    const cfg = new ConfigServiceClient(getCfg(req));
    const data = await cfg.send(new DescribeComplianceByConfigRuleCommand({ ComplianceTypes: ['NON_COMPLIANT','COMPLIANT'] }));
    const rules = data.ComplianceByConfigRules || [];
    const compliant = rules.filter(r => r.Compliance?.ComplianceType === 'COMPLIANT').length;
    const nonCompliant = rules.filter(r => r.Compliance?.ComplianceType === 'NON_COMPLIANT').length;
    res.json({ summary: { compliant, nonCompliant, total: rules.length }, rules: rules.map(r => ({ name: r.ConfigRuleName, compliance: r.Compliance?.ComplianceType })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/awsconfig/recorders', async (req, res) => {
  try {
    const cfg = new ConfigServiceClient(getCfg(req));
    const data = await cfg.send(new DescribeConfigurationRecordersCommand({}));
    res.json({ recorders: (data.ConfigurationRecorders||[]).map(r => ({ name: r.name, roleArn: r.roleARN, recordAll: r.recordingGroup?.allSupported })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/awsconfig/recorder/start', async (req, res) => {
  const { recorderName = 'default' } = req.body;
  try {
    const cfg = new ConfigServiceClient(getCfg(req));
    await cfg.send(new StartConfigurationRecorderCommand({ ConfigurationRecorderName: recorderName }));
    res.json({ success: true, message: `Config recorder ${recorderName} started` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 18. API GATEWAY =====
const { APIGatewayClient, GetRestApisCommand, GetStagesCommand, CreateDeploymentCommand, GetApiKeysCommand, CreateApiKeyCommand, GetResourcesCommand, GetUsagePlansCommand } = require('@aws-sdk/client-api-gateway');

router.get('/apigw/apis', async (req, res) => {
  try {
    const gw = new APIGatewayClient(getCfg(req));
    const data = await gw.send(new GetRestApisCommand({ limit: 100 }));
    res.json({ apis: (data.items||[]).map(a => ({ id: a.id, name: a.name, description: a.description, created: a.createdDate, endpointType: a.endpointConfiguration?.types?.[0] })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/apigw/apis/:id/stages', async (req, res) => {
  try {
    const gw = new APIGatewayClient(getCfg(req));
    const data = await gw.send(new GetStagesCommand({ restApiId: req.params.id }));
    res.json({ stages: (data.item||[]).map(s => ({ name: s.stageName, description: s.description, invokeUrl: `https://${req.params.id}.execute-api.${getCfg(req).region}.amazonaws.com/${s.stageName}`, deployed: s.lastUpdatedDate, cacheEnabled: s.cacheClusterEnabled })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/apigw/deploy', async (req, res) => {
  const { restApiId, stageName, description } = req.body;
  if (!restApiId || !stageName) return res.status(400).json({ error: 'restApiId and stageName required' });
  try {
    const gw = new APIGatewayClient(getCfg(req));
    const data = await gw.send(new CreateDeploymentCommand({ restApiId, stageName, description: description || `Deployed by DevOps Portal` }));
    const cfg = getCfg(req);
    res.json({ success: true, deploymentId: data.id, invokeUrl: `https://${restApiId}.execute-api.${cfg.region}.amazonaws.com/${stageName}` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/apigw/keys', async (req, res) => {
  try {
    const gw = new APIGatewayClient(getCfg(req));
    const data = await gw.send(new GetApiKeysCommand({ limit: 100, includeValues: false }));
    res.json({ keys: (data.items||[]).map(k => ({ id: k.id, name: k.name, enabled: k.enabled, created: k.createdDate })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/apigw/keys', async (req, res) => {
  const { name, description, enabled = true } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const gw = new APIGatewayClient(getCfg(req));
    const data = await gw.send(new CreateApiKeyCommand({ name, description, enabled, generateDistinctId: true }));
    res.json({ success: true, id: data.id, name: data.name, value: data.value });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 19. OPENSEARCH =====
const { OpenSearchClient, ListDomainNamesCommand, DescribeDomainCommand, CreateDomainCommand, DeleteDomainCommand, DescribeDomainHealthCommand } = require('@aws-sdk/client-opensearch');

router.get('/opensearch/domains', async (req, res) => {
  try {
    const os = new OpenSearchClient(getCfg(req));
    const data = await os.send(new ListDomainNamesCommand({}));
    res.json({ domains: (data.DomainNames||[]).map(d => ({ name: d.DomainName, engineType: d.EngineType })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/opensearch/domains/:name', async (req, res) => {
  try {
    const os = new OpenSearchClient(getCfg(req));
    const data = await os.send(new DescribeDomainCommand({ DomainName: req.params.name }));
    const d = data.DomainStatus;
    res.json({ domain: { name: d.DomainName, arn: d.ARN, endpoint: d.Endpoint, engineVersion: d.EngineVersion, processing: d.Processing, created: d.Created, deleted: d.Deleted, instanceType: d.ClusterConfig?.InstanceType, instanceCount: d.ClusterConfig?.InstanceCount } });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/opensearch/create', async (req, res) => {
  const { domainName, engineVersion = 'OpenSearch_2.11', instanceType = 't3.small.search', instanceCount = 1, ebsVolumeSize = 10 } = req.body;
  if (!domainName) return res.status(400).json({ error: 'domainName required' });
  try {
    const os = new OpenSearchClient(getCfg(req));
    await os.send(new CreateDomainCommand({ DomainName: domainName, EngineVersion: engineVersion, ClusterConfig: { InstanceType: instanceType, InstanceCount: instanceCount }, EBSOptions: { EBSEnabled: true, VolumeType: 'gp3', VolumeSize: ebsVolumeSize }, EncryptionAtRestOptions: { Enabled: true }, NodeToNodeEncryptionOptions: { Enabled: true }, DomainEndpointOptions: { EnforceHTTPS: true } }));
    res.json({ success: true, message: `OpenSearch domain ${domainName} creation initiated (may take 15-30 min)` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/opensearch/delete', async (req, res) => {
  const { domainName } = req.body;
  if (!domainName) return res.status(400).json({ error: 'domainName required' });
  try {
    const os = new OpenSearchClient(getCfg(req));
    await os.send(new DeleteDomainCommand({ DomainName: domainName }));
    res.json({ success: true, message: `OpenSearch domain ${domainName} deletion initiated` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ===== 20. AWS GLUE =====
const { GlueClient, GetDatabasesCommand, GetTablesCommand, ListJobsCommand, GetJobCommand, StartJobRunCommand, GetJobRunCommand, GetJobRunsCommand, ListCrawlersCommand, StartCrawlerCommand, GetCrawlerCommand } = require('@aws-sdk/client-glue');

router.get('/glue/databases', async (req, res) => {
  try {
    const glue = new GlueClient(getCfg(req));
    const data = await glue.send(new GetDatabasesCommand({ MaxResults: 100 }));
    res.json({ databases: (data.DatabaseList||[]).map(d => ({ name: d.Name, description: d.Description, locationUri: d.LocationUri, created: d.CreateTime })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/glue/databases/:name/tables', async (req, res) => {
  try {
    const glue = new GlueClient(getCfg(req));
    const data = await glue.send(new GetTablesCommand({ DatabaseName: req.params.name, MaxResults: 100 }));
    res.json({ tables: (data.TableList||[]).map(t => ({ name: t.Name, type: t.TableType, location: t.StorageDescriptor?.Location, columns: t.StorageDescriptor?.Columns?.length, created: t.CreateTime })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/glue/jobs', async (req, res) => {
  try {
    const glue = new GlueClient(getCfg(req));
    const list = await glue.send(new ListJobsCommand({ MaxResults: 100 }));
    res.json({ jobs: (list.JobNames||[]).map(name => ({ name })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/glue/jobs/run', async (req, res) => {
  const { jobName, arguments: jobArgs = {} } = req.body;
  if (!jobName) return res.status(400).json({ error: 'jobName required' });
  try {
    const glue = new GlueClient(getCfg(req));
    const data = await glue.send(new StartJobRunCommand({ JobName: jobName, Arguments: jobArgs }));
    res.json({ success: true, jobRunId: data.JobRunId, jobName });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/glue/jobs/:name/runs', async (req, res) => {
  try {
    const glue = new GlueClient(getCfg(req));
    const data = await glue.send(new GetJobRunsCommand({ JobName: req.params.name, MaxResults: 20 }));
    res.json({ runs: (data.JobRuns||[]).map(r => ({ id: r.Id, status: r.JobRunState, started: r.StartedOn, completed: r.CompletedOn, duration: r.ExecutionTime, error: r.ErrorMessage })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.get('/glue/crawlers', async (req, res) => {
  try {
    const glue = new GlueClient(getCfg(req));
    const data = await glue.send(new ListCrawlersCommand({ MaxResults: 100 }));
    res.json({ crawlers: (data.CrawlerNames||[]).map(name => ({ name })) });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

router.post('/glue/crawlers/start', async (req, res) => {
  const { crawlerName } = req.body;
  if (!crawlerName) return res.status(400).json({ error: 'crawlerName required' });
  try {
    const glue = new GlueClient(getCfg(req));
    await glue.send(new StartCrawlerCommand({ Name: crawlerName }));
    res.json({ success: true, message: `Crawler ${crawlerName} started` });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
