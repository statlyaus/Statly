import type { PrismaClient } from '@prisma/client';

import type { ETLMatch } from '@/lib/etlIntegration';

import { aflMatchJoinKey } from './aflMatchJoinKey';

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
export type StoredAflResult = { season: number; round: number; matchUid: string };

const DUE_AFTER_START_MS = SCHEDULED_GAME_LENGTH_MS + MISSING_RESULT_ALERT_MS;
/**
 * How far before the due window the fixture is read for the unjoined-result check, so every game of
 * a round with a due game is in hand (a round's games fall within a week).
 */
export const UNJOINED_RESULT_ROUND_SPAN_MS = 7 * 24 * 60 * 60 * 1000;

/** The start-time window of games whose result is due and still inside the look-back. */
export function missingResultWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - DUE_AFTER_START_MS - MISSING_RESULT_LOOKBACK_MS),
    to: new Date(now.getTime() - DUE_AFTER_START_MS),
  };
}

const roundOf = (key: string) => key.split('|').slice(0, 2).join('|');

/**
 * The games due a result by `now` with no stored current result that scoring can join. A result
 * matches a game exactly as No Losers scoring joins it (`aflMatchJoinKey`: season, round and the two
 * clubs in either order, from each side's `matchUid`), so this alert fires whenever a round would wait
 * on a result, and never when scoring has one (#1315).
 */
export function findMissingAflResults(
  games: readonly FixtureGame[],
  results: readonly StoredAflResult[],
  now: Date
): FixtureGame[] {
  const { from, to } = missingResultWindow(now);
  const stored = new Set(results.map((result) => aflMatchJoinKey(result.matchUid)));
  return games.filter((game) => {
    const startsAt = Date.parse(game.start_time_utc);
    if (!Number.isFinite(startsAt) || startsAt < from.getTime() || startsAt > to.getTime()) {
      return false;
    }
    const key = aflMatchJoinKey(game.match_uid);
    return !key || !stored.has(key);
  });
}

/**
 * Stored current results that no fixture game joins, in the rounds of the games due by `now`. Stat
 * rows carry the fixture's `match_uid`, so such a result joins no player's stats either: a renamed
 * round or a club the fixture spells differently. The round's games then wait on a result that is
 * in fact stored (#1315).
 */
export function findUnjoinedAflResults(
  games: readonly FixtureGame[],
  results: readonly StoredAflResult[],
  now: Date
): StoredAflResult[] {
  const gameKeys = new Set(games.map((game) => aflMatchJoinKey(game.match_uid)));
  const dueRounds = new Set(
    findMissingAflResults(games, [], now).flatMap((game) => {
      const key = aflMatchJoinKey(game.match_uid);
      return key ? [roundOf(key)] : [];
    })
  );
  return results.filter((result) => {
    const key = aflMatchJoinKey(result.matchUid);
    if (!key) return true;
    return dueRounds.has(roundOf(key)) && !gameKeys.has(key);
  });
}

/** Reads the fixture games around the window (Firestore `matches`) and their stored current results. */
export async function readMissingAflResults(deps: {
  now: Date;
  prisma: Pick<PrismaClient, 'aflMatchResult'>;
  readFixture: (fromIso: string, toIso: string) => Promise<FixtureGame[]>;
}): Promise<{ checked: number; missing: FixtureGame[]; unjoined: StoredAflResult[] }> {
  const { from } = missingResultWindow(deps.now);
  const games = await deps.readFixture(
    new Date(from.getTime() - UNJOINED_RESULT_ROUND_SPAN_MS).toISOString(),
    deps.now.toISOString()
  );
  const due = findMissingAflResults(games, [], deps.now);
  if (due.length === 0) return { checked: 0, missing: [], unjoined: [] };

  const seasons = [...new Set(due.map((game) => game.season))];
  const results = await deps.prisma.aflMatchResult.findMany({
    where: { season: { in: seasons }, supersededById: null },
    select: { season: true, round: true, matchUid: true },
  });
  return {
    checked: due.length,
    missing: findMissingAflResults(games, results, deps.now),
    unjoined: findUnjoinedAflResults(games, results, deps.now),
  };
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
