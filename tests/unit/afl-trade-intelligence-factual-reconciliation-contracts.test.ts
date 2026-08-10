import { describe, expect, it } from 'vitest';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import { createAflTradeContentAddress } from '../../src/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_FACTUAL_RECONCILIATION_ALGORITHM_VERSION,
  AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RECONCILIATION_POLICY_SCHEMA_VERSION,
  AFL_TRADE_FACTUAL_RECONCILIATION_RUN_SCHEMA_VERSION,
  createAflTradeFactualReconciliationPolicy,
  createAflTradeReconciledFactualMetric,
} from '../../src/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import {
  AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  createAflTradeProviderAppearanceCandidate,
  createAflTradeSourceFact,
  type AflTradeSourceFact,
} from '../../src/server/aflTradeIntelligence/outcomes/factualObservationContracts';
import {
  AflTradeFactualReconciliationError,
  reconcileAflTradeFactualFacts,
} from '../../src/server/aflTradeIntelligence/outcomes/factualReconciliationService';
import {
  AflTradeFactualReconciliationPersistenceError,
  PostgresAflTradeFactualReconciliationRepository,
} from '../../src/server/aflTradeIntelligence/outcomes/postgresFactualReconciliationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '../../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const digest = (value: string) => value.repeat(64);
const reference = (prefix: string, value: string) => ({
  id: `${prefix}:${digest(value)}`,
  sha256: digest(value),
});

function policyContent() {
  return {
    schemaVersion: AFL_TRADE_FACTUAL_RECONCILIATION_POLICY_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    validFromSeason: 2020,
    validThroughSeason: 2030,
    policyVersion: 'facts/v1',
    approval: reference('factual-reconciliation-policy-approval', 'a'),
    sourceMetricRules: [
      {
        ruleKind: 'source_metric' as const,
        metricCode: 'goals' as const,
        definitionVersion: 'goals/v1',
        definition: reference('metric-definition', 'b'),
        grain: 'match' as const,
        unit: 'goals',
        comparison: 'exact_non_negative_integer' as const,
        missingValueSemantics: 'never_zero_and_never_did_not_play' as const,
        fallback: 'next_priority_only_when_higher_priority_has_no_measured_value' as const,
        conflict: 'same_priority_distinct_measured_values_are_conflicting' as const,
        sources: [
          { priority: 1, provider: 'afl_tables', capabilityId: 'afl-tables-player-stats' },
          { priority: 1, provider: 'footywire', capabilityId: 'footywire-player-stats' },
          { priority: 1, provider: 'official_afl', capabilityId: 'official-afl-player-stats' },
        ],
      },
    ],
    gamesRule: {
      ruleKind: 'derived_games' as const,
      metricCode: 'games' as const,
      definitionVersion: 'games/v1' as const,
      definition: reference('metric-definition', 'c'),
      grain: 'match' as const,
      unit: 'games' as const,
      derivation: 'one_only_for_completed_match_and_authenticated_observed_appearance' as const,
      absenceSemantics: 'absence_is_unknown_never_zero_or_did_not_play' as const,
      completionConflict: 'distinct_preferred_completion_states_are_conflicting' as const,
      appearanceSources: [
        { priority: 1, provider: 'afl_tables', capabilityId: 'afl-tables-player-stats' },
        { priority: 1, provider: 'footywire', capabilityId: 'footywire-player-stats' },
        { priority: 1, provider: 'official_afl', capabilityId: 'official-afl-player-stats' },
      ],
      matchUniverseSources: [
        { priority: 1, provider: 'afl_tables', capabilityId: 'afl-tables-results' },
        { priority: 1, provider: 'official_afl', capabilityId: 'official-afl-results' },
      ],
    },
    createdAt: '2026-08-08T00:00:00.000Z',
  };
}

