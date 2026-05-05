import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
import { isDownstreamEnrichedStatKey } from '@/lib/stats/statColumns';

export const MATCH_LOG_NULLABLE_STAT_KEYS = [
  'clearances',
  'inside50s',
  'rebound50s',
  'contestedPossessions',
  'uncontestedPossessions',
  'freesFor',
  'freesAgainst',
  'onePercenters',
  'goalAssists',
  'turnovers',
  'intercepts',
  'metresGained',
  'contestedMarks',
  'effectiveDisposals',
  'scoreInvolvements',
  'timeOnGroundPct',
  'disposalEffPct',
  'minutes',
] as const satisfies readonly CanonicalStatKey[];

export type MatchLogNullableStatKey = (typeof MATCH_LOG_NULLABLE_STAT_KEYS)[number];
export type MatchLogStatAvailability = Partial<Record<CanonicalStatKey, boolean>>;
export type MatchLogStats = Omit<Record<CanonicalStatKey, number>, MatchLogNullableStatKey> &
  Record<MatchLogNullableStatKey, number | null>;

export type MatchLogRow = {
  matchId: string;
  season: number;
  roundNumber: number;
  date: string; // ISO
  opponent: string;
  stats: MatchLogStats;
  statAvailability?: MatchLogStatAvailability;
};

export const MATCH_LOG_RECONCILIATION_STAT_KEYS = CANONICAL_STAT_KEYS;

export type MatchLogReconciliationStage = 'merged' | 'raw' | 'projection' | 'api';

export type MatchLogStageStat = {
  present: boolean;
  value: number | null;
  provenance: string | null;
};

export type MatchLogStageSnapshot = Record<CanonicalStatKey, MatchLogStageStat>;

export type MatchLogReconciliationIssueCode =
  | 'downstream_without_merged'
  | 'dropped_before_raw'
  | 'dropped_in_projection'
  | 'dropped_in_api'
  | 'raw_presence_mismatch'
  | 'projection_presence_mismatch'
  | 'api_presence_mismatch'
  | 'raw_value_mismatch'
  | 'projection_value_mismatch'
  | 'api_value_mismatch'
  | 'raw_provenance_mismatch';

export type MatchLogReconciliationIssue = {
  code: MatchLogReconciliationIssueCode;
  statKey: CanonicalStatKey;
  message: string;
};

export type MatchLogReconciliationRecord = {
  entityKey: string;
  matchId: string;
  season: number;
  roundNumber: number;
  playerId: string | null;
  playerName: string;
  opponent: string;
  stages: Record<MatchLogReconciliationStage, MatchLogStageSnapshot>;
  issues: MatchLogReconciliationIssue[];
};

export type MatchLogPopulatedStages = Partial<Record<MatchLogReconciliationStage, boolean>>;

function normalizeEntityKeyPart(value: string | number | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildMatchLogEntityKey(params: {
  season: number;
  roundNumber: number;
  playerName: string;
  opponent: string;
  playerId?: string | null;
  matchId?: string | null;
}): string {
  const canonicalMatchId = normalizeEntityKeyPart(params.matchId);
  const canonicalPlayerName = normalizeEntityKeyPart(params.playerName);
  const canonicalPlayerId = normalizeEntityKeyPart(params.playerId);

  if (canonicalPlayerId && canonicalMatchId) {
    return ['match', canonicalMatchId, 'player_id', canonicalPlayerId].join('|');
  }

  if (canonicalMatchId && canonicalPlayerName) {
    return ['match', canonicalMatchId, 'player', canonicalPlayerName].join('|');
  }

  return [
    params.season,
    params.roundNumber,
    normalizeEntityKeyPart(params.playerName),
    normalizeEntityKeyPart(params.opponent),
  ].join('|');
}

function isNullableStatKey(key: CanonicalStatKey): key is MatchLogNullableStatKey {
  return (MATCH_LOG_NULLABLE_STAT_KEYS as readonly string[]).includes(key);
}

export function buildEmptyMatchLogStageSnapshot(): MatchLogStageSnapshot {
  const snapshot = {} as MatchLogStageSnapshot;
  for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    snapshot[key] = {
      present: false,
      value: isNullableStatKey(key) ? null : 0,
      provenance: null,
    };
  }
  return snapshot;
}

function normalizeStageValue(
  key: CanonicalStatKey,
  value: number | null | undefined
): number | null {
  if (value == null) {
    return isNullableStatKey(key) ? null : 0;
  }
  return Number.isFinite(value) ? value : isNullableStatKey(key) ? null : 0;
}

export function buildMatchLogStageSnapshot(
  stats: Partial<Record<CanonicalStatKey, number | null | undefined>>,
  options?: {
    availability?: Partial<Record<CanonicalStatKey, boolean>>;
    provenance?: Partial<Record<CanonicalStatKey, string | null | undefined>>;
  }
): MatchLogStageSnapshot {
  const snapshot = buildEmptyMatchLogStageSnapshot();

  for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    const explicitAvailability = options?.availability?.[key];
    const rawValue = stats[key];
    const normalizedValue = normalizeStageValue(key, rawValue ?? undefined);
    const present =
      explicitAvailability ??
      (rawValue != null &&
        (isNullableStatKey(key) ? rawValue !== null : Number.isFinite(rawValue)));

    snapshot[key] = {
      present,
      value: present ? normalizedValue : isNullableStatKey(key) ? null : normalizedValue,
      provenance: options?.provenance?.[key] ?? null,
    };
  }

  return snapshot;
}

