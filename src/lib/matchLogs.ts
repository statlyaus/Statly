import type { CanonicalStatKey } from '@/lib/stats/statColumns';

export type MatchLogRow = {
  matchId: string;
  season: number;
  roundNumber: number;
  date: string; // ISO
  opponent: string;
  stats: Record<CanonicalStatKey, number>;
};

const CANONICAL_MATCH_ID_RE = /^\d{4}-R[A-Z0-9]+-/;

function isCanonicalMatchId(matchId: string): boolean {
  return CANONICAL_MATCH_ID_RE.test(matchId);
}

function statNonZeroCount(stats: Record<CanonicalStatKey, number>): number {
  return Object.values(stats).reduce((acc, value) => acc + (value !== 0 ? 1 : 0), 0);
}

function stableGameKey(row: MatchLogRow): string | null {
  const season = row.season;
  const date = row.date?.trim();
  const opponent = row.opponent?.trim();
  if (!season || !date || !opponent) return null;
  return `${season}|${date}|${opponent}`.toLowerCase();
}

export function dedupeMatchRows(rows: MatchLogRow[]): MatchLogRow[] {
  const best = new Map<string, MatchLogRow>();

  for (const row of rows) {
    const key = stableGameKey(row);
    if (!key) continue;

    const existing = best.get(key);

    if (!existing) {
      best.set(key, row);
      continue;
    }

    // Prefer canonical matchId (e.g., 2025-R23-COL-ADE) over numeric or non-standard IDs
    const existingCanonical = isCanonicalMatchId(existing.matchId);
    const rowCanonical = isCanonicalMatchId(row.matchId);

    if (rowCanonical && !existingCanonical) {
      best.set(key, row);
      continue;
    }
    if (!rowCanonical && existingCanonical) {
      continue;
    }

    // If both are equally canonical, prefer the row with more populated stats
    const existingRich = statNonZeroCount(existing.stats);
    const rowRich = statNonZeroCount(row.stats);

    if (rowRich > existingRich) {
      best.set(key, row);
    }
  }

  return Array.from(best.values());
}

/**
 * Deduplicates rows by date+opponent+season as a safety net.
 * Prefers rows with canonical matchIds (2025-R...) over numeric IDs.
 */
export function dedupeByDateOpponent(rows: MatchLogRow[]): MatchLogRow[] {
  // Use the same stable identity and tie-breakers as dedupeMatchRows
  return dedupeMatchRows(rows);
}
