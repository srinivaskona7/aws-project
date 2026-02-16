#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';

// ─────────────────────────────────────────────────────────────
// AWS CDK App — Load Balancer Infrastructure
// ─────────────────────────────────────────────────────────────
// Replicates the Terraform load-balancer configuration as CDK.
//
// Usage:
//   npx cdk deploy
//   npx cdk deploy -c domainName=myapp.example.com -c certFolder=myapp
//   npx cdk deploy -c certArn=arn:aws:acm:ap-south-1:123456:certificate/abc
//
// ─────────────────────────────────────────────────────────────

const app = new cdk.App();

// Read configuration from context (cdk.json or -c flags)
const projectName = app.node.tryGetContext('projectName') || 'sri';
const domainName = app.node.tryGetContext('domainName') || 'garden.srinivaskona.life';
const certFolder = app.node.tryGetContext('certFolder') || 'garden';
const keyName = app.node.tryGetContext('keyName') || 'aws';
const awsRegion = app.node.tryGetContext('awsRegion') || 'ap-south-1';

new CdkStack(app, `${projectName}-load-balancer`, {
  // Stack Configuration
  projectName,
  domainName,
  certFolder,
  keyName,

  // Network Configuration
  vpcCidr: '10.0.0.0/16',
  publicSubnetCidrs: ['10.0.1.0/24', '10.0.2.0/24'],
  privateSubnetCidrs: ['10.0.3.0/24', '10.0.4.0/24'],
  availabilityZones: [`${awsRegion}a`, `${awsRegion}b`],
  instanceType: 't2.micro',

  // AWS Environment (region always set, account resolved at deploy time)
  env: {
    region: awsRegion,
  },

  // Stack Tags
  tags: {
    Project: projectName,
    ManagedBy: 'CDK',
  },
});

app.synth();
