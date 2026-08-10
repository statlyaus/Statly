import {
  AFL_TRADE_FACTUAL_RECONCILIATION_ALGORITHM_VERSION,
  AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RECONCILIATION_RUN_SCHEMA_VERSION,
  type AflTradeFactualReconciliationPolicy,
  type AflTradeFactualReconciliationRun,
  createAflTradeFactualReconciliationRun,
  createAflTradeReconciledFactualMetric,
  createAflTradeReconciledSubjectKey,
} from './factualReconciliationContracts';
import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

type SourceMembership = AflTradeFactualReconciliationRun['content']['sourceMemberships'][number];
type SourceFact = SourceMembership['fact'];
type SourceMetricFact = Extract<
  SourceFact['content'],
  { factKind: 'player_match_metric' | 'player_season_metric' }
>;
type MatchUniverseFact = Extract<SourceFact['content'], { factKind: 'match_universe' }>;
type AppearanceFact = Extract<SourceFact['content'], { factKind: 'player_appearance' }>;

export type AflTradeFactualHeadRevision = Readonly<{
  subjectKey: string;
  revision: number;
}>;

export type ReconcileAflTradeFactualFactsRequest = Readonly<{
  policy: AflTradeFactualReconciliationPolicy;
  sourceMemberships: readonly SourceMembership[];
  currentHeadRevisions: readonly AflTradeFactualHeadRevision[];
  startedAt: string;
  completedAt: string;
}>;

export class AflTradeFactualReconciliationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'POLICY_NOT_APPLICABLE'
      | 'SOURCE_NOT_AUTHORIZED'
      | 'MISSING_MATCH_UNIVERSE'
      | 'STALE_HEAD_INPUT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeFactualReconciliationError';
  }
}

function sourceKey(provider: string, capabilityId: string): string {
  return `${provider}\u0000${capabilityId}`;
}

function metricSubjectKey(content: SourceMetricFact): string {
  const matchId = content.factKind === 'player_match_metric' ? content.match.matchId : null;
  const clubScope = clubScopeForMetric(content);
  return [
    content.player.playerId,
    canonicalizeScope(clubScope),
    matchId ?? '',
    content.metricCode,
    content.definitionVersion,
    content.factKind === 'player_match_metric' ? 'match' : 'season',
  ].join('\u0000');
}

function gamesSubjectKey(content: AppearanceFact): string {
  return `${content.player.playerId}\u0000${content.representedClub.clubId}\u0000${content.match.matchId}`;
}

function clubScopeForMetric(content: SourceMetricFact) {
  if (content.factKind === 'player_match_metric') {
    return {
      kind: 'resolved_single_club' as const,
      clubId: content.representedClub.clubId,
    };
  }
  if (content.seasonClubScope.kind === 'resolved_single_club') {
    return {
      kind: 'resolved_single_club' as const,
      clubId: content.seasonClubScope.club.clubId,
    };
  }
  return {
    kind: 'reviewed_unattributed' as const,
    clubId: null,
    reasonCode: content.seasonClubScope.reasonCode,
    decision: content.seasonClubScope.decision,
  };
}

function canonicalizeScope(value: ReturnType<typeof clubScopeForMetric>): string {
  return JSON.stringify(value);
}

function maximumInstant(instants: readonly string[]): string {
  return instants.reduce((latest, instant) => (instant > latest ? instant : latest));
}

function exactStateForMetric(
  members: readonly {
    availability: 'measured' | 'missing' | 'quarantined' | 'not_applicable';
    numericValue: string | null;
    priority: number;
  }[]
) {
  const measured = members.filter(({ availability }) => availability === 'measured');
  const priority = measured.reduce(
    (best, member) => Math.min(best, member.priority),
    Number.POSITIVE_INFINITY
  );
  const selected = measured.filter((member) => member.priority === priority);
  const values = new Set(selected.map(({ numericValue }) => numericValue));
  if (values.size === 1) {
    return {
      availability: {
        state: 'measured' as const,
        numericValue: [...values][0]!,
        reasonCode: null,
      },
      priority,
    };
  }
  if (values.size > 1) {
    return {
      availability: {
        state: 'conflicting' as const,
        numericValue: null,
        reasonCode: 'preferred_values_disagree' as const,
      },
      priority,
    };
  }
  if (members.some(({ availability }) => availability === 'quarantined')) {
    return {
      availability: {
        state: 'quarantined' as const,
        numericValue: null,
        reasonCode: 'all_preferred_sources_quarantined' as const,
      },
      priority,
    };
  }
  if (members.every(({ availability }) => availability === 'not_applicable')) {
    return {
      availability: {
        state: 'not_applicable' as const,
        numericValue: null,
        reasonCode: 'all_preferred_sources_not_applicable' as const,
      },
      priority,
    };
  }
  return {
    availability: {
      state: 'unavailable' as const,
      numericValue: null,
      reasonCode: 'no_measured_preferred_source' as const,
    },
    priority,
  };
}

