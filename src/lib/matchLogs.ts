import type { CanonicalStatKey } from '@/lib/stats/statColumns';

export type MatchLogRow = {
  matchId: string;
  season: number;
  roundNumber: number;
  date: string; // ISO
  opponent: string;
  stats: Record<CanonicalStatKey, number>;
};

function scoreRowRichness(r: MatchLogRow): number {
  return Number(Boolean(r.opponent)) + Number(Boolean(r.date)) + Number(Boolean(r.roundNumber));
}

export function dedupeMatchRows(rows: MatchLogRow[]): MatchLogRow[] {
  const byMatch = new Map<string, MatchLogRow>();

  for (const row of rows) {
    const key = row.matchId;
    if (!key) {
      // Skip rows without matchId - they can't be deduplicated safely
      continue;
    }

    const existing = byMatch.get(key);

    if (!existing) {
      byMatch.set(key, row);
      continue;
    }

    // Keep the row with richer metadata (opponent/date/round present)
    if (scoreRowRichness(row) > scoreRowRichness(existing)) {
      byMatch.set(key, row);
    }
  }

  return Array.from(byMatch.values());
}

/**
 * Deduplicates rows by date+opponent+season as a safety net.
 * Prefers rows with canonical matchIds (2025-R...) over numeric IDs.
 */
export function dedupeByDateOpponent(rows: MatchLogRow[]): MatchLogRow[] {
  const best = new Map<string, MatchLogRow>();

  for (const r of rows) {
    // Skip rows without required fields for deduplication
    if (!r.date || !r.opponent || !r.season) {
      continue;
    }

    const key = `${r.season}|${r.date}|${r.opponent}`;
    const prev = best.get(key);

    if (!prev) {
      best.set(key, r);
      continue;
    }

    // Prefer canonical matchId like 2025-R...
    const prevCanon = /^\d{4}-R/.test(prev.matchId);
    const curCanon = /^\d{4}-R/.test(r.matchId);

    if (curCanon && !prevCanon) {
      best.set(key, r);
      continue;
    }

    // If both are canonical or both are non-canonical, keep the one with more stats
    const prevScore = Object.values(prev.stats ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    const curScore = Object.values(r.stats ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    if (curScore > prevScore) {
      best.set(key, r);
    }
  }

  return Array.from(best.values());
}
