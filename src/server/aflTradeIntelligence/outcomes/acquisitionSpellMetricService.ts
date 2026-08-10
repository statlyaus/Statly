import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
  AFL_TRADE_ACQUISITION_SPELL_METRIC_BATCH_SCHEMA_VERSION,
  AFL_TRADE_ACQUISITION_SPELL_METRIC_SCHEMA_VERSION,
  aflTradeAcquisitionSpellMetricPolicySchema,
  aflTradeAcquisitionSpellSnapshotSchema,
  aflTradeCurrentReconciledMemberSchema,
  createAflTradeAcquisitionSpellMetric,
  createAflTradeAcquisitionSpellMetricBatch,
  createAflTradeAcquisitionSpellMetricSubjectKey,
  type AflTradeAcquisitionSpellMetricBatch,
  type AflTradeAcquisitionSpellMetricPolicy,
  type AflTradeAcquisitionSpellSnapshot,
  type AflTradeCurrentReconciledMember,
} from './acquisitionSpellMetricContracts';

export type CalculateAflTradeAcquisitionSpellMetricsRequest = Readonly<{
  policy: AflTradeAcquisitionSpellMetricPolicy;
  spell: AflTradeAcquisitionSpellSnapshot;
  currentMembers: readonly AflTradeCurrentReconciledMember[];
  currentHeadRevisions: readonly { subjectKey: string; revision: number }[];
  recordedAt: string;
}>;

export class AflTradeAcquisitionSpellMetricCalculationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_POLICY'
      | 'INVALID_SPELL'
      | 'INVALID_CURRENT_FACT'
      | 'POLICY_NOT_APPLICABLE'
      | 'DUPLICATE_CURRENT_HEAD',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeAcquisitionSpellMetricCalculationError';
  }
}

function isInsideSpell(effectiveThrough: string, spell: AflTradeAcquisitionSpellSnapshot): boolean {
  const effectiveDate = effectiveThrough.slice(0, 10);
  return (
    effectiveDate >= spell.startDate && (spell.endDate === null || effectiveDate <= spell.endDate)
  );
}

function metricAvailability(members: readonly AflTradeCurrentReconciledMember[]) {
  const measured = members.filter(({ result }) => result.content.availability.state === 'measured');
  if (members.length === 0) {
    return {
      availability: {
        state: 'unavailable' as const,
        numericValue: null,
        reasonCode: 'no_current_match_evidence' as const,
      },
      measuredCount: 0,
    };
  }
  if (members.some(({ result }) => result.content.availability.state === 'conflicting')) {
    return {
      availability: {
        state: 'conflicting' as const,
        numericValue: null,
        reasonCode: 'reconciled_match_facts_conflict' as const,
      },
      measuredCount: measured.length,
    };
  }
  if (members.some(({ result }) => result.content.availability.state === 'quarantined')) {
    return {
      availability: {
        state: 'quarantined' as const,
        numericValue: null,
        reasonCode: 'reconciled_match_facts_quarantined' as const,
      },
      measuredCount: measured.length,
    };
  }
  if (measured.length === 0) {
    return {
      availability: {
        state: 'unavailable' as const,
        numericValue: null,
        reasonCode: 'no_measured_match_facts' as const,
      },
      measuredCount: 0,
    };
  }
  const numericValue = measured
    .reduce(
      (total, { result }) => total + BigInt(result.content.availability.numericValue ?? '0'),
      0n
    )
    .toString();
  if (measured.length === members.length) {
    return {
      availability: { state: 'complete' as const, numericValue, reasonCode: null },
      measuredCount: measured.length,
    };
  }
  return {
    availability: {
      state: 'partial' as const,
      numericValue,
      reasonCode: 'some_match_facts_unavailable' as const,
    },
    measuredCount: measured.length,
  };
}

function parseInputs(request: CalculateAflTradeAcquisitionSpellMetricsRequest) {
  let policy: AflTradeAcquisitionSpellMetricPolicy;
  let spell: AflTradeAcquisitionSpellSnapshot;
  let currentMembers: AflTradeCurrentReconciledMember[];
  try {
    policy = aflTradeAcquisitionSpellMetricPolicySchema.parse(request.policy);
  } catch (error) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'INVALID_POLICY',
      error instanceof Error ? error.message : 'The spell-metric policy is invalid.'
    );
  }
  try {
    spell = aflTradeAcquisitionSpellSnapshotSchema.parse(request.spell);
  } catch (error) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'INVALID_SPELL',
      error instanceof Error ? error.message : 'The acquisition spell is invalid.'
    );
  }
  try {
    currentMembers = request.currentMembers.map((member) =>
      aflTradeCurrentReconciledMemberSchema.parse(member)
    );
  } catch (error) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'INVALID_CURRENT_FACT',
      error instanceof Error ? error.message : 'Current reconciled evidence is invalid.'
    );
  }
  return { policy, spell, currentMembers };
}

