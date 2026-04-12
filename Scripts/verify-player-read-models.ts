#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { getDefaultAflSeason } from '../src/lib/aflSeason';
import { prisma } from '../src/lib/prisma';
import {
  buildPlayerSeasonSummaries,
  resolveLatestProjectedSeason,
} from '../src/server/readModels/playerReadModels';

function parseArgs(argv: string[]) {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const sampleArg = argv.find((arg) => arg.startsWith('--sample='))?.split('=')[1];
  const skipParity = argv.includes('--skip-parity');

  return {
    season: seasonArg ? Number(seasonArg) : getDefaultAflSeason(),
    sampleSize: sampleArg ? Number(sampleArg) : 20,
    skipParity,
  };
}

async function timed<T>(label: string, fn: () => Promise<T>) {
  const startedAt = Date.now();
  const value = await fn();
  return {
    label,
    elapsedMs: Date.now() - startedAt,
    value,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.season) || args.season < 2020 || args.season > 2030) {
    throw new Error('Season must be between 2020 and 2030');
  }

  const summaryQuery = await timed('playerSeasonSummary.findMany', () =>
    prisma.playerSeasonSummary.findMany({
      where: { season: args.season },
      orderBy: { totalValue: 'desc' },
    })
  );
  const rankingQuery = await timed('playerRankingSnapshot.count', () =>
    prisma.playerRankingSnapshot.count({
      where: { season: args.season, scope: 'season' },
    })
  );
  const rosterQuery = await timed('leagueRosterPlayerSummary.count', () =>
    prisma.leagueRosterPlayerSummary.count({
      where: { season: args.season },
    })
  );

  const parity = {
    checked: false,
    sourceCount: 0,
    projectedCount: summaryQuery.value.length,
    missingProjectedCount: 0,
    unexpectedProjectedCount: 0,
    mismatches: [] as string[],
  };

  if (!args.skipParity) {
    const rebuilt = await timed('buildPlayerSeasonSummaries', () =>
      buildPlayerSeasonSummaries({
        season: args.season,
        prismaClient: prisma,
      })
    );
    parity.checked = true;
    parity.sourceCount = rebuilt.value.summaries.length;

    const sourceById = new Map(rebuilt.value.summaries.map((row) => [row.playerId, row] as const));
    const projectedById = new Map(summaryQuery.value.map((row) => [row.playerId, row] as const));
    for (const sourceRow of rebuilt.value.summaries) {
      const projectedRow = projectedById.get(sourceRow.playerId);
      if (!projectedRow) {
        parity.missingProjectedCount += 1;
        parity.mismatches.push(`missing projected row for ${sourceRow.playerId}`);
        continue;
      }
      if (projectedRow.gamesPlayed !== sourceRow.gamesPlayed) {
        parity.mismatches.push(`games mismatch for ${sourceRow.playerId}`);
      }
      if (Math.round(projectedRow.totalValue) !== Math.round(sourceRow.totalValue)) {
        parity.mismatches.push(`totalValue mismatch for ${sourceRow.playerId}`);
      }
    }

    for (const projectedPlayerId of projectedById.keys()) {
      if (sourceById.has(projectedPlayerId)) continue;
      parity.unexpectedProjectedCount += 1;
      parity.mismatches.push(`unexpected projected row for ${projectedPlayerId}`);
    }

    const [publication, publishedSeason] = await Promise.all([
      prisma.playerProjectionPublication.findFirst({
        where: { season: args.season, scope: 'season' },
        select: {
          season: true,
          scope: true,
          summaryCount: true,
          rankingCount: true,
          rosterCount: true,
          publishedAt: true,
        },
      }),
      resolveLatestProjectedSeason(prisma, getDefaultAflSeason()),
    ]);

    console.log(
      JSON.stringify(
        {
          ok: parity.mismatches.length === 0,
          season: args.season,
          parity,
          latencies: [
            { label: summaryQuery.label, elapsedMs: summaryQuery.elapsedMs },
            { label: rankingQuery.label, elapsedMs: rankingQuery.elapsedMs },
            { label: rosterQuery.label, elapsedMs: rosterQuery.elapsedMs },
            { label: rebuilt.label, elapsedMs: rebuilt.elapsedMs },
          ],
          counts: {
            playerSeasonSummaries: summaryQuery.value.length,
            rankingSnapshots: rankingQuery.value,
            rosterSummaries: rosterQuery.value,
          },
          publication,
          publishedSeason,
        },
        null,
        2
      )
    );

    if (parity.mismatches.length > 0) {
      process.exit(1);
    }

    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        season: args.season,
        parity,
        latencies: [
          { label: summaryQuery.label, elapsedMs: summaryQuery.elapsedMs },
          { label: rankingQuery.label, elapsedMs: rankingQuery.elapsedMs },
          { label: rosterQuery.label, elapsedMs: rosterQuery.elapsedMs },
        ],
        counts: {
          playerSeasonSummaries: summaryQuery.value.length,
          rankingSnapshots: rankingQuery.value,
          rosterSummaries: rosterQuery.value,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