function sourceMetricResult() {
  const memberId = `source-fact:${digest('d')}`;
  return {
    resultKind: 'source_metric' as const,
    playerId: 'afl-player:one',
    clubScope: { kind: 'resolved_single_club' as const, clubId: 'afl-club:home' },
    matchId: 'afl-match:one',
    competition: 'AFLM' as const,
    seasonYear: 2026,
    grain: 'match' as const,
    metricCode: 'goals',
    definitionVersion: 'goals/v1',
    definition: reference('metric-definition', 'b'),
    unit: 'goals',
    availability: { state: 'measured' as const, numericValue: '0', reasonCode: null },
    coverageNumerator: 1,
    coverageDenominator: 1,
    effectiveThrough: '2026-03-20T10:00:00.000Z',
    recordedAt: '2026-03-21T10:00:00.000Z',
    members: [
      {
        sourceFactId: memberId,
        sourceFactSha256: digest('d'),
        priority: 1,
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        availability: 'measured' as const,
        numericValue: '0',
      },
    ],
    selectedMemberIds: [memberId],
  };
}

function gamesResult() {
  const appearanceFactId = `source-fact:${digest('e')}`;
  const matchFactId = `source-fact:${digest('f')}`;
  return {
    resultKind: 'derived_games' as const,
    playerId: 'afl-player:one',
    clubScope: { kind: 'resolved_single_club' as const, clubId: 'afl-club:home' },
    matchId: 'afl-match:one',
    competition: 'AFLM' as const,
    seasonYear: 2026,
    grain: 'match' as const,
    metricCode: 'games' as const,
    definitionVersion: 'games/v1' as const,
    definition: reference('metric-definition', 'c'),
    unit: 'games' as const,
    availability: { state: 'measured' as const, numericValue: '1', reasonCode: null },
    coverageNumerator: 1,
    coverageDenominator: 1,
    effectiveThrough: '2026-03-20T10:00:00.000Z',
    recordedAt: '2026-03-21T10:00:00.000Z',
    appearanceMembers: [
      {
        sourceFactId: appearanceFactId,
        sourceFactSha256: digest('e'),
        priority: 1,
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        availability: 'measured' as const,
        numericValue: '1',
      },
    ],
    selectedAppearanceFactIds: [appearanceFactId],
    matchUniverseFactIds: [matchFactId],
    selectedMatchUniverseFactIds: [matchFactId],
  };
}

function addressedReference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function assignment(
  entityKind: 'player' | 'club' | 'club_alias' | 'match',
  decisionId: string,
  marker: string
) {
  return {
    assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
      marker,
    }),
    entityKind,
    revision: 1,
    decisionId,
    status: 'active' as const,
  };
}

function playerResolution() {
  const decision = addressedReference('provider-resolution-decision', 'player');
  return {
    mappingScope: 'provider_identity' as const,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      marker: 'player',
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: addressedReference('canonical-target-snapshot', 'player'),
    identityCandidateId: 'identity-candidate:reconciliation',
    playerIdentityId: createAflTradeContentAddress('provider-player-identity', {
      marker: 'player',
    }),
    playerId: 'afl-player:reconciliation',
    assignment: assignment('player', decision.id, 'player'),
  };
}

function clubResolution(clubId: string, marker: string) {
  const decision = addressedReference('provider-resolution-decision', `club:${marker}`);
  return {
    mappingScope: 'provider_identity' as const,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      marker: `club:${marker}`,
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: addressedReference('canonical-target-snapshot', `club:${marker}`),
    occurrence: {
      source: 'player_affiliation' as const,
      identityCandidateId: 'identity-candidate:reconciliation',
    },
    clubIdentityId: createAflTradeContentAddress('provider-club-identity', { marker }),
    clubId,
    assignment: assignment('club', decision.id, marker),
  };
}

