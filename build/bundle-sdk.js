#!/usr/bin/env node
const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
    stdin: {
        contents: `
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { ServiceQuotasClient, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas';

window.AWSClients = {
    CloudWatchClient,
    GetMetricDataCommand,
    ServiceQuotasClient,
    GetServiceQuotaCommand
};
`,
        resolveDir: path.join(__dirname, '..'),
        loader: 'js'
    },
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(__dirname, '..', 'site', 'aws-sdk.js'),
    logLevel: 'info'
}).then(() => {
    console.log('Bundled site/aws-sdk.js');
}).catch(e => { console.error(e); process.exit(1); });
