# Bedrock Quota Dashboard — Claude Code Guide

## Project Overview

A static single-page application (GitHub Pages, no backend) that monitors Amazon Bedrock model TPM quota consumption via CloudWatch `EstimatedTPMQuotaUsage`. Build pipeline runs at development time using Node.js + AWS SDK v3; the runtime SPA uses a self-hosted browser bundle of the same SDK.

## Repository Layout

```
build/
  fetch.js            Node.js — fetches raw data from 3 AWS APIs into data/
  aggregate.js        Node.js — joins datasets, resolves quota codes, writes site/models.js
  bundle-sdk.js       Node.js — esbuild bundles AWS SDK v3 clients into site/aws-sdk.js
  copy-assets.js      Node.js — copies static assets (presentation slide → site/help.png)
  stamp-version.js    Node.js — writes site/version.js with a fresh build timestamp
  quota-map.json      Static mapping: base model ID → { type → quotaCode }
data/                 Intermediate build artifacts (gitignored, re-generated each build)
  quotas.json         Raw output of ListServiceQuotas(bedrock)
  foundation-models.json  Raw output of ListFoundationModels
  inference-profiles.json Raw output of ListInferenceProfiles
presentation/
  bedrock-quota-dashboard.html  Source of the "Why this dashboard?" slide
  bedrock-quota-dashboard.png   Rendered slide — copied to site/help.png at build; shown in the in-app Help modal
site/
  index.html          The entire SPA — HTML + all JS inline (no bundler)
  models.js           Generated: const MODEL_CATALOGUE = [...]
  aws-sdk.js          Generated: window.AWSClients = { CloudWatchClient, ... }
  version.js          Generated: const BUILD_VERSION = '...' (footer stamp)
  help.png            Generated: copy of the presentation slide (Help modal image)
.github/workflows/
  pages.yml           GitHub Actions — deploys site/ to GitHub Pages on push (does NOT rebuild)
```

## Build Commands

```bash
npm install          # Install all dependencies
npm run build        # Full pipeline: fetch → aggregate → build:site
npm run build:site   # Static-only: bundle-sdk → copy-assets → stamp (NO AWS calls)
npm run fetch        # fetch raw data from AWS into data/
npm run aggregate    # resolve quota codes, write site/models.js
npm run bundle-sdk   # bundle SDK v3 clients into site/aws-sdk.js
npm run copy-assets  # copy presentation slide → site/help.png
npm run stamp        # write site/version.js build timestamp
```

Two build paths:
- `npm run build` — full pipeline; requires AWS credentials (SSO, env vars, ~/.aws/credentials). Refetches and regenerates the model catalogue.
- `npm run build:site` — static-only rebuild for site/frontend changes (SDK bundle, assets, version stamp). No AWS credentials needed. Use this when you change `index.html`, the presentation slide, or SDK bundling but not the model catalogue.

**Version stamp is decoupled from the catalogue.** `BUILD_VERSION` lives in its own `site/version.js` (written by `stamp-version.js`), NOT in `models.js`. This means a static-only rebuild bumps the footer without an AWS fetch. `index.html` loads `version.js` after `models.js`.

## Architecture Decisions

**No backend, ever.** The SPA runs entirely in the browser. AWS credentials are pasted by the user and stored in `sessionStorage` only. Never suggest adding a server, proxy, or Lambda.

**AWS SDK v3 self-hosted.** The browser cannot use npm packages directly. `bundle-sdk.js` uses esbuild to produce an IIFE at `site/aws-sdk.js` exposing `window.AWSClients`. Do not add CDN script tags for AWS SDK — use this bundle.

**`site/index.html` is a single file.** All JavaScript lives inline in the HTML. Do not split into separate `.js` files or introduce a bundler for the frontend.

**`quota-map.json` is the source of truth for quota matching.** When `aggregate.js` encounters a model not in the map, it calls Claude Haiku via Bedrock as a fallback. Confident matches are auto-written back to the map; uncertain ones are printed for manual review. Never replace this with pure heuristic/fuzzy matching.

## Key Data Flows

### Build time
1. `fetch.js` calls `ListServiceQuotas`, `ListFoundationModels`, `ListInferenceProfiles` in parallel
2. `aggregate.js` groups model IDs by base ID (strips `us.`/`global.` prefix and context-window suffix), looks up quota codes from `quota-map.json`, calls Bedrock LLM for unknowns
3. `aggregate.js` then merges entries sharing the same `(vendor, name)` into one catalogue entry (deduping IDs). Needed because `toBaseId` keeps a trailing `:0`, so ID variants like `model-v3:0:512` and `model-v3` group separately despite being the same model; without the merge they produce duplicate-named entries and an inconsistent selection count (the model selector keys on name)
4. Models without any TPM quota code are excluded from the catalogue
5. `bundle-sdk.js` bundles `CloudWatchClient + GetMetricDataCommand` and `ServiceQuotasClient + GetServiceQuotaCommand` into `site/aws-sdk.js`

### Runtime
- Credentials: entered per-field, OR pasted as raw `aws sts get-session-token --output json` output (a "Parse & fill" button extracts `AccessKeyId`/`SecretAccessKey`/`SessionToken` into the fields — additive, does not replace manual entry)
- Help modal (❓ button in navbar) displays `site/help.png` — the rendered presentation slide
- Default regions on first load: `us-east-1` + `us-west-2` (persisted to localStorage thereafter)
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

## Deployment

Live at **https://tgpadua.github.io/aws-bedrock-quota-dashboard/** via GitHub Pages.

`.github/workflows/pages.yml` deploys the committed `site/` folder on every push that touches `site/**` (or the workflow file). The workflow **only publishes** already-committed assets — it does NOT run `npm run build` (that needs AWS credentials and runs locally). So: run the build locally, commit the generated `site/` artifacts, push, and CI deploys them. Pages source is configured as `build_type: workflow` (not branch deploy — the site lives in `site/`, not root/docs).

## What NOT to Do

- Do not add `data/` files to git — they are re-generated each build
- The generated `site/` artifacts (`models.js`, `aws-sdk.js`, `version.js`, `help.png`) ARE committed — the Pages workflow deploys committed assets and does not rebuild. Run the build locally, then commit them.
- Do not add new npm dependencies to the frontend — use `window.AWSClients` from the bundle or plain browser APIs
- Do not call `bedrock:ListFoundationModels` or `bedrock:ListInferenceProfiles` at runtime — the model catalogue is static, built at build time
- Do not use `AWS.` (v2 SDK global) anywhere — the project is fully on v3
