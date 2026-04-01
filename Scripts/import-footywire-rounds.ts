#!/usr/bin/env tsx

import { config } from 'dotenv';

config({ path: '.env.local' });

function parseArgs(argv: string[]) {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const roundsArg = argv.find((arg) => arg.startsWith('--rounds='))?.split('=')[1];
  const dryRun = argv.includes('--dry-run');
  const baseUrl =
    argv.find((arg) => arg.startsWith('--base-url='))?.split('=')[1] ||
    process.env.APP_ORIGIN ||
    'http://127.0.0.1:3000';

  const season = seasonArg ? Number(seasonArg) : new Date().getFullYear();
  const rounds = (roundsArg || '0,1')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);

  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error(`Invalid season: ${seasonArg ?? '<missing>'}`);
  }
  if (rounds.length === 0) {
    throw new Error('At least one round must be provided via --rounds=0,1');
  }

  return { season, rounds, dryRun, baseUrl };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const response = await fetch(`${args.baseUrl.replace(/\/$/, '')}/api/etl/import-rounds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ETL_IMPORT_TOKEN
        ? { 'x-etl-import-token': process.env.ETL_IMPORT_TOKEN }
        : {}),
    },
    body: JSON.stringify({
      season: args.season,
      rounds: args.rounds,
      dryRun: args.dryRun,
    }),
  });
  const body = await response.text();
  console.log(body);
  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
