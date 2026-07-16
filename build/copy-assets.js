#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Static assets copied verbatim into site/ so they ship with the GitHub Pages deploy.
// [source relative to repo root, destination relative to repo root]
const ASSETS = [
    ['presentation/bedrock-quota-dashboard.png', 'site/help.png']
];

const root = path.join(__dirname, '..');

for (const [src, dest] of ASSETS) {
    const from = path.join(root, src);
    const to = path.join(root, dest);
    if (!fs.existsSync(from)) {
        console.error(`Missing asset: ${src}`);
        process.exit(1);
    }
    fs.copyFileSync(from, to);
    console.log(`Copied ${src} -> ${dest}`);
}
