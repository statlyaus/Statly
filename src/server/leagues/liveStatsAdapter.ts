import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import type { CategoryTotals } from './matchupScoringEngine';

export type NormalizedGameStatus = 'scheduled' | 'live' | 'final' | 'unknown';

type RawValueRecord = Record<string, unknown>;

export interface RawLiveStatRow extends RawValueRecord {
  stats?: RawValueRecord;
}

export type RawRoundMatch = RawValueRecord;

export interface NormalizedLiveStatRow {
  playerId: string;
  matchId: string | null;
  round: number | null;
  season: number | null;
  gameStartsAt: Date | null;
  gameStatus: NormalizedGameStatus;
  statusUnavailable: boolean;
  totals: CategoryTotals;
  lastSeenAt: Date | null;
}

export interface NormalizedRoundMatchStatus {
  earliestStartAt: Date | null;
  latestEndAt: Date | null;
  anyLive: boolean;
  allFinal: boolean;
  hasUnavailableStatus: boolean;
  matches: Array<{
    matchId: string | null;
    startsAt: Date | null;
    status: NormalizedGameStatus;
    statusUnavailable: boolean;
  }>;
}

const CATEGORY_FIELD_ALIASES: Record<FantasyCategoryKey, string[]> = {
  goals: ['goals'],
  kicks: ['kicks'],
  handballs: ['handballs'],
  marks: ['marks'],
  tackles: ['tackles'],
  hitouts: ['hitouts'],
  clearances: ['clearances'],
  inside50s: ['inside50s', 'inside_50s'],
  rebound50s: ['rebound50s', 'rebound_50s'],
  clangers: ['clangers'],
  contestedPossessions: ['contestedPossessions', 'contested_possessions'],
  uncontestedPossessions: ['uncontestedPossessions', 'uncontested_possessions'],
  freesFor: ['freesFor', 'frees_for'],
  freesAgainst: ['freesAgainst', 'frees_against'],
  onePercenters: ['onePercenters', 'one_percenters'],
  goalAssists: ['goalAssists', 'goal_assists'],
  timeOnGroundPct: ['timeOnGroundPct', 'tog_pct', 'time_on_ground_percentage', 'time_on_ground'],
  disposalEffPct: ['disposalEffPct', 'disposal_efficiency'],
  turnovers: ['turnovers'],
  intercepts: ['intercepts'],
  metresGained: ['metresGained', 'metres_gained'],
  contestedMarks: ['contestedMarks', 'contested_marks'],
  effectiveDisposals: ['effectiveDisposals', 'effective_disposals'],
  scoreInvolvements: ['scoreInvolvements', 'score_involvements'],
};

function readString(source: RawValueRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function readNumber(source: RawValueRecord, keys: readonly string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
      return Number(value);
  }
  return 0;
}

function readDate(source: RawValueRecord, keys: readonly string[]): Date | null {
  for (const key of keys) {
    const value = source[key];
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date;
    }
  }
  return null;
}

function normalizeStatus(value: unknown): NormalizedGameStatus {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.toLowerCase();
  if (normalized === 'in_progress' || normalized === 'live') return 'live';
  if (normalized === 'final' || normalized === 'completed' || normalized === 'complete')
    return 'final';
  if (normalized === 'scheduled' || normalized === 'fixture') return 'scheduled';
  return 'unknown';
}

function readCategoryTotals(source: RawValueRecord): CategoryTotals {
  const nestedStats =
    source.stats && typeof source.stats === 'object' ? (source.stats as RawValueRecord) : {};
  const totals: CategoryTotals = {};

  for (const [category, aliases] of Object.entries(CATEGORY_FIELD_ALIASES) as Array<
    [FantasyCategoryKey, string[]]
  >) {
    const value = readNumber(nestedStats, aliases) || readNumber(source, aliases);
    totals[category] = value;
  }

  return totals;
}

export function normalizeLiveStatRows(rows: readonly RawLiveStatRow[]): NormalizedLiveStatRow[] {
  return rows.flatMap((row) => {
    const playerId = readString(row, ['player_uid', 'player_id', 'playerUid', 'playerId']);
    if (!playerId) return [];

    const gameStartsAt = readDate(row, ['start_time_utc', 'startsAt', 'matchDate', 'match_date']);
    const gameStatus = normalizeStatus(row.status);
    const matchId = readString(row, ['match_uid', 'match_id', 'matchUid', 'matchId']);

    return {
      playerId,
      matchId,
      round: readNumber(row, ['round_number', 'round']) || null,
      season: readNumber(row, ['season']) || null,
      gameStartsAt,
      gameStatus,
      statusUnavailable: !gameStartsAt && gameStatus === 'unknown',
      totals: readCategoryTotals(row),
      lastSeenAt: readDate(row, ['last_seen_at', 'lastSeenAt']),
    };
  });
}

export function normalizeRoundMatchStatus(
  rows: readonly RawRoundMatch[]
): NormalizedRoundMatchStatus {
  const matches = rows.map((row) => {
    const startsAt = readDate(row, ['start_time_utc', 'startsAt', 'matchDate', 'match_date']);
    const status = normalizeStatus(row.status);
    return {
      matchId: readString(row, ['match_uid', 'match_id', 'matchUid', 'matchId']),
      startsAt,
      status,
      statusUnavailable: !startsAt && status === 'unknown',
    };
  });

  const starts = matches.flatMap((match) => (match.startsAt ? [match.startsAt] : []));
  return {
    earliestStartAt:
      starts.length > 0 ? new Date(Math.min(...starts.map((date) => date.getTime()))) : null,
    latestEndAt: null,
    anyLive: matches.some((match) => match.status === 'live'),
    allFinal: matches.length > 0 && matches.every((match) => match.status === 'final'),
    hasUnavailableStatus: matches.some((match) => match.statusUnavailable),
    matches,
  };
}