function groupMemberships<T extends SourceFact['content']>(
  memberships: readonly SourceMembership[],
  predicate: (content: SourceFact['content']) => content is T,
  key: (content: T) => string
): Map<string, SourceMembership[]> {
  const groups = new Map<string, SourceMembership[]>();
  for (const membership of memberships) {
    if (!predicate(membership.fact.content)) continue;
    const groupKey = key(membership.fact.content);
    const group = groups.get(groupKey) ?? [];
    group.push(membership);
    groups.set(groupKey, group);
  }
  return groups;
}

function requireUniqueCanonicalInputs(
  memberships: readonly SourceMembership[],
  headRevisions: readonly AflTradeFactualHeadRevision[]
) {
  const factIds = memberships.map(({ fact }) => fact.factId);
  const batchFacts = memberships.map(
    ({ factBatchId, fact }) => `${factBatchId}\u0000${fact.factId}`
  );
  if (new Set(factIds).size !== factIds.length || new Set(batchFacts).size !== batchFacts.length) {
    throw new AflTradeFactualReconciliationError(
      'INVALID_INPUT',
      'Source memberships must identify every retained fact exactly once.'
    );
  }
  const headKeys = headRevisions.map(({ subjectKey }) => subjectKey);
  if (
    new Set(headKeys).size !== headKeys.length ||
    headRevisions.some(({ revision }) => !Number.isInteger(revision) || revision < 0)
  ) {
    throw new AflTradeFactualReconciliationError(
      'STALE_HEAD_INPUT',
      'Current head revisions must be unique non-negative CAS observations.'
    );
  }
}

