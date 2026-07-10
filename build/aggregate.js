#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { findQuotaCodeWithLLM, reportResults } = require('./llm-matcher');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const quotas = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'quotas.json'))).Quotas;
const foundationModels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'foundation-models.json'))).models;
const inferenceProfiles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'inference-profiles.json'))).profiles;
const quotaMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'quota-map.json')));

// TPM quotas indexed by quotaCode for validation
const tpmQuotas = quotas.filter(q => q.QuotaName.toLowerCase().includes('tokens per minute'));
const quotaByCode = new Map(tpmQuotas.map(q => [q.QuotaCode, q.QuotaName]));

// All TPM quota codes grouped by type for LLM fallback context
const TYPE_PREFIX = {
    'On-Demand':    ['on-demand model inference tokens per minute for', 'on-demand latency-optimized model inference tokens per minute for', 'on-demand, latency-optimized model inference tokens per minute for'],
    'Cross-Region': ['cross-region model inference tokens per minute for'],
    'Global':       ['global cross-region model inference tokens per minute for'],
};

const tpmByType = {};
for (const [type, prefixes] of Object.entries(TYPE_PREFIX)) {
    tpmByType[type] = tpmQuotas.filter(q => prefixes.some(p => q.QuotaName.toLowerCase().startsWith(p)))
        .map(q => ({ code: q.QuotaCode, name: q.QuotaName.split(' for ').slice(1).join(' for ') }));
}

// ========== Base ID helpers ==========
function toBaseId(id) {
    return id
        .replace(/^(us|eu|ap|global)\./, '')
        .replace(/:(?!0$)[^:]+$/, '');
}

// ========== Static map lookup ==========
// Returns: string (quota code) | null (no quota, skip LLM) | undefined (not in map, try LLM)
function findQuotaCode(baseId, type) {
    if (!(baseId in quotaMap)) return undefined;
    const entry = quotaMap[baseId];
    if (!(type in entry)) return undefined;
    return entry[type]; // may be null (explicitly no quota) or a code string
}

// LLM context passed to llm-matcher.js
const llmCtx = () => ({ tpmByType, quotaByCode, quotaMap });

// ========== Model name parsing ==========
const foundationById = new Map();
for (const m of foundationModels) {
    const baseId = toBaseId(m.modelId);
    foundationById.set(baseId, { name: m.modelName, vendor: m.providerName });
}

const KNOWN_VENDORS = ['Anthropic', 'Amazon', 'Meta', 'Mistral AI', 'Mistral', 'Cohere',
    'Stability AI', 'DeepSeek', 'Writer', 'Twelve Labs', 'AI21', 'NVIDIA'];

function parseProfileName(profileName, profileId) {
    let s = profileName.replace(/^(US|EU|AP|Global|GLOBAL)\s+/i, '').trim();
    for (const v of KNOWN_VENDORS) {
        if (s.startsWith(v)) return { vendor: v, name: s.slice(v.length).trim() };
    }
    return { vendor: vendorFromId(profileId), name: s };
}

function vendorFromId(id) {
    const lower = id.toLowerCase();
    if (lower.includes('anthropic') || lower.includes('claude')) return 'Anthropic';
    if (lower.includes('amazon') || lower.includes('nova') || lower.includes('titan')) return 'Amazon';
    if (lower.includes('meta') || lower.includes('llama')) return 'Meta';
    if (lower.includes('mistral')) return 'Mistral AI';
    if (lower.includes('cohere')) return 'Cohere';
    if (lower.includes('stability')) return 'Stability AI';
    if (lower.includes('deepseek')) return 'DeepSeek';
    if (lower.includes('writer')) return 'Writer';
    if (lower.includes('twelvelabs')) return 'Twelve Labs';
    return 'Other';
}

function inferenceType(profileId) {
    return profileId.startsWith('global.') ? 'Global' : 'Cross-Region';
}

// ========== Build model map ==========
const modelMap = new Map();

function getOrCreate(baseId, name, vendor) {
    if (!modelMap.has(baseId)) modelMap.set(baseId, { name, vendor, ids: [] });
    return modelMap.get(baseId);
}

async function main() {
    // Foundation models → On-Demand
    for (const m of foundationModels) {
        const baseId = toBaseId(m.modelId);
        const fullName = m.providerName + ' ' + m.modelName;
        const entry = getOrCreate(baseId, fullName, m.providerName);
        let quotaCode = findQuotaCode(baseId, 'On-Demand');
        if (quotaCode === undefined) quotaCode = await findQuotaCodeWithLLM(baseId, 'On-Demand', m.modelName, m.providerName, llmCtx());
        entry.ids.push({ id: m.modelId, type: 'On-Demand', quotaCode });
    }

    // Inference profiles → Cross-Region / Global
    for (const p of inferenceProfiles) {
        const baseId = toBaseId(p.inferenceProfileId);
        const type = inferenceType(p.inferenceProfileId);
        let name, vendor, parsedName;
        if (foundationById.has(baseId)) {
            ({ name: parsedName, vendor } = foundationById.get(baseId));
            name = vendor + ' ' + parsedName;
        } else {
            const parsed = parseProfileName(p.inferenceProfileName, p.inferenceProfileId);
            vendor = parsed.vendor; parsedName = parsed.name;
            name = vendor + ' ' + parsedName;
        }
        const entry = getOrCreate(baseId, name, vendor);
        let quotaCode = findQuotaCode(baseId, type);
        if (quotaCode === undefined) quotaCode = await findQuotaCodeWithLLM(baseId, type, parsedName, vendor, llmCtx());
        entry.ids.push({ id: p.inferenceProfileId, type, quotaCode });
    }

    // Sort IDs: On-Demand first, then Cross-Region, then Global
    const TYPE_ORDER = { 'On-Demand': 0, 'Cross-Region': 1, 'Global': 2 };
    for (const entry of modelMap.values()) {
        entry.ids.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
    }

    // Keep only models with at least one TPM quota code
    const models = [...modelMap.values()]
        .map(m => ({ ...m, ids: m.ids.filter(i => i.quotaCode) }))
        .filter(m => m.ids.length > 0)
        .sort((a, b) => {
            if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
            return a.name.localeCompare(b.name);
        });

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const buildVersion = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const siteOutput = [
        '// Auto-generated by build/aggregate.js — do not edit manually',
        `const MODEL_CATALOGUE = ${JSON.stringify(models, null, 2)};`,
        `const BUILD_VERSION = '${buildVersion}';`,
        ''
    ].join('\n');
    fs.writeFileSync(path.join(ROOT_DIR, 'site', 'models.js'), siteOutput);

    const total = models.reduce((n, m) => n + m.ids.length, 0);
    console.log(`Models: ${models.length} (${total} IDs)`);
    console.log(`Quota codes matched: ${total}/${total}`);
    console.log('Generated site/models.js');

    reportResults(path.join(__dirname, 'quota-map.json'), quotaMap, fs);
}

main().catch(e => { console.error(e); process.exit(1); });
