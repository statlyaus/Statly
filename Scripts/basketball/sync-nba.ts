#!/usr/bin/env tsx
/**
 * Run one NBA ingest job once, as the cron route would.
 *
 *   npm run nba:sync -- --job players|schedule|boxscores|injuries [--season 2027] [--limit 8]
 *                       [--allow-remote]
 *
 * `--season` defaults to the current season; `--limit` is the box scores per run. Refuses a
 * non-local DATABASE_URL without --allow-remote, and an unlicensed provider in production unless
 * NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true.
 */
import { PrismaClient } from '@prisma/client';

import { createEspnNbaStatsProvider } from '../../src/server/basketball/ingest/espn/espnClient';
import {
  isNbaIngestJobName,
  NBA_INGEST_JOBS,
  nbaSeasonForDate,
} from '../../src/server/basketball/ingest/nbaIngestJobs';
import { assertLocalDatabase, parseArgs, positiveInteger } from './nbaCli';

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    flags: ['allow-remote'],
    values: ['job', 'season', 'limit'],
  });
  const job = args.job;
  if (!isNbaIngestJobName(job)) {
    throw new Error('--job must be one of players, schedule, boxscores, injuries');
  }
  assertLocalDatabase(args['allow-remote'] === true);

  const now = new Date();
  const prisma = new PrismaClient();
  try {
    const games = positiveInteger(args.limit, 'limit');
    const result = await NBA_INGEST_JOBS[job]({
      prisma,
      provider: createEspnNbaStatsProvider(),
      season: positiveInteger(args.season, 'season') ?? nbaSeasonForDate(now),
      now,
      limits: games ? { games } : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
