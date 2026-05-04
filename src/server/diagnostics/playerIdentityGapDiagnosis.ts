import { normalizeLookupPart, normalizeTeamLookup } from '@shared/player-identity/playerMatchStats';
import type {
  PlayerIdentityDirectory,
  PlayerIdentityInput,
  PlayerIdentityResolution,
} from '@shared/player-identity/playerIdentityResolver';

export type IdentityGapClassification =
  | 'canonical_player_id_ok'
  | 'missing_player_id_resolvable'
  | 'missing_player_id_unresolved'
  | 'player_id_not_in_prisma'
  | 'ambiguous_or_quarantined'
  | 'match_context_issue';

export type DiagnosticFirestoreRow = {
  docId: string;
  data: Record<string, unknown>;
};

export type DiagnosticPlayer = {
  id: string;
  name: string;
  club: string;
  position: string | null;
};

export type DiagnosticPlayerDirectory = PlayerIdentityDirectory;

export type DiagnosticUnresolvedRow = {
  source: string;
  sourceDocumentId: string;
  season: number;
  round: number | null;
  playerName: string;
  normalizedPlayerName: string;
  team: string | null;
  normalizedTeam: string | null;
  status: string;
  candidatePlayerIdsJson: string | null;
};

export type IdentityGapDiagnosticRow = {
  doc_id: string;
  season: number | null;
  round: number | null;
  match_id: string | null;
  storage_match_id: string | null;
  player_name: string | null;
  team: string | null;
  opponent: string | null;
  stored_player_id: string | null;
  classification: IdentityGapClassification;
  secondary_flags: string[];
  resolved_player_id: string | null;
  resolved_player_name: string | null;
  candidate_player_ids: string[];
  unresolved_queue_statuses: string[];
  source: string | null;
  has_canonical_stats: boolean;
  has_raw_row: boolean;
  updated_at: string | null;
};

export type IdentityGapDiagnosticSummary = {
  ok: true;
  season: number;
  rounds: number[];
  firestoreRowCount: number;
  classificationCounts: Record<IdentityGapClassification, number>;
  assertionCounts: {
    rowsWithRound: number;
    rowsWithMatchContext: number;
    rowsWithStoredPlayerId: number;
    rowsWithStoredPlayerIdInPrisma: number;
    rowsResolverResolved: number;
    rowsWithUnresolvedQueueEvidence: number;
  };
  topGroups: Array<{
    classification: IdentityGapClassification;
    playerName: string | null;
    team: string | null;
    matchId: string | null;
    source: string | null;
    count: number;
    sampleDocumentIds: string[];
  }>;
  sampleRows: IdentityGapDiagnosticRow[];
  supportingVerifierCommand: string;
  generatedAt: string;
};

export type IdentityGapDiagnosticResult = {
  summary: IdentityGapDiagnosticSummary;
  rows: IdentityGapDiagnosticRow[];
};

export type ClassifyIdentityGapRowsInput = {
  season: number;
  rounds: number[];
  rows: DiagnosticFirestoreRow[];
  directory: DiagnosticPlayerDirectory;
  unresolvedRows: DiagnosticUnresolvedRow[];
  resolveIdentity(input: PlayerIdentityInput): PlayerIdentityResolution;
  limit: number;
  generatedAt?: Date;
};

const CLASSIFICATIONS: IdentityGapClassification[] = [
  'canonical_player_id_ok',
  'missing_player_id_resolvable',
  'missing_player_id_unresolved',
  'player_id_not_in_prisma',
  'ambiguous_or_quarantined',
  'match_context_issue',
];

function emptyClassificationCounts(): Record<IdentityGapClassification, number> {
  return Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0])) as Record<
    IdentityGapClassification,
    number
  >;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readStoredPlayerId(data: Record<string, unknown>): string | null {
  return readString(data.player_id) ?? readString(data.playerId);
}

function readRound(data: Record<string, unknown>): number | null {
  return readNumber(data.round_number ?? data.round ?? data.match_round);
}

function readSeason(data: Record<string, unknown>, fallbackSeason: number): number | null {
  return readNumber(data.season ?? data.year) ?? fallbackSeason;
}

function readMatchId(data: Record<string, unknown>): string | null {
  return (
    readString(data.match_id) ??
    readString(data.matchId) ??
    readString(data.match_uid) ??
    readString(data.matchUid)
  );
}

function readRawRow(data: Record<string, unknown>): Record<string, unknown> {
  return data.raw_row && typeof data.raw_row === 'object'
    ? (data.raw_row as Record<string, unknown>)
    : {};
}