function stageValueDiffers(left: MatchLogStageStat, right: MatchLogStageStat): boolean {
  if (left.value === null || right.value === null) return left.value !== right.value;
  return Math.abs(left.value - right.value) > 0.0001;
}

function createIssue(
  code: MatchLogReconciliationIssueCode,
  statKey: CanonicalStatKey,
  message: string
): MatchLogReconciliationIssue {
  return { code, statKey, message };
}

export function classifyMatchLogReconciliationIssues(
  stages: Record<MatchLogReconciliationStage, MatchLogStageSnapshot>,
  options?: {
    populatedStages?: MatchLogPopulatedStages;
  }
): MatchLogReconciliationIssue[] {
  const issues: MatchLogReconciliationIssue[] = [];
  const populatedStages: Record<MatchLogReconciliationStage, boolean> = {
    merged: options?.populatedStages?.merged ?? true,
    raw: options?.populatedStages?.raw ?? true,
    projection: options?.populatedStages?.projection ?? true,
    api: options?.populatedStages?.api ?? true,
  };

  for (const statKey of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    const merged = stages.merged[statKey];
    const raw = stages.raw[statKey];
    const projection = stages.projection[statKey];
    const api = stages.api[statKey];
    const downstreamEnriched = isDownstreamEnrichedStatKey(statKey);

    const downstreamHasCoverage =
      (populatedStages.raw && raw.present) ||
      (populatedStages.projection && projection.present) ||
      (populatedStages.api && api.present);

    if (populatedStages.merged && !merged.present && downstreamHasCoverage && !downstreamEnriched) {
      issues.push(
        createIssue(
          'downstream_without_merged',
          statKey,
          `${statKey} appears downstream without authoritative merged ingest coverage`
        )
      );
    }

    if (populatedStages.merged && populatedStages.raw && merged.present && !raw.present) {
      issues.push(
        createIssue(
          'dropped_before_raw',
          statKey,
          `${statKey} present in merged ingest but missing from raw storage`
        )
      );
    }
    if (populatedStages.raw && populatedStages.projection && raw.present && !projection.present) {
      issues.push(
        createIssue(
          'dropped_in_projection',
          statKey,
          `${statKey} present in raw storage but missing from projection`
        )
      );
    }
    if (populatedStages.projection && populatedStages.api && projection.present && !api.present) {
      issues.push(
        createIssue(
          'dropped_in_api',
          statKey,
          `${statKey} present in projection but missing from API`
        )
      );
    }

    if (
      populatedStages.merged &&
      populatedStages.raw &&
      merged.present !== raw.present &&
      !(downstreamEnriched && !merged.present && raw.present)
    ) {
      issues.push(
        createIssue(
          'raw_presence_mismatch',
          statKey,
          `${statKey} presence differs between merged ingest and raw storage`
        )
      );
    }
    if (
      populatedStages.raw &&
      populatedStages.projection &&
      raw.present !== projection.present &&
      !(downstreamEnriched && !raw.present && projection.present)
    ) {
      issues.push(
        createIssue(
          'projection_presence_mismatch',
          statKey,
          `${statKey} presence differs between raw storage and projection`
        )
      );
    }
    if (populatedStages.projection && populatedStages.api && projection.present !== api.present) {
      issues.push(
        createIssue(
          'api_presence_mismatch',
          statKey,
          `${statKey} presence differs between projection and API`
        )
      );
    }

    if (
      populatedStages.merged &&
      populatedStages.raw &&
      merged.present &&
      raw.present &&
      stageValueDiffers(merged, raw)
    ) {
      issues.push(
        createIssue(
          'raw_value_mismatch',
          statKey,
          `${statKey} value differs between merged ingest and raw storage`
        )
      );
    }
    if (
      populatedStages.raw &&
      populatedStages.projection &&
      raw.present &&
      projection.present &&
      stageValueDiffers(raw, projection)
    ) {
      issues.push(
        createIssue(
          'projection_value_mismatch',
          statKey,
          `${statKey} value differs between raw storage and projection`
        )
      );
    }
    if (
      populatedStages.projection &&
      populatedStages.api &&
      projection.present &&
      api.present &&
      stageValueDiffers(projection, api)
    ) {
      issues.push(
        createIssue(
          'api_value_mismatch',
          statKey,
          `${statKey} value differs between projection and API`
        )
      );
    }

    if (
      populatedStages.merged &&
      populatedStages.raw &&
      merged.present &&
      raw.present &&
      merged.provenance &&
      raw.provenance &&
      merged.provenance !== raw.provenance
    ) {
      issues.push(
        createIssue(
          'raw_provenance_mismatch',
          statKey,
          `${statKey} provenance differs between merged ingest and raw storage`
        )
      );
    }
  }

  return issues;
}

const CANONICAL_MATCH_ID_RE = /^\d{4}-R[A-Z0-9]+-/;

function isCanonicalMatchId(matchId: string): boolean {
  return CANONICAL_MATCH_ID_RE.test(matchId);
}

function statNonZeroCount(stats: MatchLogStats): number {
  let count = 0;
  for (const value of Object.values(stats)) {
    if (typeof value === 'number' && value !== 0) {
      count += 1;
    }
  }
  return count;
}

function stableGameKey(row: MatchLogRow): string | null {
  const season = row.season;
  const matchId = row.matchId?.trim();
  if (season && matchId && isCanonicalMatchId(matchId)) {
    return `${season}|match|${matchId}`.toLowerCase();
  }

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
