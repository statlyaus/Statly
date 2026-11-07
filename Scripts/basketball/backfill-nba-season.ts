#!/usr/bin/env tsx
/**
 * Backfill one NBA regular season: rosters, the season schedule, then one box score per FINAL game
 * at no more than one request per second, then a check of the stored points, rebounds and assists
 * against ESPN's own season totals for its top 50 scorers. Resumable: games already ingested are
 * skipped. Exits non-zero on a rejection, a failure or any totals mismatch.
 *
 *   npm run nba:backfill -- --season 2026                 # dry run: report what is stored
 *   npm run nba:backfill -- --season 2026 --apply         # fetch and write (about 21 minutes)
 *   npm run nba:backfill -- --season 2026 --apply --limit 25
 *   npm run nba:backfill -- --season 2027 --apply --tolerance 1
 *
 * `--tolerance N` accepts a per-stat difference of up to N from ESPN's season totals (default 0).
 * Use it only after checking that the stored box scores match ESPN's: ESPN's totals feed can be
 * one off its own box scores.
 *
 * Refuses a non-local DATABASE_URL without --allow-remote, and an unlicensed provider in production
 * unless NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true.
 */
import { PrismaClient } from '@prisma/client';

import { backfillNbaSeason } from '../../src/server/basketball/ingest/backfillNbaSeason';
import {
  createEspnNbaStatsProvider,
  ESPN_PROVIDER_ID,
} from '../../src/server/basketball/ingest/espn/espnClient';
import { assertLocalDatabase, parseArgs, positiveInteger } from './nbaCli';

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    flags: ['apply', 'allow-remote'],
    values: ['season', 'limit', 'tolerance'],
  });
  const season = positiveInteger(args.season, 'season');
  if (!season) throw new Error('--season is required, e.g. --season 2026 for 2025-26');
  assertLocalDatabase(args['allow-remote'] === true);

  const prisma = new PrismaClient();
  try {
    if (args.apply !== true) {
      const where = { provider: ESPN_PROVIDER_ID, season };
      const [games, final, ingested] = await Promise.all([
        prisma.nbaGame.count({ where }),
        prisma.nbaGame.count({ where: { ...where, status: 'FINAL' } }),
        prisma.nbaGame.count({ where: { ...where, boxScoreIngestedAt: { not: null } } }),
      ]);
      console.log(
        `Season ${season}: ${games} games stored, ${final} final, ${ingested} with box scores.`
      );
      console.log(
        'Dry run. Pass --apply to fetch rosters, the schedule and every missing box score.'
      );
      return;
    }

    const { summary } = await backfillNbaSeason({
      prisma,
      provider: createEspnNbaStatsProvider({ maxConcurrency: 1, minIntervalMs: 1000 }),
      season,
      maxGames: positiveInteger(args.limit, 'limit'),
      tolerance: args.tolerance === undefined ? 0 : positiveInteger(args.tolerance, 'tolerance'),
      log: (line) => console.log(line),
    });
    for (const skip of summary.skipped)
      console.log(`  Skipped ${skip.gameExternalId}: ${skip.reason}`);
    console.log(
      summary.verification
        ? `Verified season totals for ${summary.verification.checked} players: all match.`
        : `Not verified: ${summary.pending} final games still have no box score.`
    );
    // A full run that could not verify (games skipped) is a failure; a --limit trial is not.
    if (!summary.verification && args.limit === undefined) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