function readPlayerName(data: Record<string, unknown>): string | null {
  const rawRow = readRawRow(data);
  return readString(data.player_name) ?? readString(data.playerName) ?? readString(rawRow.player_name);
}

function readTeam(data: Record<string, unknown>): string | null {
  const rawRow = readRawRow(data);
  return readString(data.team) ?? readString(data.club) ?? readString(rawRow.team);
}

function readOpponent(data: Record<string, unknown>): string | null {
  const rawRow = readRawRow(data);
  return readString(data.opponent) ?? readString(rawRow.opponent);
}

function readSource(data: Record<string, unknown>): string | null {
  return readString(data.source) ?? readString(data.stat_source);
}

function readUpdatedAt(data: Record<string, unknown>): string | null {
  const value = data.updated_at ?? data.updatedAt ?? data.last_seen_at ?? data.lastSeenAt;
  if (value instanceof Date) return value.toISOString();
  return readString(value);
}

function hasCanonicalStats(data: Record<string, unknown>): boolean {
  return Boolean(data.canonical_stats && typeof data.canonical_stats === 'object');
}

function hasRawRow(data: Record<string, unknown>): boolean {
  return Boolean(data.raw_row && typeof data.raw_row === 'object');
}

function findUnresolvedEvidence(
  unresolvedRows: DiagnosticUnresolvedRow[],
  params: {
    docId: string;
    source: string | null;
    season: number | null;
    round: number | null;
    playerName: string | null;
    team: string | null;
  }
): DiagnosticUnresolvedRow[] {
  const normalizedName = params.playerName ? normalizeLookupPart(params.playerName) : '';
  const normalizedTeam = params.team ? normalizeTeamLookup(params.team) : '';

  return unresolvedRows.filter((row) => {
    if (params.source && row.source !== params.source) return false;
    if (params.season != null && row.season !== params.season) return false;
    if (row.sourceDocumentId === params.docId && params.source && row.source === params.source) {
      return true;
    }
    if (params.round != null && row.round != null && row.round !== params.round) return false;
    if (normalizedName && row.normalizedPlayerName !== normalizedName) return false;
    if (normalizedTeam && row.normalizedTeam && row.normalizedTeam !== normalizedTeam) return false;
    return Boolean(normalizedName);
  });
}

function readCandidateIds(
  resolution: PlayerIdentityResolution | null,
  unresolvedEvidence: DiagnosticUnresolvedRow[]
): string[] {
  const candidates = new Set<string>();
  resolution?.candidates.forEach((candidate) => candidates.add(candidate));

  for (const row of unresolvedEvidence) {
    if (!row.candidatePlayerIdsJson) continue;

    try {
      const parsed = JSON.parse(row.candidatePlayerIdsJson);
      if (Array.isArray(parsed)) {
        parsed.forEach((candidate) => {
          if (typeof candidate === 'string' && candidate.trim()) {
            candidates.add(candidate.trim());
          }
        });
      }
    } catch {
      candidates.add('invalid_candidate_json');
    }
  }

  return Array.from(candidates).sort();
}

