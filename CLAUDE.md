# Bedrock Quota Dashboard — Claude Code Guide

## Project Overview

A static single-page application (GitHub Pages, no backend) that monitors Amazon Bedrock model TPM quota consumption via CloudWatch `EstimatedTPMQuotaUsage`. Build pipeline runs at development time using Node.js + AWS SDK v3; the runtime SPA uses a self-hosted browser bundle of the same SDK.

## Repository Layout

```
build/
  fetch.js            Node.js — fetches raw data from 3 AWS APIs into data/
  aggregate.js        Node.js — joins datasets, resolves quota codes, writes site/models.js
  bundle-sdk.js       Node.js — esbuild bundles AWS SDK v3 clients into site/aws-sdk.js
  quota-map.json      Static mapping: base model ID → { type → quotaCode }
data/                 Intermediate build artifacts (gitignored, re-generated each build)
  quotas.json         Raw output of ListServiceQuotas(bedrock)
  foundation-models.json  Raw output of ListFoundationModels
  inference-profiles.json Raw output of ListInferenceProfiles
site/
  index.html          The entire SPA — HTML + all JS inline (no bundler)
  models.js           Generated: const MODEL_CATALOGUE = [...]
  aws-sdk.js          Generated: window.AWSClients = { CloudWatchClient, ... }
```

## Build Commands

```bash
npm install          # Install all dependencies
npm run build        # Full pipeline: fetch → aggregate → bundle-sdk
npm run fetch        # Step 1: fetch raw data from AWS into data/
npm run aggregate    # Step 2: resolve quota codes, write site/models.js
npm run bundle-sdk   # Step 3: bundle SDK v3 clients into site/aws-sdk.js
```

The build requires AWS credentials configured locally (any method — SSO, env vars, ~/.aws/credentials).

## Architecture Decisions

**No backend, ever.** The SPA runs entirely in the browser. AWS credentials are pasted by the user and stored in `sessionStorage` only. Never suggest adding a server, proxy, or Lambda.

**AWS SDK v3 self-hosted.** The browser cannot use npm packages directly. `bundle-sdk.js` uses esbuild to produce an IIFE at `site/aws-sdk.js` exposing `window.AWSClients`. Do not add CDN script tags for AWS SDK — use this bundle.

**`site/index.html` is a single file.** All JavaScript lives inline in the HTML. Do not split into separate `.js` files or introduce a bundler for the frontend.

**`quota-map.json` is the source of truth for quota matching.** When `aggregate.js` encounters a model not in the map, it calls Claude Haiku via Bedrock as a fallback. Confident matches are auto-written back to the map; uncertain ones are printed for manual review. Never replace this with pure heuristic/fuzzy matching.

## Key Data Flows

### Build time
1. `fetch.js` calls `ListServiceQuotas`, `ListFoundationModels`, `ListInferenceProfiles` in parallel
2. `aggregate.js` groups model IDs by base ID (strips `us.`/`global.` prefix and context-window suffix), looks up quota codes from `quota-map.json`, calls Bedrock LLM for unknowns
3. Models without any TPM quota code are excluded from the catalogue
4. `bundle-sdk.js` bundles `CloudWatchClient + GetMetricDataCommand` and `ServiceQuotasClient + GetServiceQuotaCommand` into `site/aws-sdk.js`

### Runtime
- `MODEL_CATALOGUE` loaded from `site/models.js` — array of `{ name, vendor, ids: [{ id, type, quotaCode }] }`
- On credential configure: `ServiceQuotas.GetServiceQuota(bedrock, quotaCode)` per row per region → account-specific TPM limit
- On refresh: `CloudWatch.GetMetricData` per model ID per region → Peak (`Sum`, Period=60) and P99 (`p99`, Period=3600)
- One table row per `(model ID × region)` combination

## CloudWatch Metric Details

- **Namespace:** `AWS/Bedrock`
- **Metric:** `EstimatedTPMQuotaUsage`
- **Dimension:** `ModelId` = inference profile ID or bare model ID (e.g. `us.anthropic.claude-sonnet-4-6`)
- **Peak:** `Stat: 'Sum'`, `Period: 60` → `Math.max(...values)`
- **P99:** `Stat: 'p99'`, `Period: 3600` → `Math.max(...values)`
- Period=60 for peak because `EstimatedTPMQuotaUsage` is emitted at 1-minute resolution; p99 needs Period=3600 to aggregate enough data points for a meaningful percentile

## quota-map.json Format

```json
{
  "anthropic.claude-sonnet-4-6": {
    "On-Demand": null,
    "Cross-Region": "L-15B8E632",
    "Global": "L-7BEE40FB"
  }
}
```

- Key: base model ID (no regional prefix, no context-window suffix, keep `:0`)
- Value `null` for a type = model has no TPM quota for that type (skip LLM, exclude from catalogue)
- Value `undefined` / missing key = unknown (LLM will be called)

## Running Locally

```bash
# After npm run build, serve the site directory
python3 -m http.server 8080 -d site
# or
npx serve site
```

The AWS SDK requires HTTP (not `file://`) due to CORS.

## What NOT to Do

- Do not add `data/` files to git — they are re-generated each build
- Do not add `site/models.js` or `site/aws-sdk.js` to git — they are generated artifacts (unless deploying to GitHub Pages without CI, in which case they must be committed)
- Do not add new npm dependencies to the frontend — use `window.AWSClients` from the bundle or plain browser APIs
- Do not call `bedrock:ListFoundationModels` or `bedrock:ListInferenceProfiles` at runtime — the model catalogue is static, built at build time
- Do not use `AWS.` (v2 SDK global) anywhere — the project is fully on v3
