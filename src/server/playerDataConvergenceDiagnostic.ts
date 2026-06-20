import { buildCanonicalPlayerId } from '@/lib/playerIdentity';

export type PlayerDataConvergenceSeverity = 'ok' | 'warning' | 'error';
export type PlayerDataMatchMethod = 'directId' | 'canonicalId' | 'nameTeam';

export type CanonicalPlayerRow = {
  id: string;
  name: string;
  team?: string | null;
  club?: string | null;
  position?: string | null;
};

export type PlayerDataSourceRecord = {
  id?: string | null;
  playerId?: string | null;
  player_uid?: string | null;
  playerName?: string | null;
  player_name?: string | null;
  name?: string | null;
  team?: string | null;
  club?: string | null;
  stats?: Record<string, unknown> | null;
  categories?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type PlayerDataConvergenceInput = {
  canonicalPlayers: readonly CanonicalPlayerRow[];
  sourceRecords: readonly PlayerDataSourceRecord[];
  rankingRecords?: readonly PlayerDataSourceRecord[];
  expectedCategoryKeys: readonly string[];
};

export type PlayerDataRecordMatch = {
  sourceIndex: number;
  sourceIdentity: string;
  canonicalPlayerId: string;
  method: PlayerDataMatchMethod;
};

export type PlayerDataUnmatchedCanonicalPlayer = {
  canonicalPlayerId: string;
  name: string;
  team?: string;
};

export type PlayerDataUnmatchedSourceRecord = {
  sourceIndex: number;
  sourceIdentity: string;
  name?: string;
  team?: string;
};

export type PlayerDataAmbiguousNameMatch = {
  sourceIndex: number;
  sourceIdentity: string;
  name: string;
  team?: string;
  candidatePlayerIds: string[];
};

export type PlayerDataDuplicateSourceIdentity = {
  sourceIdentity: string;
  sourceIndexes: number[];
};

export type PlayerDataMissingCategoryValue = {
  sourceIndex: number;
  sourceIdentity: string;
  category: string;
};

export type PlayerDataDeprecatedCategoryKey = {
  sourceIndex: number;
  sourceIdentity: string;
  key: string;
  suggestedKey: string;
};

export type PlayerDataCategoryCoverage = {
  category: string;
  present: number;
  missing: number;
};

export type PlayerDataConvergenceDiagnostic = {
  summary: {
    totalCanonicalPlayers: number;
    totalSourceStatRecords: number;
    totalRankingRecords: number;
    matchedRecordsByDirectId: number;
    matchedRecordsByCanonicalId: number;
    matchedRecordsByNormalizedNameTeam: number;
    unmatchedCanonicalPlayers: number;
    unmatchedSourceRecords: number;
    ambiguousNameMatches: number;
    duplicateSourceIdentities: number;
    missingExpectedCategoryValues: number;
    deprecatedCategoryKeys: number;
    severity: PlayerDataConvergenceSeverity;
  };
  matches: PlayerDataRecordMatch[];
  unmatchedCanonicalPlayers: PlayerDataUnmatchedCanonicalPlayer[];
  unmatchedSourceRecords: PlayerDataUnmatchedSourceRecord[];
  ambiguousNameMatches: PlayerDataAmbiguousNameMatch[];
  duplicateSourceIdentities: PlayerDataDuplicateSourceIdentity[];
  missingExpectedCategoryValues: PlayerDataMissingCategoryValue[];
  deprecatedCategoryKeys: PlayerDataDeprecatedCategoryKey[];
  categoryCoverage: PlayerDataCategoryCoverage[];
  recommendedNextAction: string;
};

const DEPRECATED_CATEGORY_KEYS: Record<string, string> = {
  contested_marks: 'contestedMarks',
  contested_possessions: 'contestedPossessions',
  effective_disposals: 'effectiveDisposals',
  goal_assists: 'goalAssists',
  inside_50s: 'inside50s',
  rebound_50s: 'rebound50s',
  score_involvements: 'scoreInvolvements',
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function readTeam(row: { team?: string | null; club?: string | null }): string | undefined {
  const team = row.team ?? row.club ?? undefined;
  const normalized = normalizeText(team);
  return normalized ? team?.trim() : undefined;
}

function readSourceName(record: PlayerDataSourceRecord): string | undefined {
  const name = record.player_name ?? record.playerName ?? record.name ?? undefined;
  const normalized = normalizeText(name);
  return normalized ? name?.trim() : undefined;
}

function readSourceId(record: PlayerDataSourceRecord): string | undefined {
  const id = record.playerId ?? record.player_uid ?? record.id ?? undefined;
  const trimmed = String(id ?? '').trim();
  return trimmed || undefined;
}

function nameTeamKey(name: string | undefined, team: string | undefined): string | undefined {
  const normalizedName = normalizeText(name);
  const normalizedTeam = normalizeText(team);
  return normalizedName && normalizedTeam ? `${normalizedName}|${normalizedTeam}` : undefined;
}

function sourceIdentity(record: PlayerDataSourceRecord): string {
  const directId = readSourceId(record);
  if (directId) return directId;

  const name = readSourceName(record);
  const team = readTeam(record);
  const nameAndTeam = nameTeamKey(name, team);
  if (nameAndTeam) return nameAndTeam;
  if (name) return buildCanonicalPlayerId(name);
  return 'unknown_source_record';
}

function readCategoryValue(record: PlayerDataSourceRecord, category: string): unknown {
  if (record.categories && category in record.categories) return record.categories[category];
  if (record.stats && category in record.stats) return record.stats[category];
  return record[category];
}

function hasCategoryValue(record: PlayerDataSourceRecord, category: string): boolean {
  const value = readCategoryValue(record, category);
  return value !== null && value !== undefined && value !== '';
}

function categoryKeys(record: PlayerDataSourceRecord): string[] {
  const keys = new Set<string>();
  for (const key of Object.keys(record)) keys.add(key);
  for (const key of Object.keys(record.stats ?? {})) keys.add(key);
  for (const key of Object.keys(record.categories ?? {})) keys.add(key);
  return [...keys];
}

function buildCanonicalIndexes(canonicalPlayers: readonly CanonicalPlayerRow[]) {
  const byDirectId = new Map<string, CanonicalPlayerRow>();
  const byCanonicalId = new Map<string, CanonicalPlayerRow>();
  const byNameTeam = new Map<string, CanonicalPlayerRow>();
  const byName = new Map<string, CanonicalPlayerRow[]>();

  for (const player of canonicalPlayers) {
    byDirectId.set(player.id, player);
    byCanonicalId.set(buildCanonicalPlayerId(player.id), player);
    byCanonicalId.set(buildCanonicalPlayerId(player.name), player);

    const team = readTeam(player);
    const key = nameTeamKey(player.name, team);
    if (key) byNameTeam.set(key, player);

    const normalizedName = normalizeText(player.name);
    if (!normalizedName) continue;
    const candidates = byName.get(normalizedName) ?? [];
    candidates.push(player);
    byName.set(normalizedName, candidates);
  }

  return { byDirectId, byCanonicalId, byNameTeam, byName };
}

function severityFor(input: {
  ambiguousNameMatches: number;
  unmatchedSourceRecords: number;
  unmatchedCanonicalPlayers: number;
  duplicateSourceIdentities: number;
  missingExpectedCategoryValues: number;
  deprecatedCategoryKeys: number;
}): PlayerDataConvergenceSeverity {
  if (input.ambiguousNameMatches > 0 || input.unmatchedSourceRecords > 0) {
    return 'error';
  }

  if (
    input.unmatchedCanonicalPlayers > 0 ||
    input.duplicateSourceIdentities > 0 ||
    input.missingExpectedCategoryValues > 0 ||
    input.deprecatedCategoryKeys > 0
  ) {
    return 'warning';
  }

  return 'ok';
}

function recommendNextAction(severity: PlayerDataConvergenceSeverity): string {
  if (severity === 'error') {
    return 'Resolve identity ambiguity and unmatched source records before any dry-run or write-capable convergence work.';
  }

  if (severity === 'warning') {
    return 'Review warnings with source evidence, then run a temp DB dry-run only after deterministic repairs are defined.';
  }

  return 'No convergence blockers detected in these in-memory fixtures; Phase 2 temp DB dry-run can be planned when real data is loaded safely.';
}

type CanonicalIndexes = ReturnType<typeof buildCanonicalIndexes>;

type DiagnosticAccumulator = {
  matches: PlayerDataRecordMatch[];
  unmatchedSourceRecords: PlayerDataUnmatchedSourceRecord[];
  ambiguousNameMatches: PlayerDataAmbiguousNameMatch[];
  missingExpectedCategoryValues: PlayerDataMissingCategoryValue[];
  deprecatedCategoryKeys: PlayerDataDeprecatedCategoryKey[];
  sourceIdentityIndexes: Map<string, number[]>;
  matchedCanonicalIds: Set<string>;
  categoryCoverageCounts: Map<string, number>;
};

function createAccumulator(expectedCategoryKeys: readonly string[]): DiagnosticAccumulator {
  return {
    matches: [],
    unmatchedSourceRecords: [],
    ambiguousNameMatches: [],
    missingExpectedCategoryValues: [],
    deprecatedCategoryKeys: [],
    sourceIdentityIndexes: new Map<string, number[]>(),
    matchedCanonicalIds: new Set<string>(),
    categoryCoverageCounts: new Map(expectedCategoryKeys.map((key) => [key, 0])),
  };
}

function trackSourceIdentity(
  sourceIdentityIndexes: Map<string, number[]>,
  identity: string,
  sourceIndex: number
): void {
  const identityIndexes = sourceIdentityIndexes.get(identity) ?? [];
  identityIndexes.push(sourceIndex);
  sourceIdentityIndexes.set(identity, identityIndexes);
}

function collectCategoryDiagnostics(
  record: PlayerDataSourceRecord,
  sourceIndex: number,
  identity: string,
  expectedCategoryKeys: readonly string[],
  accumulator: DiagnosticAccumulator
): void {
  for (const category of expectedCategoryKeys) {
    if (hasCategoryValue(record, category)) {
      accumulator.categoryCoverageCounts.set(
        category,
        (accumulator.categoryCoverageCounts.get(category) ?? 0) + 1
      );
    } else {
      accumulator.missingExpectedCategoryValues.push({
        sourceIndex,
        sourceIdentity: identity,
        category,
      });
    }
  }

  for (const key of categoryKeys(record)) {
    const suggestedKey = DEPRECATED_CATEGORY_KEYS[key];
    if (suggestedKey && expectedCategoryKeys.includes(suggestedKey)) {
      accumulator.deprecatedCategoryKeys.push({
        sourceIndex,
        sourceIdentity: identity,
        key,
        suggestedKey,
      });
    }
  }
}

function findRecordMatch(
  sourceId: string | undefined,
  name: string | undefined,
  team: string | undefined,
  indexes: CanonicalIndexes
): { player: CanonicalPlayerRow; method: PlayerDataMatchMethod } | undefined {
  const directMatch = sourceId ? indexes.byDirectId.get(sourceId) : undefined;
  if (directMatch) return { player: directMatch, method: 'directId' };

  const canonicalId = sourceId ? buildCanonicalPlayerId(sourceId) : undefined;
  const canonicalMatch = canonicalId ? indexes.byCanonicalId.get(canonicalId) : undefined;
  if (canonicalMatch) return { player: canonicalMatch, method: 'canonicalId' };

  const exactNameTeamKey = nameTeamKey(name, team);
  const nameTeamMatch = exactNameTeamKey ? indexes.byNameTeam.get(exactNameTeamKey) : undefined;
  if (nameTeamMatch) return { player: nameTeamMatch, method: 'nameTeam' };

  return undefined;
}

function collectMatchDiagnostics(
  record: PlayerDataSourceRecord,
  sourceIndex: number,
  identity: string,
  indexes: CanonicalIndexes,
  accumulator: DiagnosticAccumulator
): void {
  const sourceId = readSourceId(record);
  const name = readSourceName(record);
  const team = readTeam(record);
  const match = findRecordMatch(sourceId, name, team, indexes);

  if (match) {
    accumulator.matches.push({
      sourceIndex,
      sourceIdentity: identity,
      canonicalPlayerId: match.player.id,
      method: match.method,
    });
    accumulator.matchedCanonicalIds.add(match.player.id);
    return;
  }

  const nameCandidates = indexes.byName.get(normalizeText(name));
  if (nameCandidates && nameCandidates.length > 1) {
    accumulator.ambiguousNameMatches.push({
      sourceIndex,
      sourceIdentity: identity,
      name: name ?? '',
      team,
      candidatePlayerIds: nameCandidates.map((player) => player.id),
    });
    return;
  }

  accumulator.unmatchedSourceRecords.push({ sourceIndex, sourceIdentity: identity, name, team });
}

function collectSourceRecordDiagnostics(
  record: PlayerDataSourceRecord,
  sourceIndex: number,
  expectedCategoryKeys: readonly string[],
  indexes: CanonicalIndexes,
  accumulator: DiagnosticAccumulator
): void {
  const identity = sourceIdentity(record);
  trackSourceIdentity(accumulator.sourceIdentityIndexes, identity, sourceIndex);
  collectCategoryDiagnostics(record, sourceIndex, identity, expectedCategoryKeys, accumulator);
  collectMatchDiagnostics(record, sourceIndex, identity, indexes, accumulator);
}

export function diagnosePlayerDataConvergence(
  input: PlayerDataConvergenceInput
): PlayerDataConvergenceDiagnostic {
  const indexes = buildCanonicalIndexes(input.canonicalPlayers);
  const sourceRecords = [...input.sourceRecords, ...(input.rankingRecords ?? [])];
  const totalRankingRecords = input.rankingRecords?.length ?? 0;
  const accumulator = createAccumulator(input.expectedCategoryKeys);

  sourceRecords.forEach((record, sourceIndex) => {
    collectSourceRecordDiagnostics(
      record,
      sourceIndex,
      input.expectedCategoryKeys,
      indexes,
      accumulator
    );
  });

  const duplicateSourceIdentities = [...accumulator.sourceIdentityIndexes.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([identity, indexes]) => ({ sourceIdentity: identity, sourceIndexes: indexes }));
  const unmatchedCanonicalPlayers = input.canonicalPlayers
    .filter((player) => !accumulator.matchedCanonicalIds.has(player.id))
    .map((player) => ({
      canonicalPlayerId: player.id,
      name: player.name,
      team: readTeam(player),
    }));
  const categoryCoverage = input.expectedCategoryKeys.map((category) => {
    const present = accumulator.categoryCoverageCounts.get(category) ?? 0;
    return {
      category,
      present,
      missing: sourceRecords.length - present,
    };
  });
  const matchedRecordsByDirectId = accumulator.matches.filter(
    (match) => match.method === 'directId'
  ).length;
  const matchedRecordsByCanonicalId = accumulator.matches.filter(
    (match) => match.method === 'canonicalId'
  ).length;
  const matchedRecordsByNormalizedNameTeam = accumulator.matches.filter(
    (match) => match.method === 'nameTeam'
  ).length;
  const severity = severityFor({
    ambiguousNameMatches: accumulator.ambiguousNameMatches.length,
    unmatchedSourceRecords: accumulator.unmatchedSourceRecords.length,
    unmatchedCanonicalPlayers: unmatchedCanonicalPlayers.length,
    duplicateSourceIdentities: duplicateSourceIdentities.length,
    missingExpectedCategoryValues: accumulator.missingExpectedCategoryValues.length,
    deprecatedCategoryKeys: accumulator.deprecatedCategoryKeys.length,
  });

  return {
    summary: {
      totalCanonicalPlayers: input.canonicalPlayers.length,
      totalSourceStatRecords: input.sourceRecords.length,
      totalRankingRecords,
      matchedRecordsByDirectId,
      matchedRecordsByCanonicalId,
      matchedRecordsByNormalizedNameTeam,
      unmatchedCanonicalPlayers: unmatchedCanonicalPlayers.length,
      unmatchedSourceRecords: accumulator.unmatchedSourceRecords.length,
      ambiguousNameMatches: accumulator.ambiguousNameMatches.length,
      duplicateSourceIdentities: duplicateSourceIdentities.length,
      missingExpectedCategoryValues: accumulator.missingExpectedCategoryValues.length,
      deprecatedCategoryKeys: accumulator.deprecatedCategoryKeys.length,
      severity,
    },
    matches: accumulator.matches,
    unmatchedCanonicalPlayers,
    unmatchedSourceRecords: accumulator.unmatchedSourceRecords,
    ambiguousNameMatches: accumulator.ambiguousNameMatches,
    duplicateSourceIdentities,
    missingExpectedCategoryValues: accumulator.missingExpectedCategoryValues,
    deprecatedCategoryKeys: accumulator.deprecatedCategoryKeys,
    categoryCoverage,
    recommendedNextAction: recommendNextAction(severity),
  };
}