function classifyRow(
  input: ClassifyIdentityGapRowsInput,
  row: DiagnosticFirestoreRow
): IdentityGapDiagnosticRow {
  const data = row.data;
  const season = readSeason(data, input.season);
  const round = readRound(data);
  const matchId = readMatchId(data);
  const storageMatchId = readString(data.storage_match_id) ?? matchId;
  const playerName = readPlayerName(data);
  const team = readTeam(data);
  const opponent = readOpponent(data);
  const source = readSource(data);
  const storedPlayerId = readStoredPlayerId(data);
  const secondaryFlags = new Set<string>();

  if (round == null) secondaryFlags.add('missing_round');
  if (!matchId && !storageMatchId) secondaryFlags.add('missing_match_context');
  if (hasCanonicalStats(data)) secondaryFlags.add('has_canonical_stats');
  if (hasRawRow(data)) secondaryFlags.add('has_raw_row');

  const unresolvedEvidence = findUnresolvedEvidence(input.unresolvedRows, {
    docId: row.docId,
    source,
    season,
    round,
    playerName,
    team,
  });
  if (unresolvedEvidence.length > 0) secondaryFlags.add('has_unresolved_queue_match');

  let resolution: PlayerIdentityResolution | null = null;
  if (!storedPlayerId && playerName) {
    resolution = input.resolveIdentity({
      playerName,
      team,
      season,
      source,
      sourceDocumentId: row.docId,
      round,
      rawPayload: data,
    });

    if (resolution.outcome === 'resolved') {
      secondaryFlags.add(`resolver_matched_by_${resolution.matchedBy}`);
    }
  }

  let classification: IdentityGapClassification;
  let resolvedPlayerId: string | null = null;
  let resolvedPlayerName: string | null = null;

  if (round == null || !input.rounds.includes(round) || (!matchId && !storageMatchId)) {
    classification = 'match_context_issue';
  } else if (storedPlayerId && input.directory.playersById.has(storedPlayerId)) {
    const player = input.directory.playersById.get(storedPlayerId)!;
    classification = 'canonical_player_id_ok';
    resolvedPlayerId = player.id;
    resolvedPlayerName = player.name;
  } else if (storedPlayerId) {
    classification = 'player_id_not_in_prisma';
  } else if (resolution?.outcome === 'resolved') {
    classification = 'missing_player_id_resolvable';
    resolvedPlayerId = resolution.playerId;
    resolvedPlayerName = resolution.playerName;
  } else if (unresolvedEvidence.length > 0 || resolution?.outcome === 'ambiguous') {
    classification = 'ambiguous_or_quarantined';
  } else {
    classification = 'missing_player_id_unresolved';
  }

  return {
    doc_id: row.docId,
    season,
    round,
    match_id: matchId,
    storage_match_id: storageMatchId,
    player_name: playerName,
    team,
    opponent,
    stored_player_id: storedPlayerId,
    classification,
    secondary_flags: Array.from(secondaryFlags).sort(),
    resolved_player_id: resolvedPlayerId,
    resolved_player_name: resolvedPlayerName,
    candidate_player_ids: readCandidateIds(resolution, unresolvedEvidence),
    unresolved_queue_statuses: Array.from(
      new Set(unresolvedEvidence.map((entry) => entry.status))
    ).sort(),
    source,
    has_canonical_stats: hasCanonicalStats(data),
    has_raw_row: hasRawRow(data),
    updated_at: readUpdatedAt(data),
  };
}

function buildTopGroups(rows: IdentityGapDiagnosticRow[], limit: number) {
  const groups = new Map<
    string,
    {
      classification: IdentityGapClassification;
      playerName: string | null;
      team: string | null;
      matchId: string | null;
      source: string | null;
      count: number;
      sampleDocumentIds: string[];
    }
  >();

  for (const row of rows) {
    const key = [
      row.classification,
      row.player_name ?? '',
      row.team ?? '',
      row.match_id ?? row.storage_match_id ?? '',
      row.source ?? '',
    ].join('|');
    const existing = groups.get(key) ?? {
      classification: row.classification,
      playerName: row.player_name,
      team: row.team,
      matchId: row.match_id ?? row.storage_match_id,
      source: row.source,
      count: 0,
      sampleDocumentIds: [],
    };

    existing.count += 1;
    if (existing.sampleDocumentIds.length < 5) existing.sampleDocumentIds.push(row.doc_id);
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .sort(
      (left, right) =>
        right.count - left.count || left.classification.localeCompare(right.classification)
    )
    .slice(0, limit);
}

export function classifyIdentityGapRows(
  input: ClassifyIdentityGapRowsInput
): IdentityGapDiagnosticResult {
  const rows = input.rows.map((row) => classifyRow(input, row));
  const classificationCounts = emptyClassificationCounts();

  for (const row of rows) {
    classificationCounts[row.classification] += 1;
  }

  const summary: IdentityGapDiagnosticSummary = {
    ok: true,
    season: input.season,
    rounds: input.rounds,
    firestoreRowCount: input.rows.length,
    classificationCounts,
    assertionCounts: {
      rowsWithRound: rows.filter((row) => row.round != null).length,
      rowsWithMatchContext: rows.filter(
        (row) => row.match_id != null || row.storage_match_id != null
      ).length,
      rowsWithStoredPlayerId: rows.filter((row) => row.stored_player_id != null).length,
      rowsWithStoredPlayerIdInPrisma: rows.filter(
        (row) => row.classification === 'canonical_player_id_ok'
      ).length,
      rowsResolverResolved: rows.filter(
        (row) => row.classification === 'missing_player_id_resolvable'
      ).length,
      rowsWithUnresolvedQueueEvidence: rows.filter(
        (row) => row.unresolved_queue_statuses.length > 0
      ).length,
    },
    topGroups: buildTopGroups(rows, input.limit),
    sampleRows: rows.slice(0, input.limit),
    supportingVerifierCommand: `npx tsx Scripts/verify-player-read-models.ts --season=${input.season} --rounds=${input.rounds.join(',')} --include-merged-live --json`,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
  };

  return { summary, rows };
}
