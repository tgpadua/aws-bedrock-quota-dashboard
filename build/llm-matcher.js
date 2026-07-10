#!/usr/bin/env node
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockRuntime = new BedrockRuntimeClient({});

const autoWritten = [];
const needsReview = [];

function isConfident(modelName, vendor, quotaName) {
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(t => t.length > 1);
    const modelTokens = normalize(`${vendor} ${modelName}`);
    const quotaTokens = normalize(quotaName);
    return modelTokens.filter(t => quotaTokens.includes(t)).length >= 2;
}

async function findQuotaCodeWithLLM(baseId, type, modelName, vendor, { tpmByType, quotaByCode, quotaMap }) {
    const candidates = tpmByType[type] || [];
    if (!candidates.length) return null;

    const prompt = `You are matching Bedrock model IDs to Service Quota codes.

Model to match:
- Base ID: ${baseId}
- Vendor: ${vendor}
- Name: ${modelName}
- Type: ${type}

Available ${type} TPM quota codes:
${candidates.map(c => `- ${c.code}: ${c.name}`).join('\n')}

Return ONLY a JSON object like {"quotaCode": "L-XXXXXXXX"} for the best match, or {"quotaCode": null} if no match exists. No explanation.`;

    try {
        const resp = await bedrockRuntime.send(new InvokeModelCommand({
            modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 64,
                messages: [{ role: 'user', content: prompt }]
            })
        }));
        const body = JSON.parse(Buffer.from(resp.body).toString());
        let text = body.content?.[0]?.text?.trim() || '{}';
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        const result = JSON.parse(text);
        const code = result.quotaCode || null;

        if (code && quotaByCode.has(code)) {
            const quotaName = quotaByCode.get(code);
            const entry = { baseId, type, code, modelName, vendor, quotaName };
            if (isConfident(modelName, vendor, quotaName)) {
                autoWritten.push(entry);
                if (!quotaMap[baseId]) quotaMap[baseId] = {};
                quotaMap[baseId][type] = code;
            } else {
                needsReview.push(entry);
            }
        } else if (code === null) {
            if (!quotaMap[baseId]) quotaMap[baseId] = {};
            quotaMap[baseId][type] = null;
            autoWritten.push({ baseId, type, code: null, modelName, vendor, quotaName: null });
        }
        return code;
    } catch (e) {
        console.warn(`  LLM fallback failed for ${baseId} [${type}]:`, e.message);
        return null;
    }
}

function reportResults(quotaMapPath, quotaMap, fs) {
    if (autoWritten.length > 0) {
        fs.writeFileSync(quotaMapPath, JSON.stringify(quotaMap, null, 4));
        console.log(`\n✅ Auto-written ${autoWritten.length} new mapping(s) to quota-map.json:`);
        autoWritten.forEach(m => {
            if (m.code) console.log(`   ${m.baseId} [${m.type}] → ${m.code} (${m.quotaName})`);
            else console.log(`   ${m.baseId} [${m.type}] → null (no TPM quota)`);
        });
    }

    if (needsReview.length > 0) {
        console.log('\n⚠️  UNCERTAIN MAPPINGS — verify and add to build/quota-map.json manually:');
        const grouped = {};
        for (const m of needsReview) {
            if (!grouped[m.baseId]) grouped[m.baseId] = { vendor: m.vendor, name: m.modelName, types: {} };
            grouped[m.baseId].types[m.type] = { code: m.code, quotaName: m.quotaName };
        }
        for (const [baseId, info] of Object.entries(grouped)) {
            console.log(`\n  "${baseId}": // ${info.vendor} ${info.name}`);
            for (const [type, match] of Object.entries(info.types)) {
                console.log(`    "${type}": "${match.code}"  // ${match.quotaName}`);
            }
        }
    }
}

module.exports = { findQuotaCodeWithLLM, reportResults };
