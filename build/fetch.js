#!/usr/bin/env node
const { ServiceQuotasClient, ListServiceQuotasCommand } = require('@aws-sdk/client-service-quotas');
const { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } = require('@aws-sdk/client-bedrock');
const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const sqClient = new ServiceQuotasClient({});
const bedrockClient = new BedrockClient({});
const ssmClient = new SSMClient({});

async function fetchQuotas() {
    const quotas = [];
    let nextToken;
    do {
        const resp = await sqClient.send(new ListServiceQuotasCommand({ ServiceCode: 'bedrock', NextToken: nextToken, MaxResults: 100 }));
        quotas.push(...(resp.Quotas || []));
        nextToken = resp.NextToken;
    } while (nextToken);
    return quotas;
}

async function fetchFoundationModels() {
    const resp = await bedrockClient.send(new ListFoundationModelsCommand({}));
    return resp.modelSummaries || [];
}

async function fetchInferenceProfiles() {
    const profiles = [];
    let nextToken;
    do {
        const resp = await bedrockClient.send(new ListInferenceProfilesCommand({ nextToken, maxResults: 100 }));
        profiles.push(...(resp.inferenceProfileSummaries || []));
        nextToken = resp.nextToken;
    } while (nextToken);
    return profiles;
}

// Regions where Bedrock is available, from the public global-infrastructure SSM
// parameters. Commercial partition only — GovCloud and EU Sovereign Cloud use
// different endpoints/consoles.
async function fetchRegions() {
    const regions = [];
    let nextToken;
    do {
        const resp = await ssmClient.send(new GetParametersByPathCommand({
            Path: '/aws/service/global-infrastructure/services/bedrock/regions', NextToken: nextToken
        }));
        regions.push(...(resp.Parameters || []).map(p => p.Value));
        nextToken = resp.NextToken;
    } while (nextToken);
    return regions.filter(r => !/^(us-gov|eusc|cn)-/.test(r)).sort();
}

async function main() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    console.log('Fetching Bedrock data...');
    const [quotas, foundationModels, inferenceProfiles, regions] = await Promise.all([
        fetchQuotas(),
        fetchFoundationModels(),
        fetchInferenceProfiles(),
        fetchRegions()
    ]);

    fs.writeFileSync(path.join(DATA_DIR, 'quotas.json'), JSON.stringify({ Quotas: quotas }, null, 4));
    fs.writeFileSync(path.join(DATA_DIR, 'foundation-models.json'), JSON.stringify({ models: foundationModels }, null, 4));
    fs.writeFileSync(path.join(DATA_DIR, 'inference-profiles.json'), JSON.stringify({ profiles: inferenceProfiles }, null, 4));
    fs.writeFileSync(path.join(DATA_DIR, 'regions.json'), JSON.stringify({ regions }, null, 4));

    console.log(`Quotas: ${quotas.length}`);
    console.log(`Foundation models: ${foundationModels.length}`);
    console.log(`Inference profiles: ${inferenceProfiles.length}`);
    console.log(`Regions: ${regions.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