export function reconcileAflTradeFactualFacts(
  request: ReconcileAflTradeFactualFactsRequest
): AflTradeFactualReconciliationRun {
  const { policy } = request;
  const scope = policy.content;
  if (request.sourceMemberships.length === 0) {
    throw new AflTradeFactualReconciliationError(
      'INVALID_INPUT',
      'A factual reconciliation run cannot silently approve an empty input set.'
    );
  }
  requireUniqueCanonicalInputs(request.sourceMemberships, request.currentHeadRevisions);
  const sourceMemberships = [...request.sourceMemberships].sort((left, right) =>
    left.fact.factId.localeCompare(right.fact.factId)
  );
  const firstFact = sourceMemberships[0]!.fact.content;
  if (
    firstFact.seasonYear < scope.validFromSeason ||
    firstFact.seasonYear > scope.validThroughSeason
  ) {
    throw new AflTradeFactualReconciliationError(
      'POLICY_NOT_APPLICABLE',
      'The approved factual policy does not cover the requested season.'
    );
  }
  for (const { fact } of sourceMemberships) {
    if (
      fact.content.environment !== scope.environment ||
      fact.content.competition !== scope.competition ||
      fact.content.seasonYear !== firstFact.seasonYear
    ) {
      throw new AflTradeFactualReconciliationError(
        'INVALID_INPUT',
        'Every source fact must share the exact policy environment, competition, and season.'
      );
    }
    if (fact.content.factKind === 'player_achievement') {
      throw new AflTradeFactualReconciliationError(
        'INVALID_INPUT',
        'Achievements remain separate factual events and are not numeric reconciliation inputs.'
      );
    }
  }

  const results = [];
  const metricGroups = groupMemberships(
    sourceMemberships,
    (content): content is SourceMetricFact =>
      content.factKind === 'player_match_metric' || content.factKind === 'player_season_metric',
    metricSubjectKey
  );
  for (const group of metricGroups.values()) {
    const first = group[0]!.fact.content as SourceMetricFact;
    const grain = first.factKind === 'player_match_metric' ? 'match' : 'season';
    const matchId = first.factKind === 'player_match_metric' ? first.match.matchId : null;
    const rule = scope.sourceMetricRules.find(
      (candidate) =>
        candidate.metricCode === first.metricCode &&
        candidate.definitionVersion === first.definitionVersion &&
        candidate.grain === grain
    );
    if (
      rule === undefined ||
      rule.definition.id !== first.definition.id ||
      rule.definition.sha256 !== first.definition.sha256 ||
      rule.unit !== first.unit
    ) {
      throw new AflTradeFactualReconciliationError(
        'SOURCE_NOT_AUTHORIZED',
        `No exact reconciliation rule covers ${first.metricCode}/${first.definitionVersion}/${grain}.`
      );
    }
    const preferenceBySource = new Map(
      rule.sources.map((preference) => [
        sourceKey(preference.provider, preference.capabilityId),
        preference,
      ])
    );
    const members = group
      .map(({ fact }) => {
        const content = fact.content as SourceMetricFact;
        const preference = preferenceBySource.get(
          sourceKey(content.provider, content.capabilityId)
        );
        if (preference === undefined) {
          throw new AflTradeFactualReconciliationError(
            'SOURCE_NOT_AUTHORIZED',
            `Provider ${content.provider}/${content.capabilityId} is not approved for ${content.metricCode}.`
          );
        }
        return {
          sourceFactId: fact.factId,
          sourceFactSha256: fact.factSha256,
          priority: preference.priority,
          provider: content.provider,
          capabilityId: content.capabilityId,
          availability: content.availability.state,
          numericValue: content.availability.numericValue,
        };
      })
      .sort((left, right) => left.sourceFactId.localeCompare(right.sourceFactId));
    const reconciled = exactStateForMetric(members);
    const selectedMemberIds = Number.isFinite(reconciled.priority)
      ? members
          .filter(
            ({ availability, priority }) =>
              availability === 'measured' && priority === reconciled.priority
          )
          .map(({ sourceFactId }) => sourceFactId)
          .sort()
      : [];
    results.push(
      createAflTradeReconciledFactualMetric({
        resultKind: 'source_metric',
        playerId: first.player.playerId,
        clubScope: clubScopeForMetric(first),
        matchId,
        competition: first.competition,
        seasonYear: first.seasonYear,
        grain,
        metricCode: first.metricCode,
        definitionVersion: first.definitionVersion,
        definition: first.definition,
        unit: first.unit,
        availability: reconciled.availability,
        coverageNumerator: members.filter(({ availability }) => availability === 'measured').length,
        coverageDenominator: members.length,
        effectiveThrough: maximumInstant(group.map(({ fact }) => fact.content.effectiveAt)),
        recordedAt: request.completedAt,
        members,
        selectedMemberIds,
      })
    );
  }

  const matchGroups = groupMemberships(
    sourceMemberships,
    (content): content is MatchUniverseFact => content.factKind === 'match_universe',
    (content) => content.match.matchId
  );
  const appearanceGroups = groupMemberships(
    sourceMemberships,
    (content): content is AppearanceFact => content.factKind === 'player_appearance',
    gamesSubjectKey
  );
  const appearancePreferences = new Map(
    scope.gamesRule.appearanceSources.map((preference) => [
      sourceKey(preference.provider, preference.capabilityId),
      preference,
    ])
  );
  const matchPreferences = new Map(
    scope.gamesRule.matchUniverseSources.map((preference) => [
      sourceKey(preference.provider, preference.capabilityId),
      preference,
    ])
  );
  for (const appearanceGroup of appearanceGroups.values()) {
    const firstAppearance = appearanceGroup[0]!.fact.content as AppearanceFact;
    const matchGroup = matchGroups.get(firstAppearance.match.matchId) ?? [];
    if (matchGroup.length === 0) {
      throw new AflTradeFactualReconciliationError(
        'MISSING_MATCH_UNIVERSE',
        `No retained match-universe evidence covers ${firstAppearance.match.matchId}.`
      );
    }
    const appearanceMembers = appearanceGroup
      .map(({ fact }) => {
        const content = fact.content as AppearanceFact;
        const preference = appearancePreferences.get(
          sourceKey(content.provider, content.capabilityId)
        );
        if (preference === undefined) {
          throw new AflTradeFactualReconciliationError(
            'SOURCE_NOT_AUTHORIZED',
            `Appearance source ${content.provider}/${content.capabilityId} is not approved.`
          );
        }
        return {
          sourceFactId: fact.factId,
          sourceFactSha256: fact.factSha256,
          priority: preference.priority,
          provider: content.provider,
          capabilityId: content.capabilityId,
          availability: 'measured' as const,
          numericValue: '1',
        };
      })
      .sort((left, right) => left.sourceFactId.localeCompare(right.sourceFactId));
    const appearancePriority = Math.min(...appearanceMembers.map(({ priority }) => priority));
    const selectedAppearanceFactIds = appearanceMembers
      .filter(({ priority }) => priority === appearancePriority)
      .map(({ sourceFactId }) => sourceFactId)
      .sort();
    const matchFacts = matchGroup
      .map(({ fact }) => {
        const content = fact.content as MatchUniverseFact;
        const preference = matchPreferences.get(sourceKey(content.provider, content.capabilityId));
        if (preference === undefined) {
          throw new AflTradeFactualReconciliationError(
            'SOURCE_NOT_AUTHORIZED',
            `Match source ${content.provider}/${content.capabilityId} is not approved.`
          );
        }
        return { fact, content, priority: preference.priority };
      })
      .sort((left, right) => left.fact.factId.localeCompare(right.fact.factId));
    const usableMatchFacts = matchFacts.filter(
      ({ content }) => content.completion.state !== 'quarantined'
    );
    const matchSelectionPool = usableMatchFacts.length > 0 ? usableMatchFacts : matchFacts;
    const matchPriority = Math.min(...matchSelectionPool.map(({ priority }) => priority));
    const selectedMatchFacts = matchSelectionPool.filter(
      ({ priority }) => priority === matchPriority
    );
    const completionStates = new Set(
      selectedMatchFacts.map(({ content }) => content.completion.state)
    );
    const availability = completionStates.has('quarantined')
      ? {
          state: 'quarantined' as const,
          numericValue: null,
          reasonCode: 'match_completion_quarantined' as const,
        }
      : completionStates.size > 1
        ? {
            state: 'conflicting' as const,
            numericValue: null,
            reasonCode: 'preferred_completion_states_disagree' as const,
          }
        : completionStates.has('completed')
          ? { state: 'measured' as const, numericValue: '1', reasonCode: null }
          : {
              state: 'unavailable' as const,
              numericValue: null,
              reasonCode: 'match_not_completed' as const,
            };
    results.push(
      createAflTradeReconciledFactualMetric({
        resultKind: 'derived_games',
        playerId: firstAppearance.player.playerId,
        clubScope: {
          kind: 'resolved_single_club',
          clubId: firstAppearance.representedClub.clubId,
        },
        matchId: firstAppearance.match.matchId,
        competition: firstAppearance.competition,
        seasonYear: firstAppearance.seasonYear,
        grain: 'match',
        metricCode: 'games',
        definitionVersion: 'games/v1',
        definition: scope.gamesRule.definition,
        unit: 'games',
        availability,
        coverageNumerator: availability.state === 'measured' ? 1 : 0,
        coverageDenominator: 1,
        effectiveThrough: maximumInstant([
          ...appearanceGroup.map(({ fact }) => fact.content.effectiveAt),
          ...matchGroup.map(({ fact }) => fact.content.effectiveAt),
        ]),
        recordedAt: request.completedAt,
        appearanceMembers,
        selectedAppearanceFactIds,
        matchUniverseFactIds: matchFacts.map(({ fact }) => fact.factId).sort(),
        selectedMatchUniverseFactIds: selectedMatchFacts.map(({ fact }) => fact.factId).sort(),
      })
    );
  }

  const sortedResults = results.sort((left, right) =>
    left.reconciledFactId.localeCompare(right.reconciledFactId)
  );
  const currentRevisionBySubject = new Map(
    request.currentHeadRevisions.map(({ subjectKey, revision }) => [subjectKey, revision])
  );
  const headAdvances = sortedResults
    .map((result) => {
      const subjectKey = createAflTradeReconciledSubjectKey({
        environment: scope.environment,
        competition: result.content.competition,
        seasonYear: result.content.seasonYear,
        playerId: result.content.playerId,
        clubScope: result.content.clubScope,
        matchId: result.content.matchId,
        metricCode: result.content.metricCode,
        definitionVersion: result.content.definitionVersion,
      });
      const expectedRevision = currentRevisionBySubject.get(subjectKey) ?? 0;
      return {
        subjectKey,
        expectedRevision,
        nextRevision: expectedRevision + 1,
        reconciledFactId: result.reconciledFactId,
      };
    })
    .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey));
  const stateCount = (state: string) =>
    sortedResults.filter(({ content }) => content.availability.state === state).length;

  return createAflTradeFactualReconciliationRun({
    schemaVersion: AFL_TRADE_FACTUAL_RECONCILIATION_RUN_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: scope.environment,
    competition: scope.competition,
    seasonYear: firstFact.seasonYear,
    policy,
    algorithmVersion: AFL_TRADE_FACTUAL_RECONCILIATION_ALGORITHM_VERSION,
    inputSetSha256: sha256AflTradeCanonicalJson(sourceMemberships),
    outputSetSha256: sha256AflTradeCanonicalJson(sortedResults),
    sourceMemberships,
    results: sortedResults,
    headAdvances,
    startedAt: request.startedAt,
    completedAt: request.completedAt,
    counts: {
      sourceFacts: sourceMemberships.length,
      reconciledFacts: sortedResults.length,
      measured: stateCount('measured'),
      unavailable: stateCount('unavailable'),
      conflicting: stateCount('conflicting'),
      quarantined: stateCount('quarantined'),
      notApplicable: stateCount('not_applicable'),
    },
  });
}
