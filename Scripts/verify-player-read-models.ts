#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { getDefaultAflSeason } from '../src/lib/aflSeason';
import { adminDb } from '../src/lib/firebaseAdmin';
import { fetchMergedIngestRowsForRounds } from '../src/lib/footywireStatsIngestion';
import { prisma } from '../src/lib/prisma';
import {
  listProjectedMatchLogStageRows,
  listRawMatchLogStageRows,
  listSeasonSummaryReconciliationRows,
  resolveLatestProjectedSeason,
} from '../src/server/readModels/playerReadModels';
import {
  parseVerifyPlayerReadModelsArgs,
  runVerifyPlayerReadModels,
} from './verify-player-read-models-core';

async function closeVerifierResources(): Promise<void> {
  await Promise.allSettled([prisma.$disconnect(), adminDb.terminate()]);
}

async function main() {
  const args = parseVerifyPlayerReadModelsArgs(process.argv.slice(2));
  if (!Number.isFinite(args.season) || args.season < 2020 || args.season > 2035) {
    throw new Error('Season must be between 2020 and 2035');
  }

  const output = await runVerifyPlayerReadModels(args, {
    loadRawRows: ({ season, rounds, playerId }) =>
      listRawMatchLogStageRows({ season, rounds, playerId: playerId ?? undefined }),
    loadProjectionRows: async ({ season, rounds, playerId }) => {
      const rows = await listProjectedMatchLogStageRows({
        season,
        playerId: playerId ?? undefined,
        prismaClient: prisma,
      });
      return rounds.length > 0 ? rows.filter((row) => rounds.includes(row.roundNumber)) : rows;
    },
    loadSeasonSummaryRows: ({ season, playerId }) =>
      listSeasonSummaryReconciliationRows({
        season,
        playerId: playerId ?? undefined,
        prismaClient: prisma,
      }),
    loadPublication: ({ season }) =>
      prisma.playerProjectionPublication.findFirst({
        where: { season, scope: 'season' },
        select: {
          season: true,
          scope: true,
          summaryCount: true,
          rankingCount: true,
          rosterCount: true,
          publishedAt: true,
        },
      }),
    resolvePublishedSeason: ({ fallbackSeason }) =>
      resolveLatestProjectedSeason(prisma, fallbackSeason ?? getDefaultAflSeason()),
    loadMergedRows: async ({ season, rounds, dataSource, timeoutMs, trace }) => {
      const result = await fetchMergedIngestRowsForRounds({
        season,
        rounds,
        dryRun: true,
        dataSource,
        rFetchTimeoutMs: timeoutMs,
        onProgress: trace
          ? (event) => {
              console.error(JSON.stringify({ event: 'merged_source_progress', ...event }));
            }
          : undefined,
      });
      return result.rows;
    },
  });

  console.log(JSON.stringify(output, null, 2));
  await closeVerifierResources();
  process.exit(output.status === 'fail' ? 1 : 0);
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  await closeVerifierResources();
  process.exit(1);
});
