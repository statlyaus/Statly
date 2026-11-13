import type {
  ETLMatch,
  ETLPlayerStats,
  ETLRoundMatchesResult,
  ETLRoundPlayerStatsResult,
} from '@/lib/etlIntegration';

/**
 * Server-side reads of the ETL round data (AFL fixtures and player match stats).
 *
 * `@/lib/etlIntegration` uses the browser Firestore SDK. On the server that client is
 * unauthenticated, and the Firestore rules only let signed-in users read `matches` (and nobody
 * read `player_match_stats`), so lineup locks, fixtures and live scoring could never load.
 * These readers use the Admin SDK, which the rules do not apply to. It is loaded on first use so
 * importing this module never requires Firebase credentials.
 */
export async function getRoundMatchesResult(
  season: number,
  round: number
): Promise<ETLRoundMatchesResult> {
  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const snapshot = await adminDb
      .collection('matches')
      .where('season', '==', season)
      .where('round_number', '==', round)
      .get();
    return { ok: true, matches: snapshot.docs.map((doc) => doc.data() as ETLMatch) };
  } catch (error) {
    console.error(`Error fetching matches for ${season} R${round}:`, error);
    return { ok: false, error };
  }
}

export async function getRoundMatches(season: number, round: number): Promise<ETLMatch[]> {
  const result = await getRoundMatchesResult(season, round);
  return result.ok ? result.matches : [];
}

export async function getRoundPlayerStatsResult(
  season: number,
  round: number
): Promise<ETLRoundPlayerStatsResult> {
  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const snapshot = await adminDb
      .collection('player_match_stats')
      .where('season', '==', season)
      // etl/processFootywireData.ts writes `round` (not `round_number`) on player match stats.
      .where('round', '==', round)
      .get();
    return { ok: true, stats: snapshot.docs.map((doc) => doc.data() as ETLPlayerStats) };
  } catch (error) {
    console.error(`Error fetching player stats for ${season} R${round}:`, error);
    return { ok: false, error };
  }
}

export type ETLLiveMatchDataResult =
  { ok: true; matches: ETLMatch[]; stats: ETLPlayerStats[] } | { ok: false; error: unknown };

/**
 * A stored stat row as the browser may see it. etl/processFootywireData.ts writes `round`,
 * `data_source` and a `last_updated` server timestamp (never `round_number`, `source` or
 * `last_seen_at`), and a `raw_row` copy of the source row that stays on the server.
 */
function toLiveStat(row: FirebaseFirestore.DocumentData): ETLPlayerStats {
  const updated: unknown = row.last_updated;
  const lastSeenAt =
    updated && typeof (updated as { toDate?: unknown }).toDate === 'function'
      ? (updated as { toDate: () => Date }).toDate().toISOString()
      : '';
  return {
    match_uid: row.match_uid,
    player_uid: row.player_uid,
    player_name: row.player_name,
    team: row.team,
    season: row.season,
    round_number: row.round,
    source: row.data_source,
    last_seen_at: lastSeenAt,
    stats: row.stats ?? {},
  };
}

/**
 * The matches in progress now and the player stats of those matches only, for the Match Centre.
 * One failed read fails the whole result: live matches are never shown beside stats that did not
 * load. At most nine games are live at once, well inside Firestore's 30-value `in` limit.
 */
export async function getLiveMatchDataResult(): Promise<ETLLiveMatchDataResult> {
  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const matchSnapshot = await adminDb
      .collection('matches')
      .where('status', '==', 'in_progress')
      .get();
    const matches = matchSnapshot.docs.map((doc) => doc.data() as ETLMatch);
    if (matches.length === 0) return { ok: true, matches, stats: [] };

    const statSnapshot = await adminDb
      .collection('player_match_stats')
      .where(
        'match_uid',
        'in',
        matches.map((match) => match.match_uid)
      )
      .get();
    return { ok: true, matches, stats: statSnapshot.docs.map((doc) => toLiveStat(doc.data())) };
  } catch (error) {
    console.error('Error fetching live match data:', error);
    return { ok: false, error };
  }
}
