import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
  AFL_TRADE_ACQUISITION_SPELL_METRIC_POLICY_SCHEMA_VERSION,
  createAflTradeAcquisitionSpellMetricPolicy,
  createAflTradeFactualReconciliationFinalization,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellMetricContracts';
import {
  AflTradeAcquisitionSpellMetricCalculationError,
  calculateAflTradeAcquisitionSpellMetrics,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellMetricService';
import { PostgresAflTradeAcquisitionSpellMetricRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellMetricRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeReconciledFactualMetric,
  createAflTradeReconciledSubjectKey,
  type AflTradeReconciledFactualMetric,
} from '@/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

const digest = (value: string) => value.repeat(64);
const reference = (prefix: string, marker: string) => {
  const id = createAflTradeContentAddress(prefix, { marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
};

const gamesDefinition = reference('metric-definition', 'games/v1');
const goalsDefinition = reference('metric-definition', 'goals/v1');

function policyContent() {
  return {
    schemaVersion: AFL_TRADE_ACQUISITION_SPELL_METRIC_POLICY_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    validFromSeason: 2020,
    validThroughSeason: 2030,
    policyVersion: 'spell-metrics/v1',
    approval: reference('acquisition-spell-metric-policy-approval', 'v1'),
    rules: [
      {
        metricCode: 'games' as const,
        definitionVersion: 'games/v1',
        definition: gamesDefinition,
        unit: 'games',
        sourceGrain: 'match' as const,
        aggregation: 'sum_non_negative_integer' as const,
        attribution: 'exact_player_real_club_and_effective_date_inside_spell' as const,
        noEvidenceSemantics: 'unavailable_never_zero' as const,
        conflictSemantics: 'preserve_conflict_and_withhold_numeric_total' as const,
      },
      {
        metricCode: 'goals' as const,
        definitionVersion: 'goals/v1',
        definition: goalsDefinition,
        unit: 'goals',
        sourceGrain: 'match' as const,
        aggregation: 'sum_non_negative_integer' as const,
        attribution: 'exact_player_real_club_and_effective_date_inside_spell' as const,
        noEvidenceSemantics: 'unavailable_never_zero' as const,
        conflictSemantics: 'preserve_conflict_and_withhold_numeric_total' as const,
      },
    ],
    createdAt: '2026-03-01T00:00:00.000Z',
  };
}

function spell(overrides: Record<string, unknown> = {}) {
  return {
    spellVersionId: createAflTradeContentAddress('acquisition-spell-version', { marker: 'spell' }),
    spellId: 'acquisition-spell:player-club',
    version: 1,
    playerId: 'afl-player:spell-player',
    clubId: 'afl-club:spell-club',
    startEventVersionId: 'event-version:trade-2026',
    startAssetVersionId: 'asset-version:player-receipt',
    startDate: '2026-03-01',
    endDate: '2026-09-30',
    rule: reference('acquisition-spell-rule', 'v1'),
    status: 'approved' as const,
    recordedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function sourceMember(marker: string, numericValue: string) {
  const sourceFactId = createAflTradeContentAddress('source-fact', { marker });
  return {
    sourceFactId,
    sourceFactSha256: sourceFactId.slice(sourceFactId.indexOf(':') + 1),
    priority: 1,
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    availability: 'measured' as const,
    numericValue,
  };
}

function goalsResult(
  marker: string,
  numericValue: string | null,
  options: {
    clubId?: string;
    effectiveThrough?: string;
    state?: 'measured' | 'conflicting';
  } = {}
) {
  const state = options.state ?? 'measured';
  const members =
    state === 'measured'
      ? [sourceMember(marker, numericValue ?? '0')]
      : [sourceMember(marker, '1'), sourceMember(marker === 'a' ? 'b' : 'a', '2')].sort(
          (left, right) => left.sourceFactId.localeCompare(right.sourceFactId)
        );
  return createAflTradeReconciledFactualMetric({
    resultKind: 'source_metric',
    playerId: 'afl-player:spell-player',
    clubScope: {
      kind: 'resolved_single_club',
      clubId: options.clubId ?? 'afl-club:spell-club',
    },
    matchId: `afl-match:${marker}`,
    competition: 'AFLM',
    seasonYear: 2026,
    grain: 'match',
    metricCode: 'goals',
    definitionVersion: 'goals/v1',
    definition: goalsDefinition,
    unit: 'goals',
    availability:
      state === 'measured'
        ? { state: 'measured', numericValue: numericValue ?? '0', reasonCode: null }
        : {
            state: 'conflicting',
            numericValue: null,
            reasonCode: 'preferred_values_disagree',
          },
    coverageNumerator: members.length,
    coverageDenominator: members.length,
    effectiveThrough: options.effectiveThrough ?? '2026-04-01T10:00:00.000Z',
    recordedAt: '2026-04-02T00:00:00.000Z',
    members,
    selectedMemberIds: members.map(({ sourceFactId }) => sourceFactId),
  });
}

function gamesResult(marker: string) {
  const appearance = sourceMember('c', '1');
  const matchFactId = `source-fact:${digest('d')}`;
  return createAflTradeReconciledFactualMetric({
    resultKind: 'derived_games',
    playerId: 'afl-player:spell-player',
    clubScope: { kind: 'resolved_single_club', clubId: 'afl-club:spell-club' },
    matchId: `afl-match:${marker}`,
    competition: 'AFLM',
    seasonYear: 2026,
    grain: 'match',
    metricCode: 'games',
    definitionVersion: 'games/v1',
    definition: gamesDefinition,
    unit: 'games',
    availability: { state: 'measured', numericValue: '1', reasonCode: null },
    coverageNumerator: 1,
    coverageDenominator: 1,
    effectiveThrough: '2026-04-01T10:00:00.000Z',
    recordedAt: '2026-04-02T00:00:00.000Z',
    appearanceMembers: [appearance],
    selectedAppearanceFactIds: [appearance.sourceFactId],
    matchUniverseFactIds: [matchFactId],
    selectedMatchUniverseFactIds: [matchFactId],
  });
}

function currentMember(result: AflTradeReconciledFactualMetric, marker: string) {
  const factualRunId = createAflTradeContentAddress('factual-reconciliation-run', { marker });
  const factualRunSha256 = factualRunId.slice(factualRunId.indexOf(':') + 1);
  const finalizedAt = '2026-04-03T00:00:00.000Z';
  return {
    factualRunId,
    factualRunSha256,
    environment: 'test_fixture' as const,
    finalization: createAflTradeFactualReconciliationFinalization({
      factualRunId,
      runSha256: factualRunSha256,
      finalizedAt,
    }),
    finalizedAt,
    subjectKey: createAflTradeReconciledSubjectKey({
      environment: 'test_fixture',
      competition: result.content.competition,
      seasonYear: result.content.seasonYear,
      playerId: result.content.playerId,
      clubScope: result.content.clubScope,
      matchId: result.content.matchId,
      metricCode: result.content.metricCode,
      definitionVersion: result.content.definitionVersion,
    }),
    headRevision: 1,
    result,
  };
}

function calculatedBatch() {
  const policy = createAflTradeAcquisitionSpellMetricPolicy(policyContent());
  const members = [
    currentMember(gamesResult('round-1'), 'games'),
    currentMember(goalsResult('a', '2'), 'goals'),
  ];
  return calculateAflTradeAcquisitionSpellMetrics({
    policy,
    spell: spell(),
    currentMembers: members,
    currentHeadRevisions: [],
    recordedAt: '2026-10-01T00:00:00.000Z',
  });
}

class SpellMetricSqlFixture implements AflOutcomeSqlClient {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];

  constructor(
    private readonly batch = calculatedBatch(),
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
    if (sql.includes('SELECT receipt_json FROM outcome_acquisition_spell_metric_batch')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_acquisition_spell_metric_policy WHERE policy_id')) {
      const policy = this.batch.content.policy;
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
    if (sql.includes('FROM outcome_acquisition_spell_version WHERE spell_version_id')) {
      const snapshot = this.batch.content.spell;
      return {
        rows: [
          {
            spell_version_id: snapshot.spellVersionId,
            spell_id: snapshot.spellId,
            version: snapshot.version,
            player_id: snapshot.playerId,
            club_id: snapshot.clubId,
            start_event_version_id: snapshot.startEventVersionId,
            start_asset_version_id: snapshot.startAssetVersionId,
            start_date: snapshot.startDate,
            end_date: snapshot.endDate,
            rule_id: snapshot.rule.id,
            status: snapshot.status,
            recorded_at: snapshot.recordedAt,
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('INSERT INTO outcome_acquisition_spell_metric_head')) {
      return { rows: [], rowCount: this.staleHead ? 0 : 1 };
    }
    if (sql.includes('SELECT finalized_at FROM outcome_acquisition_spell_metric_batch')) {
      return { rows: [{ finalized_at: this.batch.content.recordedAt }] as Row[], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
}

describe('AFL trade acquisition-spell metrics', () => {
  it('sums only current match facts inside the exact player and real-club spell', () => {
    const policy = createAflTradeAcquisitionSpellMetricPolicy(policyContent());
    const members = [
      currentMember(gamesResult('round-1'), 'games'),
      currentMember(goalsResult('a', '2'), 'goals-a'),
      currentMember(goalsResult('b', '3'), 'goals-b'),
      currentMember(goalsResult('other-club', '99', { clubId: 'afl-club:other' }), 'other-club'),
      currentMember(
        goalsResult('before-spell', '88', { effectiveThrough: '2026-02-01T10:00:00.000Z' }),
        'before-spell'
      ),
    ];
    const batch = calculateAflTradeAcquisitionSpellMetrics({
      policy,
      spell: spell(),
      currentMembers: members,
      currentHeadRevisions: [],
      recordedAt: '2026-10-01T00:00:00.000Z',
    });

    expect(batch.content.metrics).toHaveLength(2);
    expect(
      batch.content.metrics.find(({ content }) => content.rule.metricCode === 'games')?.content
        .availability
    ).toEqual({ state: 'complete', numericValue: '1', reasonCode: null });
    expect(
      batch.content.metrics.find(({ content }) => content.rule.metricCode === 'goals')?.content
        .availability
    ).toEqual({ state: 'complete', numericValue: '5', reasonCode: null });
  });

  it('represents no retained match evidence as unavailable rather than zero', () => {
    const policy = createAflTradeAcquisitionSpellMetricPolicy(policyContent());
    const batch = calculateAflTradeAcquisitionSpellMetrics({
      policy,
      spell: spell(),
      currentMembers: [],
      currentHeadRevisions: [],
      recordedAt: '2026-10-01T00:00:00.000Z',
    });

    expect(
      batch.content.metrics.every(({ content }) => content.availability.state === 'unavailable')
    ).toBe(true);
    expect(
      batch.content.metrics.every(({ content }) => content.availability.numericValue === null)
    ).toBe(true);
  });

  it('keeps independently approved aggregation policies on distinct current heads', () => {
    const featurePolicy = createAflTradeAcquisitionSpellMetricPolicy(policyContent());
    const targetPolicy = createAflTradeAcquisitionSpellMetricPolicy({
      ...policyContent(),
      policyVersion: 'spell-metrics-target/v1',
      approval: reference('acquisition-spell-metric-policy-approval', 'target-v1'),
    });
    const members = [
      currentMember(gamesResult('round-1'), 'games'),
      currentMember(goalsResult('a', '2'), 'goals'),
    ];
    const calculate = (policy: typeof featurePolicy) =>
      calculateAflTradeAcquisitionSpellMetrics({
        policy,
        spell: spell(),
        currentMembers: members,
        currentHeadRevisions: [],
        recordedAt: '2026-10-01T00:00:00.000Z',
      });

    const featureHeads = new Set(
      calculate(featurePolicy).content.headAdvances.map(({ subjectKey }) => subjectKey)
    );
    const targetHeads = calculate(targetPolicy).content.headAdvances.map(
      ({ subjectKey }) => subjectKey
    );

    expect(targetHeads.every((subjectKey) => !featureHeads.has(subjectKey))).toBe(true);
  });

  it('preserves a reconciled conflict and withholds the spell total', () => {
    const policy = createAflTradeAcquisitionSpellMetricPolicy(policyContent());
    const conflict = currentMember(
      goalsResult('conflict', null, { state: 'conflicting' }),
      'conflict'
    );
    const batch = calculateAflTradeAcquisitionSpellMetrics({
      policy,
      spell: spell(),
      currentMembers: [conflict],
      currentHeadRevisions: [],
      recordedAt: '2026-10-01T00:00:00.000Z',
    });
    const goals = batch.content.metrics.find(({ content }) => content.rule.metricCode === 'goals');

    expect(goals?.content.availability).toEqual({
      state: 'conflicting',
      numericValue: null,
      reasonCode: 'reconciled_match_facts_conflict',
    });
  });

  it('rejects duplicate current subjects and fantasy-owned spell identities', () => {
    const policy = createAflTradeAcquisitionSpellMetricPolicy(policyContent());
    const member = currentMember(goalsResult('a', '2'), 'goals');
    expect(() =>
      calculateAflTradeAcquisitionSpellMetrics({
        policy,
        spell: spell(),
        currentMembers: [member, member],
        currentHeadRevisions: [],
        recordedAt: '2026-10-01T00:00:00.000Z',
      })
    ).toThrowError(AflTradeAcquisitionSpellMetricCalculationError);

    expect(() =>
      calculateAflTradeAcquisitionSpellMetrics({
        policy,
        spell: spell({ playerId: 'user:fantasy-owner' }),
        currentMembers: [],
        currentHeadRevisions: [],
        recordedAt: '2026-10-01T00:00:00.000Z',
      })
    ).toThrow(/fantasy or user-owned state/i);
  });

  it('persists governed metric versions, members, heads, and finalization atomically', async () => {
    const batch = calculatedBatch();
    const client = new SpellMetricSqlFixture(batch);
    const repository = new PostgresAflTradeAcquisitionSpellMetricRepository(client);
    const result = await repository.persistBatch(batch, { environment: 'test_fixture' });
    const statements = client.calls.map(({ sql }) => sql).join('\n');

    expect(result).toEqual({
      batchId: batch.batchId,
      metricCount: 2,
      idempotentReplay: false,
      publicationEligible: false,
    });
    expect(statements).toContain('outcome_acquisition_spell_metric_version');
    expect(statements).toContain('outcome_acquisition_spell_metric_version_member');
    expect(statements).toContain('outcome_acquisition_spell_metric_head');
    expect(statements).not.toMatch(
      /INSERT INTO outcome_acquisition_spell_metric\s|outcome_release|public_projection|fantasy|\buser\b/i
    );
  });

  it('rejects environment mismatch and stale spell-metric head revisions', async () => {
    const batch = calculatedBatch();
    const cleanClient = new SpellMetricSqlFixture(batch);
    const repository = new PostgresAflTradeAcquisitionSpellMetricRepository(cleanClient);
    await expect(
      repository.persistBatch(batch, { environment: 'non_production' })
    ).rejects.toMatchObject({ code: 'ENVIRONMENT_MISMATCH' });
    expect(cleanClient.calls).toHaveLength(0);

    const staleRepository = new PostgresAflTradeAcquisitionSpellMetricRepository(
      new SpellMetricSqlFixture(batch, true)
    );
    await expect(
      staleRepository.persistBatch(batch, { environment: 'test_fixture' })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });
});