function matchResolution() {
  const decision = addressedReference('provider-resolution-decision', 'match');
  const homeClub = clubResolution('afl-club:home', 'home');
  const awayClub = clubResolution('afl-club:away', 'away');
  return {
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      marker: 'match',
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: addressedReference('canonical-target-snapshot', 'match'),
    matchCandidateId: 'match-candidate:reconciliation',
    matchIdentityId: createAflTradeContentAddress('provider-match-identity', {
      marker: 'match',
    }),
    matchId: 'afl-match:reconciliation',
    canonicalMatchDate: '2026-03-20T08:00:00.000Z',
    canonicalRoundLabel: 'Round 1',
    homeClub: {
      clubId: homeClub.clubId,
      resolutionDecision: homeClub.decision,
      assignment: homeClub.assignment,
    },
    awayClub: {
      clubId: awayClub.clubId,
      resolutionDecision: awayClub.decision,
      assignment: awayClub.assignment,
    },
    assignment: assignment('match', decision.id, 'match'),
  };
}

const normalizationRunId = createAflTradeContentAddress('provider-normalization-run', {
  marker: 'reconciliation',
});
const stagingSha256 = digest('1');
const normalizationFinalizedAt = '2026-03-21T07:00:00.000Z';
const normalizationFinalizationId = createAflTradeContentAddress(
  'provider-normalization-finalization',
  { normalizationRunId, stagingSha256, finalizedAt: normalizationFinalizedAt }
);
const normalizationFinalization = {
  id: normalizationFinalizationId,
  sha256: normalizationFinalizationId.slice(normalizationFinalizationId.indexOf(':') + 1),
};

function sourceEvidence(
  marker: string,
  candidateDigests: {
    identity: string | null;
    match: string | null;
    metric: string | null;
    achievement: string | null;
    appearance: string | null;
  },
  consumedSourceFields: string[]
) {
  return {
    captureId: `source-capture:${marker}`,
    normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt,
    stagingSha256,
    providerDecodedRowId: `provider-row:${marker}`,
    sourceRowNumber: 1,
    sourceRowSha256: digest(marker === 'match' ? '2' : marker === 'appearance' ? '3' : '4'),
    semanticNaturalKeySha256: digest(
      marker === 'match' ? '5' : marker === 'appearance' ? '6' : '7'
    ),
    candidateDigests,
    rowStatus: 'staged' as const,
    issueSet: addressedReference('provider-resolution-issue-set', marker),
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    consumedSourceFields: [...consumedSourceFields].sort(),
  };
}

function factBase(
  provider: string,
  capabilityId: string,
  source: ReturnType<typeof sourceEvidence>
) {
  return {
    schemaVersion: AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    provider,
    capabilityId,
    competition: 'AFLM' as const,
    seasonYear: 2026,
    fieldMapSha256: digest('8'),
    effectiveAt: '2026-03-20T10:00:00.000Z',
    recordedAt: '2026-03-21T08:00:00.000Z',
    source,
  };
}

function appearanceFact() {
  const candidate = createAflTradeProviderAppearanceCandidate({
    schemaVersion: AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION,
    environment: 'test_fixture',
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM',
    seasonYear: 2026,
    captureId: 'source-capture:appearance',
    normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt,
    stagingSha256,
    providerDecodedRowId: 'provider-row:appearance',
    sourceRowNumber: 1,
    sourceRowSha256: digest('3'),
    semanticNaturalKeySha256: digest('6'),
    fieldMapSha256: digest('8'),
    identityCandidateId: 'identity-candidate:reconciliation',
    identityCandidateSha256: digest('9'),
    matchCandidateId: 'match-candidate:reconciliation',
    matchCandidateSha256: digest('a'),
    appearanceState: 'observed',
    sourceFields: ['player_id'],
    derivationPolicy: addressedReference('player-appearance-policy', 'reconciliation'),
  });
  return createAflTradeSourceFact({
    ...factBase(
      'official_afl',
      'official-afl-player-stats',
      sourceEvidence(
        'appearance',
        {
          identity: digest('9'),
          match: digest('a'),
          metric: null,
          achievement: null,
          appearance: candidate.candidateSha256,
        },
        ['player_id']
      )
    ),
    factKind: 'player_appearance',
    player: playerResolution(),
    representedClub: clubResolution('afl-club:home', 'home'),
    match: matchResolution(),
    appearanceCandidate: candidate,
    appearanceState: 'observed',
  });
}

