#!/usr/bin/env tsx

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { getPlayers } from '@/lib/data';
import { summarizePlayerDataConvergenceRunner } from '@/server/playerDataConvergenceRunner';
import { runPlayerDataConvergenceTempDbApplySimulation } from '@/server/playerDataConvergenceTempDbApplySimulation';
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
  let preview = null;
  let applySimulation = null;

  if (report.status === 'readyForUat') {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    try {
      const executor = prismaExecutor(prisma);
      preview = await runPlayerDataConvergenceTempDbPreview({
        report,
        executor,
      });

      if (preview.status === 'previewWritten') {
        applySimulation = await runPlayerDataConvergenceTempDbApplySimulation({
          report,
          applyPlan: report.applyPlan,
          executor,
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  const runner = summarizePlayerDataConvergenceRunner({
    report,
    preview,
    applySimulation,
  });

  process.stdout.write(`${JSON.stringify(runner, null, 2)}\n`);

  if (runner.status !== 'readyForUat') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[player-data-convergence-runner] Failed', error);
  process.exit(1);
});
