#!/usr/bin/env node
const { ServiceQuotasClient, ListServiceQuotasCommand } = require('@aws-sdk/client-service-quotas');
const { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } = require('@aws-sdk/client-bedrock');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const sqClient = new ServiceQuotasClient({});
const bedrockClient = new BedrockClient({});

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

async function main() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    console.log('Fetching Bedrock data...');
    const [quotas, foundationModels, inferenceProfiles] = await Promise.all([
        fetchQuotas(),
        fetchFoundationModels(),
        fetchInferenceProfiles()
    ]);

    fs.writeFileSync(path.join(DATA_DIR, 'quotas.json'), JSON.stringify({ Quotas: quotas }, null, 4));
    fs.writeFileSync(path.join(DATA_DIR, 'foundation-models.json'), JSON.stringify({ models: foundationModels }, null, 4));
    fs.writeFileSync(path.join(DATA_DIR, 'inference-profiles.json'), JSON.stringify({ profiles: inferenceProfiles }, null, 4));

    console.log(`Quotas: ${quotas.length}`);
    console.log(`Foundation models: ${foundationModels.length}`);
    console.log(`Inference profiles: ${inferenceProfiles.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
