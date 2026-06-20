#!/usr/bin/env tsx

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { getPlayers } from '@/lib/data';
import {
  buildPlayerDataConvergenceTrackedDryRunReport,
  type RawPlayerStatRow,
} from '@/server/playerDataConvergenceTrackedDryRun';
import {
  runPlayerDataConvergenceTempDbPreview,
  type PlayerDataConvergenceTempDbExecutor,
} from '@/server/playerDataConvergenceTempDbRunner';

async function fileExists(filePath: string): Promise<boolean> {
  if (!filePath) return false;

  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function prismaExecutor(prisma: PrismaClient): PlayerDataConvergenceTempDbExecutor {
  return {
    execute: (sql, params = []) => prisma.$executeRawUnsafe(sql, ...params),
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
  };
}

async function buildReport() {
  const repositoryRoot = process.cwd();
  const statlyVerifyDb = process.env.STATLY_VERIFY_DB ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const rawStatRows = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, 'player_stats_2025.json'), 'utf8')
  ) as RawPlayerStatRow[];
  const players = await getPlayers();

  return buildPlayerDataConvergenceTrackedDryRunReport({
    players,
    rawStatRows,
    statlyVerifyDb,
    databaseUrl,
    repositoryRoot,
    tempDatabaseFileExists: await fileExists(statlyVerifyDb),
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const report = await buildReport();

  if (report.status !== 'readyForUat') {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'player-data-convergence-temp-db-runner',
          status: 'blocked',
          report,
          preview: null,
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    const preview = await runPlayerDataConvergenceTempDbPreview({
      report,
      executor: prismaExecutor(prisma),
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'player-data-convergence-temp-db-runner',
          status: preview.status === 'previewWritten' ? 'readyForUat' : 'blocked',
          report,
          preview,
        },
        null,
        2
      )}\n`
    );

    if (preview.status !== 'previewWritten') {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[player-data-convergence-temp-db-runner] Failed', error);
  process.exit(1);
});
