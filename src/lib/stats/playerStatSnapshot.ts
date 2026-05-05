import type { PlayerStats } from '@/types/fantasyCategories';

import {
  CANONICAL_STAT_KEYS,
  type CanonicalStatKey,
} from '@/lib/stats/statColumns';
import { normalizeStats } from '@/lib/stats/normalizeStats';
import {
  hasFootywireCanonicalRawMatchContract,
  readFootywireCanonicalStatNumber,
  readFootywireCanonicalStatPresence,
} from '@/lib/stats/footywireCanonicalContract';

export type CanonicalStatSnapshot = Record<CanonicalStatKey, number>;

export function buildCanonicalStatSnapshot(
  ...sources: Array<Record<string, unknown> | null | undefined>
): CanonicalStatSnapshot {
  return normalizeStats(...sources);
}

export function buildCanonicalStatSnapshotFromRawDocument(
  data: Record<string, unknown>
): CanonicalStatSnapshot {
  if (hasFootywireCanonicalRawMatchContract(data.canonical_stats)) {
    const snapshot = {} as CanonicalStatSnapshot;
    for (const key of CANONICAL_STAT_KEYS) {
      snapshot[key] = readFootywireCanonicalStatNumber(data.canonical_stats, key).value;
    }
    return snapshot;
  }

  const stats =
    data.stats && typeof data.stats === 'object'
      ? (data.stats as Record<string, unknown>)
      : null;
  const rawRow =
    data.raw_row && typeof data.raw_row === 'object'
      ? (data.raw_row as Record<string, unknown>)
      : null;

  // Transitional legacy adapter for pre-canonical raw documents only.
  return buildCanonicalStatSnapshot(stats, data, rawRow);
}

export function readCanonicalStatPresenceFromRawDocument(
  data: Record<string, unknown>,
  key: CanonicalStatKey
): boolean {
  if (hasFootywireCanonicalRawMatchContract(data.canonical_stats)) {
    return readFootywireCanonicalStatPresence(data.canonical_stats, key).hasValue;
  }

  const stats =
    data.stats && typeof data.stats === 'object'
      ? (data.stats as Record<string, unknown>)
      : null;
  const rawRow =
    data.raw_row && typeof data.raw_row === 'object'
      ? (data.raw_row as Record<string, unknown>)
      : null;

  // Transitional legacy adapter for pre-canonical raw documents only.
  return buildCanonicalStatSnapshot(stats, data, rawRow)[key] !== 0;
}

export function canonicalStatsToPlayerStats(
  stats: CanonicalStatSnapshot,
  games = 1
): PlayerStats {
  return {
    games,
    kicks: stats.kicks,
    handballs: stats.handballs,
    marks: stats.marks,
    tackles: stats.tackles,
    goals: stats.goals,
    hitouts: stats.hitouts,
    clearances: stats.clearances,
    inside50s: stats.inside50s,
    rebound50s: stats.rebound50s,
    clangers: stats.clangers,
    contestedPossessions: stats.contestedPossessions,
    uncontestedPossessions: stats.uncontestedPossessions,
    freesFor: stats.freesFor,
    freesAgainst: stats.freesAgainst,
    onePercenters: stats.onePercenters,
    goalAssists: stats.goalAssists,
    timeOnGroundPct: stats.timeOnGroundPct,
    disposalEffPct: stats.disposalEffPct,
    turnovers: stats.turnovers,
    intercepts: stats.intercepts,
    metresGained: stats.metresGained,
    contestedMarks: stats.contestedMarks,
    effectiveDisposals: stats.effectiveDisposals,
    scoreInvolvements: stats.scoreInvolvements,
    seasonTotal: 0,
    avgFantasyPoints: 0,
    lastGameFantasyPoints: 0,
  };
}

export function canonicalStatsToApiSnapshot(
  stats: CanonicalStatSnapshot
): Record<CanonicalStatKey, number> {
  const snapshot = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    snapshot[key] = stats[key];
  }
  return snapshot;
}
