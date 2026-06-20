#!/usr/bin/env tsx

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getPlayers } from '@/lib/data';
import {
  buildPlayerDataConvergenceTrackedDryRunReport,
  type RawPlayerStatRow,
} from '@/server/playerDataConvergenceTrackedDryRun';

async function fileExists(filePath: string): Promise<boolean> {
  if (!filePath) return false;

  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const statlyVerifyDb = process.env.STATLY_VERIFY_DB ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const rawStatRows = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, 'player_stats_2025.json'), 'utf8')
  ) as RawPlayerStatRow[];
  const players = await getPlayers();
  const report = buildPlayerDataConvergenceTrackedDryRunReport({
    players,
    rawStatRows,
    statlyVerifyDb,
    databaseUrl,
    repositoryRoot,
    tempDatabaseFileExists: await fileExists(statlyVerifyDb),
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (report.status !== 'readyForUat') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[player-data-convergence-dry-run] Failed', error);
  process.exit(1);
});
