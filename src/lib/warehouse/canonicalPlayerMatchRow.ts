import {
  hasFootywireCanonicalRawMatchContract,
  readFootywireCanonicalStatNumber,
  readFootywireCanonicalStatPresence,
  readFootywireCanonicalStatProvenance,
  type FootywireCanonicalRawMatchContract,
} from '@/lib/stats/footywireCanonicalContract';
import {
  CANONICAL_STAT_KEYS,
  type CanonicalStatKey,
} from '@/lib/stats/statColumns';

export type FirestoreCanonicalPlayerMatchDocument = {
  id: string;
  match_id?: unknown;
  matchUid?: unknown;
  match_uid?: unknown;
  player_id?: unknown;
  season?: unknown;
  round?: unknown;
  round_number?: unknown;
  player_name?: unknown;
  team?: unknown;
  opposition?: unknown;
  match_date?: unknown;
  date?: unknown;
  data_source?: unknown;
  raw_checksum?: unknown;
  canonical_stats?: unknown;
  canonical_match_metadata?: unknown;
  last_seen_at?: unknown;
  last_updated?: unknown;
};

export type CanonicalPlayerMatchWarehouseRow = {
  firestoreDocId: string;
  contractVersion: number;
  matchId: string;
  playerId: string;
  season: number;
  roundNumber: number;
  playerName: string;
  playerClub: string;
  opponent: string;
  matchDate: string;
  startTimeUtc: string | null;
  venue: string | null;
  matchStatus: string | null;
  dataSource: string | null;
  rawChecksum: string | null;
  statsJson: string;
  availabilityJson: string;
  provenanceJson: string;
} & Record<CanonicalStatKey, number> &
  Record<`${CanonicalStatKey}Present`, boolean> &
  Record<`${CanonicalStatKey}Provenance`, string | null>;

function readRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  throw new Error(`${field} is required for warehouse export`);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readRequiredNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${field} is required for warehouse export`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasWarehouseCanonicalRawMatchContract(
  value: unknown
): value is FootywireCanonicalRawMatchContract {
  return (
    hasFootywireCanonicalRawMatchContract(value) &&
    isRecord(value.stats) &&
    isRecord(value.availability) &&
    isRecord(value.provenance)
  );
}

function readCanonicalMatchMetadata(
  data: FirestoreCanonicalPlayerMatchDocument,
  key: string
): unknown {
  const metadata = data.canonical_match_metadata;
  if (metadata == null || typeof metadata !== 'object') return undefined;

  return (metadata as Record<string, unknown>)[key];
}

function buildStatColumns(
  canonicalStats: FootywireCanonicalRawMatchContract
): Record<CanonicalStatKey, number> &
  Record<`${CanonicalStatKey}Present`, boolean> &
  Record<`${CanonicalStatKey}Provenance`, string | null> {
  const columns = {} as Record<CanonicalStatKey, number> &
    Record<`${CanonicalStatKey}Present`, boolean> &
    Record<`${CanonicalStatKey}Provenance`, string | null>;

  for (const key of CANONICAL_STAT_KEYS) {
    columns[key] = readFootywireCanonicalStatNumber(canonicalStats, key).value;
    columns[`${key}Present`] = readFootywireCanonicalStatPresence(
      canonicalStats,
      key
    ).hasValue;
    columns[`${key}Provenance`] = readFootywireCanonicalStatProvenance(
      canonicalStats,
      key
    );
  }

  return columns;
}

export function buildCanonicalPlayerMatchWarehouseRow(
  data: FirestoreCanonicalPlayerMatchDocument
): CanonicalPlayerMatchWarehouseRow {
  if (!hasWarehouseCanonicalRawMatchContract(data.canonical_stats)) {
    throw new Error('canonical_stats contract is required for warehouse export');
  }

  const canonicalStats = data.canonical_stats;

  return {
    firestoreDocId: readRequiredString(data.id, 'id'),
    contractVersion: canonicalStats.version,
    matchId: readRequiredString(
      data.match_id ?? data.matchUid ?? data.match_uid,
      'match_id'
    ),
    playerId: readRequiredString(data.player_id, 'player_id'),
    season: readRequiredNumber(data.season, 'season'),
    roundNumber: readRequiredNumber(
      data.round_number ?? data.round,
      'round_number'
    ),
    playerName: readRequiredString(data.player_name, 'player_name'),
    playerClub: readRequiredString(data.team, 'team'),
    opponent: readRequiredString(data.opposition, 'opposition'),
    matchDate: readRequiredString(
      readCanonicalMatchMetadata(data, 'match_date') ??
        data.match_date ??
        data.date,
      'match_date'
    ),
    startTimeUtc: readOptionalString(
      readCanonicalMatchMetadata(data, 'start_time_utc')
    ),
    venue: readOptionalString(readCanonicalMatchMetadata(data, 'venue')),
    matchStatus: readOptionalString(readCanonicalMatchMetadata(data, 'status')),
    dataSource: readOptionalString(data.data_source),
    rawChecksum: readOptionalString(data.raw_checksum),
    statsJson: JSON.stringify(canonicalStats.stats),
    availabilityJson: JSON.stringify(canonicalStats.availability),
    provenanceJson: JSON.stringify(canonicalStats.provenance),
    ...buildStatColumns(canonicalStats),
  };
}
