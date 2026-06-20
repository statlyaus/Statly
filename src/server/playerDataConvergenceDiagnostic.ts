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

export function diagnosePlayerDataConvergence(
  input: PlayerDataConvergenceInput
): PlayerDataConvergenceDiagnostic {
  const indexes = buildCanonicalIndexes(input.canonicalPlayers);
  const sourceRecords = [...input.sourceRecords, ...(input.rankingRecords ?? [])];
  const totalRankingRecords = input.rankingRecords?.length ?? 0;
  const matches: PlayerDataRecordMatch[] = [];
  const unmatchedSourceRecords: PlayerDataUnmatchedSourceRecord[] = [];
  const ambiguousNameMatches: PlayerDataAmbiguousNameMatch[] = [];
  const missingExpectedCategoryValues: PlayerDataMissingCategoryValue[] = [];
  const deprecatedCategoryKeys: PlayerDataDeprecatedCategoryKey[] = [];
  const sourceIdentityIndexes = new Map<string, number[]>();
  const matchedCanonicalIds = new Set<string>();
  const categoryCoverageCounts = new Map(input.expectedCategoryKeys.map((key) => [key, 0]));

  sourceRecords.forEach((record, sourceIndex) => {
    const identity = sourceIdentity(record);
    const sourceId = readSourceId(record);
    const name = readSourceName(record);
    const team = readTeam(record);
    const identityIndexes = sourceIdentityIndexes.get(identity) ?? [];
    identityIndexes.push(sourceIndex);
    sourceIdentityIndexes.set(identity, identityIndexes);

    for (const category of input.expectedCategoryKeys) {
      if (hasCategoryValue(record, category)) {
        categoryCoverageCounts.set(category, (categoryCoverageCounts.get(category) ?? 0) + 1);
      } else {
        missingExpectedCategoryValues.push({ sourceIndex, sourceIdentity: identity, category });
      }
    }

    for (const key of categoryKeys(record)) {
      const suggestedKey = DEPRECATED_CATEGORY_KEYS[key];
      if (suggestedKey && input.expectedCategoryKeys.includes(suggestedKey)) {
        deprecatedCategoryKeys.push({ sourceIndex, sourceIdentity: identity, key, suggestedKey });
      }
    }

    const directMatch = sourceId ? indexes.byDirectId.get(sourceId) : undefined;
    if (directMatch) {
      matches.push({
        sourceIndex,
        sourceIdentity: identity,
        canonicalPlayerId: directMatch.id,
        method: 'directId',
      });
      matchedCanonicalIds.add(directMatch.id);
      return;
    }

    const canonicalCandidates = [sourceId ? buildCanonicalPlayerId(sourceId) : undefined].filter(
      (value): value is string => Boolean(value)
    );
    const canonicalMatch = canonicalCandidates
      .map((candidate) => indexes.byCanonicalId.get(candidate))
      .find((candidate): candidate is CanonicalPlayerRow => Boolean(candidate));

    if (canonicalMatch) {
      matches.push({
        sourceIndex,
        sourceIdentity: identity,
        canonicalPlayerId: canonicalMatch.id,
        method: 'canonicalId',
      });
      matchedCanonicalIds.add(canonicalMatch.id);
      return;
    }

    const exactNameTeamKey = nameTeamKey(name, team);
    const nameTeamMatch = exactNameTeamKey ? indexes.byNameTeam.get(exactNameTeamKey) : undefined;
    if (nameTeamMatch) {
      matches.push({
        sourceIndex,
        sourceIdentity: identity,
        canonicalPlayerId: nameTeamMatch.id,
        method: 'nameTeam',
      });
      matchedCanonicalIds.add(nameTeamMatch.id);
      return;
    }

    const nameCandidates = indexes.byName.get(normalizeText(name));
    if (nameCandidates && nameCandidates.length > 1) {
      ambiguousNameMatches.push({
        sourceIndex,
        sourceIdentity: identity,
        name: name ?? '',
        team,
        candidatePlayerIds: nameCandidates.map((player) => player.id),
      });
      return;
    }

    unmatchedSourceRecords.push({ sourceIndex, sourceIdentity: identity, name, team });
  });

  const duplicateSourceIdentities = [...sourceIdentityIndexes.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([identity, indexes]) => ({ sourceIdentity: identity, sourceIndexes: indexes }));
  const unmatchedCanonicalPlayers = input.canonicalPlayers
    .filter((player) => !matchedCanonicalIds.has(player.id))
    .map((player) => ({
      canonicalPlayerId: player.id,
      name: player.name,
      team: readTeam(player),
    }));
  const categoryCoverage = input.expectedCategoryKeys.map((category) => {
    const present = categoryCoverageCounts.get(category) ?? 0;
    return {
      category,
      present,
      missing: sourceRecords.length - present,
    };
  });
  const matchedRecordsByDirectId = matches.filter((match) => match.method === 'directId').length;
  const matchedRecordsByCanonicalId = matches.filter(
    (match) => match.method === 'canonicalId'
  ).length;
  const matchedRecordsByNormalizedNameTeam = matches.filter(
    (match) => match.method === 'nameTeam'
  ).length;
  const severity = severityFor({
    ambiguousNameMatches: ambiguousNameMatches.length,
    unmatchedSourceRecords: unmatchedSourceRecords.length,
    unmatchedCanonicalPlayers: unmatchedCanonicalPlayers.length,
    duplicateSourceIdentities: duplicateSourceIdentities.length,
    missingExpectedCategoryValues: missingExpectedCategoryValues.length,
    deprecatedCategoryKeys: deprecatedCategoryKeys.length,
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
      unmatchedSourceRecords: unmatchedSourceRecords.length,
      ambiguousNameMatches: ambiguousNameMatches.length,
      duplicateSourceIdentities: duplicateSourceIdentities.length,
      missingExpectedCategoryValues: missingExpectedCategoryValues.length,
      deprecatedCategoryKeys: deprecatedCategoryKeys.length,
      severity,
    },
    matches,
    unmatchedCanonicalPlayers,
    unmatchedSourceRecords,
    ambiguousNameMatches,
    duplicateSourceIdentities,
    missingExpectedCategoryValues,
    deprecatedCategoryKeys,
    categoryCoverage,
    recommendedNextAction: recommendNextAction(severity),
  };
}
