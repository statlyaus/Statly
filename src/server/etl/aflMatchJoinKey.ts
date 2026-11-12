/**
 * The one key that joins an AFL game across Statly's sources (#1315): season, round and the two club
 * abbreviations in either order. A Statly match id (`matchUid`, `2025-R18-GEE-HAW`) is built HOME-AWAY
 * by each source on its own: the results ingest (etl/resultIngest.ts) from Footywire's match page,
 * the stat rows and fixture from the round stats feed. If the two disagree on home and away, an exact
 * `matchUid` join silently misses; this key does not. Scoring, the club strip and the missing-result
 * alert all join through it, so the alert fires exactly when scoring cannot join.
 *
 * Out of scope: two games between the same clubs in one round, which this key cannot tell apart.
 */

/** `2025|18|GEE|HAW` for `2025-R18-HAW-GEE` or `2025-R18-GEE-HAW`; null for anything else. */
export function aflMatchJoinKey(matchUid: string | null | undefined): string | null {
  if (typeof matchUid !== 'string') return null;
  const match = /^(\d{4})-R(\d+)-([A-Za-z]+)-([A-Za-z]+)$/.exec(matchUid.trim());
  if (!match) return null;
  const [, season, round, home, away] = match;
  const clubs = [home.toUpperCase(), away.toUpperCase()].sort();
  return `${season}|${Number(round)}|${clubs[0]}|${clubs[1]}`;
}