export function calculateAflTradeAcquisitionSpellMetrics(
  request: CalculateAflTradeAcquisitionSpellMetricsRequest
): AflTradeAcquisitionSpellMetricBatch {
  const { policy, spell, currentMembers } = parseInputs(request);
  const startSeason = Number(spell.startDate.slice(0, 4));
  const endSeason = Number((spell.endDate ?? spell.startDate).slice(0, 4));
  if (
    startSeason < policy.content.validFromSeason ||
    endSeason > policy.content.validThroughSeason
  ) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'POLICY_NOT_APPLICABLE',
      'The approved aggregation policy does not cover the complete acquisition spell interval.'
    );
  }
  const headKeys = currentMembers.map(({ subjectKey }) => subjectKey);
  const resultIds = currentMembers.map(({ result }) => result.reconciledFactId);
  if (new Set(headKeys).size !== headKeys.length || new Set(resultIds).size !== resultIds.length) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'DUPLICATE_CURRENT_HEAD',
      'Each current reconciled subject and fact may be supplied only once.'
    );
  }
  if (
    currentMembers.some(
      (member) =>
        member.environment !== policy.content.environment ||
        member.result.content.competition !== policy.content.competition ||
        Date.parse(member.finalizedAt) > Date.parse(request.recordedAt)
    ) ||
    Date.parse(spell.recordedAt) > Date.parse(request.recordedAt)
  ) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'INVALID_CURRENT_FACT',
      'Spell metrics cannot use another environment or evidence learned after calculation time.'
    );
  }
  const spellHeadKeys = request.currentHeadRevisions.map(({ subjectKey }) => subjectKey);
  if (
    new Set(spellHeadKeys).size !== spellHeadKeys.length ||
    request.currentHeadRevisions.some(({ revision }) => !Number.isInteger(revision) || revision < 0)
  ) {
    throw new AflTradeAcquisitionSpellMetricCalculationError(
      'DUPLICATE_CURRENT_HEAD',
      'Spell-metric current heads must be unique non-negative CAS observations.'
    );
  }

  const metrics = policy.content.rules.map((rule) => {
    const members = currentMembers
      .filter(({ result }) => {
        const fact = result.content;
        return (
          fact.grain === 'match' &&
          fact.playerId === spell.playerId &&
          fact.clubScope.kind === 'resolved_single_club' &&
          fact.clubScope.clubId === spell.clubId &&
          fact.competition === policy.content.competition &&
          fact.metricCode === rule.metricCode &&
          fact.definitionVersion === rule.definitionVersion &&
          fact.definition.id === rule.definition.id &&
          fact.definition.sha256 === rule.definition.sha256 &&
          fact.unit === rule.unit &&
          isInsideSpell(fact.effectiveThrough, spell)
        );
      })
      .sort((left, right) =>
        left.result.reconciledFactId.localeCompare(right.result.reconciledFactId)
      );
    const calculated = metricAvailability(members);
    const effectiveThrough = members.reduce((latest, { result }) => {
      const effectiveDate = result.content.effectiveThrough.slice(0, 10);
      return effectiveDate > latest ? effectiveDate : latest;
    }, spell.startDate);
    return createAflTradeAcquisitionSpellMetric({
      schemaVersion: AFL_TRADE_ACQUISITION_SPELL_METRIC_SCHEMA_VERSION,
      publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
      authorityBoundary: AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
      publicationEligible: false,
      environment: policy.content.environment,
      competition: policy.content.competition,
      policyId: policy.policyId,
      policySha256: policy.policySha256,
      spell,
      rule,
      availability: calculated.availability,
      coverageNumerator: calculated.measuredCount,
      coverageDenominator: members.length,
      observationCount: calculated.measuredCount,
      effectiveThrough,
      members,
      recordedAt: request.recordedAt,
    });
  });
  const currentRevisionBySubject = new Map(
    request.currentHeadRevisions.map(({ subjectKey, revision }) => [subjectKey, revision])
  );
  const headAdvances = metrics.map((metric) => {
    const subjectKey = createAflTradeAcquisitionSpellMetricSubjectKey({
      environment: metric.content.environment,
      competition: metric.content.competition,
      spellVersionId: metric.content.spell.spellVersionId,
      metricCode: metric.content.rule.metricCode,
      definitionVersion: metric.content.rule.definitionVersion,
    });
    const expectedRevision = currentRevisionBySubject.get(subjectKey) ?? 0;
    return {
      subjectKey,
      expectedRevision,
      nextRevision: expectedRevision + 1,
      spellMetricVersionId: metric.spellMetricVersionId,
    };
  });

  return createAflTradeAcquisitionSpellMetricBatch({
    schemaVersion: AFL_TRADE_ACQUISITION_SPELL_METRIC_BATCH_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    policy,
    spell,
    metrics,
    headAdvances,
    recordedAt: request.recordedAt,
  });
}