function goalsFact(appearanceFactId: string, provider = 'official_afl', numericValue = '0') {
  const capabilityId =
    provider === 'afl_tables' ? 'afl-tables-player-stats' : 'official-afl-player-stats';
  return createAflTradeSourceFact({
    ...factBase(
      provider,
      capabilityId,
      sourceEvidence(
        `metric-${provider}`,
        {
          identity: digest('9'),
          match: digest('a'),
          metric: digest(provider === 'afl_tables' ? 'b' : 'c'),
          achievement: null,
          appearance: null,
        },
        ['goals']
      )
    ),
    factKind: 'player_match_metric',
    player: playerResolution(),
    representedClub: clubResolution('afl-club:home', 'home'),
    match: matchResolution(),
    appearanceFactId,
    metricCode: 'goals',
    definitionVersion: 'goals/v1',
    definition: reference('metric-definition', 'b'),
    unit: 'goals',
    availability: { state: 'measured', numericValue, reasonCode: null },
  });
}

function matchFact(completion: 'completed' | 'not_completed') {
  return createAflTradeSourceFact({
    ...factBase(
      'official_afl',
      'official-afl-results',
      sourceEvidence(
        'match',
        {
          identity: null,
          match: digest('a'),
          metric: null,
          achievement: null,
          appearance: null,
        },
        ['match_status']
      )
    ),
    factKind: 'match_universe',
    matchCandidateId: 'match-candidate:reconciliation',
    match: matchResolution(),
    completionPolicy: addressedReference('match-universe-policy', 'reconciliation'),
    completion:
      completion === 'completed'
        ? { state: 'completed', providerStatus: 'Final' }
        : { state: 'not_completed', providerStatus: 'Scheduled', reasonCode: 'scheduled' },
  });
}

function membership(fact: AflTradeSourceFact, marker: string) {
  const batchId = createAflTradeContentAddress('source-fact-batch', { marker });
  return {
    factBatchId: batchId,
    factBatchSha256: batchId.slice(batchId.indexOf(':') + 1),
    fact,
  };
}

function completedRun() {
  const policy = createAflTradeFactualReconciliationPolicy(policyContent());
  const appearance = appearanceFact();
  const goals = goalsFact(appearance.factId);
  const completedMatch = matchFact('completed');
  return reconcileAflTradeFactualFacts({
    policy,
    sourceMemberships: [
      membership(appearance, 'appearance'),
      membership(goals, 'goals'),
      membership(completedMatch, 'match'),
    ],
    currentHeadRevisions: [],
    startedAt: '2026-03-22T08:00:00.000Z',
    completedAt: '2026-03-22T08:01:00.000Z',
  });
}

