/**
 * The season a league's fantasy state belongs to. Every league has an active season: league creation
 * sets one, and the 2026-11-08 season-scope migration gave one to every league that lacked it.
 * A league without one is a broken invariant, so season-scoped reads and writes fail closed rather
 * than fall back to league-wide rows.
 */
export class ActiveSeasonMissingError extends Error {
  constructor(readonly leagueId: string) {
    super(`League ${leagueId} has no active season`);
    this.name = 'ActiveSeasonMissingError';
  }
}

/** The active season id of an already-loaded league row. */
export function activeSeasonIdOf(league: { id: string; activeSeasonId: string | null }): string {
  if (!league.activeSeasonId) throw new ActiveSeasonMissingError(league.id);
  return league.activeSeasonId;
}

type LeagueSeasonReader = {
  league: {
    findUnique(args: {
      where: { id: string };
      select: { activeSeasonId: true };
    }): PromiseLike<{ activeSeasonId: string | null } | null>;
  };
};

/** Loads the league's active season id; throws when the league or its active season is missing. */
export async function requireActiveSeasonId(
  client: LeagueSeasonReader,
  leagueId: string
): Promise<string> {
  const league = await client.league.findUnique({
    where: { id: leagueId },
    select: { activeSeasonId: true },
  });
  return activeSeasonIdOf({ id: leagueId, activeSeasonId: league?.activeSeasonId ?? null });
}

/**
 * Where-filter for season-scoped rows read or written by league (waiver claims and priority): the
 * row's season is the league's active season. A relation filter, so a write needs no extra read.
 */
export function inActiveSeason(leagueId: string) {
  return { season: { activeForLeague: { is: { id: leagueId } } } };
}

/** The same filter for rows of several leagues: each row is in its own league's active season. */
export const IN_ACTIVE_SEASON = { season: { activeForLeague: { isNot: null } } };
