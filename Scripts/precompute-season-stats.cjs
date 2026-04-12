#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const tsxCli = require.resolve('tsx/dist/cli.mjs');
const scriptPath = path.join(__dirname, 'precompute-season-stats.ts');

const result = spawnSync(process.execPath, [tsxCli, scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