class ReconciliationSqlFixture implements AflOutcomeSqlClient {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];

  constructor(
    private readonly run = completedRun(),
    private readonly staleHead = false
  ) {}

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(0, ...placeholders)).toBeLessThanOrEqual(parameters.length);
    if (sql.includes('SELECT receipt_json FROM outcome_factual_reconciliation_run')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_factual_reconciliation_policy WHERE policy_id')) {
      const policy = this.run.content.policy;
      return {
        rows: [
          {
            policy_sha256: policy.policySha256,
            policy_json: policy.content,
            environment: policy.content.environment,
            competition: policy.content.competition,
            valid_from_season: policy.content.validFromSeason,
            valid_through_season: policy.content.validThroughSeason,
            status: 'approved',
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('INSERT INTO outcome_reconciled_factual_metric_head')) {
      return { rows: [], rowCount: this.staleHead ? 0 : 1 };
    }
    if (sql.includes('SELECT finalized_at FROM outcome_factual_reconciliation_run')) {
      return { rows: [{ finalized_at: this.run.content.completedAt }] as Row[], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
}

describe('AFL trade factual reconciliation contracts', () => {
  it('accepts a reviewed shared-priority tier so independent sources can expose conflicts', () => {
    const policy = createAflTradeFactualReconciliationPolicy(policyContent());

    expect(policy.content.sourceMetricRules[0]?.sources).toHaveLength(3);
    expect(
      policy.content.sourceMetricRules[0]?.sources.every(({ priority }) => priority === 1)
    ).toBe(true);
  });

  it('rejects duplicate provider capabilities within one policy rule', () => {
    const content = policyContent();
    content.sourceMetricRules[0]!.sources[1] = {
      ...content.sourceMetricRules[0]!.sources[0]!,
    };

    expect(() => createAflTradeFactualReconciliationPolicy(content)).toThrow(
      /provider capability may occur only once/i
    );
  });

  it('preserves a measured provider zero as data rather than missingness', () => {
    const result = createAflTradeReconciledFactualMetric(sourceMetricResult());

    expect(result.content.availability).toEqual({
      state: 'measured',
      numericValue: '0',
      reasonCode: null,
    });
  });

  it('allows a game only as exactly one with selected match-completion evidence', () => {
    const result = createAflTradeReconciledFactualMetric(gamesResult());

    expect(result.content).toMatchObject({
      resultKind: 'derived_games',
      availability: { state: 'measured', numericValue: '1' },
    });
  });

  it('rejects zero or absent completion evidence as a measured game', () => {
    expect(() =>
      createAflTradeReconciledFactualMetric({
        ...gamesResult(),
        availability: { state: 'measured', numericValue: '0', reasonCode: null },
      })
    ).toThrow(/measured game is exactly one/i);

    expect(() =>
      createAflTradeReconciledFactualMetric({
        ...gamesResult(),
        selectedMatchUniverseFactIds: [],
      })
    ).toThrow(/requires selected completed-match evidence/i);
  });

  it('keeps run and algorithm versions explicit instead of silently changing methodology', () => {
    expect(AFL_TRADE_FACTUAL_RECONCILIATION_RUN_SCHEMA_VERSION).toBe(
      'afl-trade-factual-reconciliation-run/v1'
    );
    expect(AFL_TRADE_FACTUAL_RECONCILIATION_ALGORITHM_VERSION).toBe(
      'afl-trade-factual-reconciliation/v1'
    );
  });

  it('derives games only from an authenticated appearance plus a completed match', () => {
    const policy = createAflTradeFactualReconciliationPolicy(policyContent());
    const appearance = appearanceFact();
    const goals = goalsFact(appearance.factId);
    const completedMatch = matchFact('completed');
    const run = reconcileAflTradeFactualFacts({
      policy,
      sourceMemberships: [
        membership(appearance, 'appearance'),
        membership(goals, 'goals'),
        membership(completedMatch, 'match'),
      ],
      currentHeadRevisions: [],
      startedAt: '2026-03-22T08:00:00.000Z',
      completedAt: '2026-03-22T08:01:00.000Z',
    });

    expect(run.content.results).toHaveLength(2);
    expect(run.content.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.objectContaining({
            resultKind: 'source_metric',
            metricCode: 'goals',
            availability: { state: 'measured', numericValue: '0', reasonCode: null },
          }),
        }),
        expect.objectContaining({
          content: expect.objectContaining({
            resultKind: 'derived_games',
            metricCode: 'games',
            availability: { state: 'measured', numericValue: '1', reasonCode: null },
          }),
        }),
      ])
    );
    expect(run.content.counts).toMatchObject({ measured: 2, conflicting: 0 });
    expect(run.content.publicationEligible).toBe(false);
  });

  it('does not count an observed player in a match that has not completed', () => {
    const policy = createAflTradeFactualReconciliationPolicy(policyContent());
    const appearance = appearanceFact();
    const scheduledMatch = matchFact('not_completed');
    const run = reconcileAflTradeFactualFacts({
      policy,
      sourceMemberships: [
        membership(appearance, 'appearance'),
        membership(scheduledMatch, 'match'),
      ],
      currentHeadRevisions: [],
      startedAt: '2026-03-22T08:00:00.000Z',
      completedAt: '2026-03-22T08:01:00.000Z',
    });
    const games = run.content.results.find(({ content }) => content.metricCode === 'games');

    expect(games?.content.availability).toEqual({
      state: 'unavailable',
      numericValue: null,
      reasonCode: 'match_not_completed',
    });
    expect(games?.content.coverageNumerator).toBe(0);
  });

  it('surfaces same-tier provider disagreement instead of choosing a convenient value', () => {
    const policy = createAflTradeFactualReconciliationPolicy(policyContent());
    const appearance = appearanceFact();
    const officialGoals = goalsFact(appearance.factId, 'official_afl', '0');
    const aflTablesGoals = goalsFact(appearance.factId, 'afl_tables', '1');
    const completedMatch = matchFact('completed');
    const run = reconcileAflTradeFactualFacts({
      policy,
      sourceMemberships: [
        membership(appearance, 'appearance'),
        membership(officialGoals, 'official-goals'),
        membership(aflTablesGoals, 'afl-tables-goals'),
        membership(completedMatch, 'match'),
      ],
      currentHeadRevisions: [],
      startedAt: '2026-03-22T08:00:00.000Z',
      completedAt: '2026-03-22T08:01:00.000Z',
    });
    const goals = run.content.results.find(({ content }) => content.metricCode === 'goals');

    expect(goals?.content.availability).toEqual({
      state: 'conflicting',
      numericValue: null,
      reasonCode: 'preferred_values_disagree',
    });
  });

  it('fails closed when appearance evidence has no retained match universe', () => {
    const policy = createAflTradeFactualReconciliationPolicy(policyContent());
    const appearance = appearanceFact();

    expect(() =>
      reconcileAflTradeFactualFacts({
        policy,
        sourceMemberships: [membership(appearance, 'appearance')],
        currentHeadRevisions: [],
        startedAt: '2026-03-22T08:00:00.000Z',
        completedAt: '2026-03-22T08:01:00.000Z',
      })
    ).toThrowError(AflTradeFactualReconciliationError);
  });

  it('persists typed inputs, outputs, evidence, heads, and finalization in one transaction', async () => {
    const run = completedRun();
    const client = new ReconciliationSqlFixture(run);
    const repository = new PostgresAflTradeFactualReconciliationRepository(client);
    const result = await repository.persistRun(run, { environment: 'test_fixture' });
    const statements = client.calls.map(({ sql }) => sql).join('\n');

    expect(result).toMatchObject({
      factualRunId: run.factualRunId,
      sourceFactCount: 3,
      reconciledFactCount: 2,
      conflictCount: 0,
      idempotentReplay: false,
      publicationEligible: false,
    });
    expect(statements).toContain('outcome_factual_reconciliation_metric_input');
    expect(statements).toContain('outcome_factual_reconciliation_appearance_input');
    expect(statements).toContain('outcome_factual_reconciliation_match_input');
    expect(statements).toContain('outcome_reconciled_factual_game_appearance_member');
    expect(statements).toContain('outcome_reconciled_factual_game_match_member');
    expect(statements).toContain('outcome_reconciled_factual_metric_head');
    expect(statements).not.toMatch(/outcome_release|public_projection|fantasy|\buser\b/i);
  });

  it('rejects an execution-environment mismatch before opening a transaction', async () => {
    const run = completedRun();
    const client = new ReconciliationSqlFixture(run);
    const repository = new PostgresAflTradeFactualReconciliationRepository(client);

    await expect(
      repository.persistRun(run, { environment: 'non_production' })
    ).rejects.toMatchObject({ code: 'ENVIRONMENT_MISMATCH' });
    expect(client.calls).toHaveLength(0);
  });

  it('maps a failed compare-and-swap head advance to a typed stale revision', async () => {
    const run = completedRun();
    const repository = new PostgresAflTradeFactualReconciliationRepository(
      new ReconciliationSqlFixture(run, true)
    );

    await expect(repository.persistRun(run, { environment: 'test_fixture' })).rejects.toEqual(
      expect.objectContaining({
        code: 'STALE_REVISION',
      } satisfies Partial<AflTradeFactualReconciliationPersistenceError>)
    );
  });
});
