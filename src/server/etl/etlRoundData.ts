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
      .where('round_number', '==', round)
      .get();
    return { ok: true, stats: snapshot.docs.map((doc) => doc.data() as ETLPlayerStats) };
  } catch (error) {
    console.error(`Error fetching player stats for ${season} R${round}:`, error);
    return { ok: false, error };
  }
}
