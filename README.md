# Bedrock Quota Dashboard

A static single-page application for monitoring Amazon Bedrock model quota consumption (tokens per minute) using the `EstimatedTPMQuotaUsage` CloudWatch metric. Designed to be hosted on GitHub Pages with no backend required.

## Why This Exists

Monitoring Bedrock quota consumption is harder than it should be:

**1. Quotas and metrics live in separate places.**
The AWS Console splits quota limits (Service Quotas) and actual consumption (CloudWatch) across different services. Answering "how close am I to my limit?" requires manually cross-referencing both, one model at a time.

**2. No unified multi-model view.**
CloudWatch Metrics Explorer doesn't natively show all your Bedrock models' TPM consumption side-by-side with their limits. You get metrics or quotas — not both together.

**3. Multi-region consumption is invisible.**
Cross-region and global inference profiles route traffic across multiple regions. There's no built-in view that aggregates or compares consumption across `us-east-1`, `us-west-2`, `eu-west-1`, etc. in one place.

**4. Three quota types, three different limits.**
On-Demand, Cross-Region, and Global invocations each consume against separate quotas with different limits. It's non-obvious which metric maps to which quota — especially when the CloudWatch `ModelId` dimension uses inference profile IDs (`us.anthropic.claude-sonnet-4-6`) that don't match the quota names in the console.

**5. Teams find out at `ThrottlingException` time.**
Without a consolidated view, quota exhaustion is typically discovered in production when requests start failing — not before. There's no default alerting wired between Service Quotas and the teams that need to know.

**6. The model ID ↔ quota mapping is undocumented.**
AWS doesn't publish a canonical mapping between Bedrock model IDs, inference profile IDs, and their corresponding Service Quota codes. Building this dashboard required reverse-engineering that mapping across three separate APIs.

This dashboard solves all of the above in a single static page you can host on GitHub Pages — no infrastructure, no backend, no ongoing cost.

## Features

- Browse Bedrock model TPM quotas grouped by vendor (Anthropic, Amazon, Meta, Mistral AI, etc.)
- Select specific models to monitor via dual-listbox selector
- Multi-region support — select multiple regions, one row per model × region
- Live CloudWatch `EstimatedTPMQuotaUsage` metrics: Peak (maximum 1-min bucket) and P99
- Color-coded Peak vs Limit progress bar (green < 50%, yellow 50–80%, red > 80%)
- Link to CloudWatch console pre-configured with the model, region, and time range
- Link to Service Quotas console to request a quota increase
- Type filter: On-Demand / Cross-Region / Global
- Period selector: 10 min, 1 hour, 3 hours, 24 hours, Today, This week, This month, Last month
- With usage only filter (post-refresh)
- Units toggle: Raw / Automatic (du -h style)
- Export table as Markdown or CSV
- Dark/light theme toggle

## Project Structure

```
├── build/
│   ├── fetch.js            # Fetches quotas, foundation models, inference profiles from AWS
│   ├── aggregate.js        # Joins datasets, resolves quota codes, produces site/models.js
│   ├── bundle-sdk.js       # Bundles AWS SDK v3 clients into site/aws-sdk.js
│   └── quota-map.json      # Static model ID → quota code mapping (hand-curated + LLM-assisted)
├── data/                   # Intermediate build artifacts (not committed)
│   ├── quotas.json         # Raw Service Quotas data
│   ├── foundation-models.json
│   └── inference-profiles.json
├── site/
│   ├── index.html          # Dashboard SPA
│   ├── models.js           # Model catalogue with quota codes (generated)
│   └── aws-sdk.js          # Bundled AWS SDK v3 (generated)
├── package.json
└── .gitignore
```

## Prerequisites

- Node.js (v18+)
- AWS credentials configured locally (SSO, environment variables, or `~/.aws/credentials`)

## Setup

```bash
npm install
```

## Updating Data

```bash
npm run build
```

This runs three steps:
1. **`fetch`** — calls `ListServiceQuotas`, `ListFoundationModels`, `ListInferenceProfiles` in parallel into `data/`
2. **`aggregate`** — joins datasets, resolves quota codes via `quota-map.json` (with LLM fallback for new models), writes `site/models.js`
3. **`bundle-sdk`** — bundles CloudWatch + ServiceQuotas SDK v3 clients into `site/aws-sdk.js` (147KB)

### Quota Map

`build/quota-map.json` maps base model IDs to Service Quota codes. When a new model appears that isn't in the map, `aggregate.js` calls Claude Haiku via Bedrock to suggest a match. Confident matches are auto-written to the map; uncertain ones are printed for manual verification.

## Live Usage Metrics

1. Click **🔑 Credentials** and enter Access Key ID, Secret Access Key, and (optionally) Session Token
2. Select regions and models
3. Click **🔄 Refresh** to fetch current usage

To get temporary credentials:

```bash
aws sts get-session-token --output json
```

Copy `AccessKeyId`, `SecretAccessKey`, and `SessionToken` from the output.

Credentials are stored in `sessionStorage` (cleared when the tab closes) and never leave the browser.

Required IAM permissions:
- `cloudwatch:GetMetricData`
- `servicequotas:GetServiceQuota`

## Deploying to GitHub Pages

Configure GitHub Pages to serve from the `site/` directory.
