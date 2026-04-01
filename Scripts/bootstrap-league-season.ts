import '../src/lib/loadEnv';

import { adminDb } from '@/lib/firebaseAdmin';
import { bootstrapLeagueSeason } from '@/lib/leagueSeason';
import { prisma } from '@/lib/prisma';

function parseArgs(argv: string[]): { season: number; leagueIds: string[] | null } {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='));
  const leagueArg = argv.find((arg) => arg.startsWith('--league='));
  const season = seasonArg ? Number(seasonArg.split('=')[1]) : new Date().getFullYear();
  const leagueIds = leagueArg
    ? leagueArg
        .split('=')[1]
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : null;

  if (!Number.isFinite(season)) {
    throw new Error('Invalid --season value');
  }

  return { season, leagueIds };
}

async function getLeagueIds(explicitLeagueIds: string[] | null): Promise<string[]> {
  if (explicitLeagueIds && explicitLeagueIds.length > 0) {
    return explicitLeagueIds;
  }

  const [prismaLeagues, firestoreLeagues] = await Promise.all([
    prisma.league.findMany({ select: { id: true } }).catch(() => [] as Array<{ id: string }>),
    adminDb.collection('leagues').get(),
  ]);

  return Array.from(
    new Set([
      ...prismaLeagues.map((league) => league.id),
      ...firestoreLeagues.docs.map((doc) => doc.id),
    ])
  );
}

async function main() {
  const { season, leagueIds: explicitLeagueIds } = parseArgs(process.argv.slice(2));
  const leagueIds = await getLeagueIds(explicitLeagueIds);

  if (leagueIds.length === 0) {
    console.log('No leagues found to bootstrap.');
    return;
  }

  const results: Array<{ leagueId: string; ok: boolean; detail: string }> = [];

  for (const leagueId of leagueIds) {
    try {
      const result = await bootstrapLeagueSeason({ leagueId, season });
      results.push({
        leagueId,
        ok: true,
        detail: `weeks=${result.weekCount} matchups=${result.matchupCount} currentWeek=${result.currentWeek ?? 'n/a'}`,
      });
    } catch (error) {
      results.push({
        leagueId,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  results.forEach((result) => {
    console.log(`${result.ok ? 'OK' : 'ERR'} ${result.leagueId} ${result.detail}`);
  });

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
