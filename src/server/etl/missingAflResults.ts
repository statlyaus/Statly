import type { PrismaClient } from '@prisma/client';

import type { ETLMatch } from '@/lib/etlIntegration';

/**
 * Finds AFL games whose official result (`AflMatchResult`, written by etl/resultIngest.ts) is still
 * missing 6 hours after the game's scheduled end (NFR-6, #1290). The check runs in the web app, not
 * the ETL, so it still fires when the ETL itself has stopped.
 */

/** An AFL game's scheduled length, first bounce to final siren with breaks, rounded up. */
export const SCHEDULED_GAME_LENGTH_MS = 3 * 60 * 60 * 1000;
/** How long after a game's scheduled end a missing result raises an alert. */
export const MISSING_RESULT_ALERT_MS = 6 * 60 * 60 * 1000;
/** Games further back are not checked, so history from before the ingest never alerts. */
export const MISSING_RESULT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export type FixtureGame = Pick<
  ETLMatch,
  'match_uid' | 'season' | 'round_number' | 'home_team' | 'away_team' | 'start_time_utc'
>;
export type StoredAflResult = { season: number; round: number; homeClub: string; awayClub: string };

const DUE_AFTER_START_MS = SCHEDULED_GAME_LENGTH_MS + MISSING_RESULT_ALERT_MS;

/** The start-time window of games whose result is due and still inside the look-back. */
export function missingResultWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - DUE_AFTER_START_MS - MISSING_RESULT_LOOKBACK_MS),
    to: new Date(now.getTime() - DUE_AFTER_START_MS),
  };
}

const pairKey = (season: number, round: number, a: string, b: string) =>
  `${season}|${round}|${[a, b].sort().join('|')}`;

/**
 * The games due a result by `now` with no stored current result. A result matches a game by season,
 * round and the two clubs in either order, so a home/away difference between Footywire's fixture
 * and its match page cannot hide a stored result.
 */
export function findMissingAflResults(
  games: readonly FixtureGame[],
  results: readonly StoredAflResult[],
  now: Date
): FixtureGame[] {
  const { from, to } = missingResultWindow(now);
  const stored = new Set(
    results.map((result) => pairKey(result.season, result.round, result.homeClub, result.awayClub))
  );
  return games.filter((game) => {
    const startsAt = Date.parse(game.start_time_utc);
    if (!Number.isFinite(startsAt) || startsAt < from.getTime() || startsAt > to.getTime()) {
      return false;
    }
    return !stored.has(pairKey(game.season, game.round_number, game.home_team, game.away_team));
  });
}

/** Reads the fixture games in the window (Firestore `matches`) and their stored current results. */
export async function readMissingAflResults(deps: {
  now: Date;
  prisma: Pick<PrismaClient, 'aflMatchResult'>;
  readFixture: (fromIso: string, toIso: string) => Promise<FixtureGame[]>;
}): Promise<{ checked: number; missing: FixtureGame[] }> {
  const { from, to } = missingResultWindow(deps.now);
  const games = await deps.readFixture(from.toISOString(), to.toISOString());
  if (games.length === 0) return { checked: 0, missing: [] };

  const seasons = [...new Set(games.map((game) => game.season))];
  const results = await deps.prisma.aflMatchResult.findMany({
    where: { season: { in: seasons }, supersededById: null },
    select: { season: true, round: true, homeClub: true, awayClub: true },
  });
  return { checked: games.length, missing: findMissingAflResults(games, results, deps.now) };
}

/** Firestore `matches` by start time, through the Admin SDK (loaded on first use). */
export async function readFixtureGamesStartedBetween(
  fromIso: string,
  toIso: string
): Promise<FixtureGame[]> {
  const { adminDb } = await import('@/lib/firebaseAdmin');
  const snapshot = await adminDb
    .collection('matches')
    .where('start_time_utc', '>=', fromIso)
    .where('start_time_utc', '<=', toIso)
    .get();
  return snapshot.docs.map((doc) => doc.data() as FixtureGame);
}
