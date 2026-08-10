import { describe, expect, it } from 'vitest';

import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
  type AflTradeValuationCalculationContent,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
import {
  aflTradeValuationSnapshotContentSchema,
  aflTradeValuationSnapshotDefinitionsSchema,
  aflTradeValuationSnapshotSetSchema,
  createAflTradeValuationSnapshotSet,
  type AflTradeValuationSnapshotDefinitions,
} from '@/server/aflTradeIntelligence/valuation/valuationSnapshots';
import {
  createAflTradeValuationCase,
  type AflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';

const BUNDLE_ID = `valuation-bundle:${'1'.repeat(64)}`;
const VALUE_UNIT_ID = 'football-contribution-above-replacement-v1';
const TRADE_AT = '2024-10-10T00:00:00.000Z';
const CURRENT_AT = '2026-08-05T00:00:00.000Z';

function digest(character: string): string {
  return character.repeat(64);
}

function artifact(character: string): AflTradeArtifactRef {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function caseValue(): AflTradeValuationCase {
  const current = {
    modelVintage: 'current' as const,
    effectiveAt: CURRENT_AT,
    knowledgeCutoffAt: CURRENT_AT,
    valuationAsOf: CURRENT_AT,
  };
  return createAflTradeValuationCase({
    schemaVersion: 'afl-trade-valuation-case/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: 'trade:snapshot-fixture',
    tradeEffectiveAt: TRADE_AT,
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: `lineage-graph:${digest('2')}`,
    componentDrawSetId: `component-draw-set:${digest('3')}`,
    realizedContributionLedgerId: `realized-contribution-ledger:${digest('4')}`,
    packagePolicyId: `package-policy:${digest('5')}`,
    valueUnitId: VALUE_UNIT_ID,
    parties: [
      { aflClubId: 'club-a', clubName: 'Club A', receivedRootAssetIds: ['asset:a'] },
      { aflClubId: 'club-b', clubName: 'Club B', receivedRootAssetIds: ['asset:b'] },
    ],
    viewContexts: [
      {
        view: 'at_trade',
        modelVintage: 'historical_restatement',
        effectiveAt: TRADE_AT,
        knowledgeCutoffAt: TRADE_AT,
        valuationAsOf: TRADE_AT,
      },
      { view: 'realized', ...current },
      { view: 'remaining', ...current },
      { view: 'current', ...current },
    ],
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
  });
}

function layers(value: number) {
  return { gross: value, listSpotAdjusted: value, scarcityAdjusted: value };
}

function availableUniversal(value: number) {
  return { status: 'available' as const, layers: layers(value) };
}

function unavailableUniversal(value: number, reasonCode: string) {
  return {
    status: 'unavailable' as const,
    partialLayers: layers(value),
    reasonCodes: [reasonCode],
  };
}

function party(
  clubId: 'club-a' | 'club-b',
  atTrade: number,
  remaining: number,
  realizedAvailable: boolean
) {
  const assetId = clubId === 'club-a' ? 'asset:a' : 'asset:b';
  const realized = clubId === 'club-a' ? 3 : 0;
  const evidence =
    clubId === 'club-a'
      ? {
          observedRecordCount: 1,
          unavailableRecordCount: 0,
          state: 'observed_only' as const,
        }
      : {
          observedRecordCount: 0,
          unavailableRecordCount: 1,
          state: 'unavailable_only' as const,
        };
  const view = (
    viewName: 'at_trade' | 'realized' | 'remaining' | 'current',
    value: number,
    available: boolean
  ) => {
    const universal = available
      ? availableUniversal(value)
      : unavailableUniversal(value, 'realized_evidence_unavailable');
    const clubUtility = available
      ? { status: 'available' as const, value }
      : {
          status: 'unavailable' as const,
          partialValue: value,
          reasonCodes: ['realized_evidence_unavailable'],
        };
    return {
      view: viewName,
      roots: [
        {
          assetId,
          forecastSupport: 'supported' as const,
          universal,
          clubUtility,
          realizedEvidence: evidence,
        },
      ],
      universal,
      clubUtility,
    };
  };
  return {
    aflClubId: clubId,
    views: [
      view('at_trade', atTrade, true),
      view('realized', realized, realizedAvailable),
      view('remaining', remaining, true),
      view('current', realized + remaining, realizedAvailable),
    ],
  };
}

function calculation(valuationCase: AflTradeValuationCase): AflTradeValuationCalculation {
  const content: AflTradeValuationCalculationContent = {
    schemaVersion: 'afl-trade-valuation-calculation/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationCaseId: valuationCase.valuationCaseId,
    valuationBundleId: BUNDLE_ID,
    componentDrawSetId: valuationCase.content.componentDrawSetId,
    realizedContributionLedgerId: valuationCase.content.realizedContributionLedgerId,
    packagePolicyId: valuationCase.content.packagePolicyId,
    valueUnitId: VALUE_UNIT_ID,
    execution: {
      mode: 'exact_joint_mixture',
      samplingAlgorithmVersion: null,
      seed: null,
      monteCarloError: 'zero_exact_enumeration',
    },
    realizedPolicyTreatment:
      'measured_contribution_is_not_rewritten_by_list_spot_scarcity_or_club_utility_policy',
    currentOutcomeIdentity: 'realized_plus_remaining_per_root_draw_club_and_layer',
    missingnessTreatment: 'unavailable_inputs_propagate_with_partial_values_never_coerced_to_zero',
    draws: [
      {
        drawIndex: 0,
        drawKey: 'draw:zero',
        probabilityWeight: 0.4,
        parties: [party('club-a', 10, 4, true), party('club-b', 12, 5, false)],
      },
      {
        drawIndex: 1,
        drawKey: 'draw:one',
        probabilityWeight: 0.6,
        parties: [party('club-a', 20, 6, true), party('club-b', 18, 7, false)],
      },
    ],
    limitation:
      'Deterministic source-independent calculation only; output is not source approval, model calibration, Gate approval, or publication readiness.',
  };
  return aflTradeValuationCalculationSchema.parse({
    valuationCalculationId: createAflTradeContentAddress('valuation-calculation', content),
    content,
  });
}

function definitions(): AflTradeValuationSnapshotDefinitions {
  return {
    quantileMethod: 'weighted_inverse_cdf_left_continuous',
    centralIntervalLevel: 0.8,
    downsideQuantile: 0.1,
    upsideQuantile: 0.9,
    lowReturnThreshold: 11,
    eliteOutcomeThreshold: 19,
    practicalEquivalenceTolerance: 1,
    lowReturnDefinitionArtifact: artifact('6'),
    eliteOutcomeDefinitionArtifact: artifact('7'),
    practicalEquivalenceDefinitionArtifact: artifact('8'),
    confidence: {
      status: 'unavailable',
      reasonCode: 'no-approved-confidence-report',
      explanation: 'No evidence-backed confidence report is approved for this fixture.',
    },
    samplingUncertainty: { mode: 'exact', monteCarloStandardError: 0 },
  };
}

describe('AFL trade valuation snapshots', () => {
  it('summarizes weighted distributions with the governed quantile method', () => {
    const valuationCase = caseValue();
    const set = createAflTradeValuationSnapshotSet(
      calculation(valuationCase),
      valuationCase,
      definitions(),
      '2026-08-05T01:00:00.000Z'
    );
    const atTrade = set.content.snapshots[0];
    const clubA = atTrade.content.parties[0];
    const gross = clubA.universal[0].distribution;

    expect(gross).toEqual({
      status: 'available',
      availableProbabilityMass: 1,
      statistics: {
        mean: 16,
        median: 20,
        centralInterval: { level: 0.8, lower: 10, upper: 20 },
        downside: { quantile: 0.1, value: 10 },
        upside: { quantile: 0.9, value: 20 },
        lowReturnProbability: 0.4,
        eliteOutcomeProbability: 0.6,
      },
      conditionalOnAvailableStatistics: null,
      reasonCodes: [],
    });
  });

  it('calculates every pairwise club comparison from aligned joint draws', () => {
    const valuationCase = caseValue();
    const set = createAflTradeValuationSnapshotSet(
      calculation(valuationCase),
      valuationCase,
      definitions(),
      '2026-08-05T01:00:00.000Z'
    );
    const comparison = set.content.snapshots[0].content.pairwiseComparisons[0];

    expect(comparison).toMatchObject({
      leftAflClubId: 'club-a',
      rightAflClubId: 'club-b',
    });
    expect(comparison.universal[0]).toMatchObject({
      layer: 'gross',
      comparison: {
        status: 'available',
        probabilities: { leftAhead: 0.6, practicallyEquivalent: 0, rightAhead: 0.4 },
      },
    });
  });

  it('does not publish complete statistics or comparisons when evidence is unavailable', () => {
    const valuationCase = caseValue();
    const set = createAflTradeValuationSnapshotSet(
      calculation(valuationCase),
      valuationCase,
      definitions(),
      '2026-08-05T01:00:00.000Z'
    );
    const realized = set.content.snapshots[1].content;
    const clubB = realized.parties[1].universal[0].distribution;
    const comparison = realized.pairwiseComparisons[0].universal[0].comparison;

    expect(clubB).toEqual({
      status: 'unavailable',
      availableProbabilityMass: 0,
      statistics: null,
      conditionalOnAvailableStatistics: null,
      reasonCodes: ['realized_evidence_unavailable'],
    });
    expect(comparison).toEqual({
      status: 'unavailable',
      availableProbabilityMass: 0,
      probabilities: null,
      conditionalOnAvailableProbabilities: null,
      reasonCodes: ['realized_evidence_unavailable'],
    });
  });

  it('creates deterministic immutable snapshots for every valuation view', () => {
    const valuationCase = caseValue();
    const value = calculation(valuationCase);
    const first = createAflTradeValuationSnapshotSet(
      value,
      valuationCase,
      definitions(),
      '2026-08-05T01:00:00.000Z'
    );
    const second = createAflTradeValuationSnapshotSet(
      value,
      valuationCase,
      definitions(),
      '2026-08-05T01:00:00.000Z'
    );

    expect(second).toEqual(first);
    expect(first.content.snapshots.map((snapshot) => snapshot.content.viewContext.view)).toEqual([
      'at_trade',
      'realized',
      'remaining',
      'current',
    ]);
    expect(aflTradeValuationSnapshotSetSchema.parse(first)).toEqual(first);
  });

  it('requires uncertainty reporting to match exact versus sampled execution', () => {
    const valuationCase = caseValue();
    const exactCalculation = calculation(valuationCase);
    const sampledDefinitions = definitions();
    sampledDefinitions.samplingUncertainty = {
      mode: 'sampled_unavailable',
      reasonCode: 'not-estimated',
      explanation: 'Sampling uncertainty was not estimated.',
    };
    expect(() =>
      createAflTradeValuationSnapshotSet(
        exactCalculation,
        valuationCase,
        sampledDefinitions,
        '2026-08-05T01:00:00.000Z'
      )
    ).toThrow(/exact zero Monte Carlo/i);

    const sampledContent = structuredClone(exactCalculation.content);
    sampledContent.execution = {
      mode: 'deterministic_counter_sample',
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1',
      seed: 'snapshot-fixture-seed',
      monteCarloError: 'requires_downstream_reporting',
    };
    const sampledCalculation = aflTradeValuationCalculationSchema.parse({
      valuationCalculationId: createAflTradeContentAddress('valuation-calculation', sampledContent),
      content: sampledContent,
    });
    expect(() =>
      createAflTradeValuationSnapshotSet(
        sampledCalculation,
        valuationCase,
        definitions(),
        '2026-08-05T01:00:00.000Z'
      )
    ).toThrow(/cannot claim exact/i);
  });

  it('rejects invalid thresholds, case mismatches, and malformed evidence artifacts', () => {
    const invalidThresholds = definitions();
    invalidThresholds.eliteOutcomeThreshold = invalidThresholds.lowReturnThreshold;
    expect(aflTradeValuationSnapshotDefinitionsSchema.safeParse(invalidThresholds).success).toBe(
      false
    );

    const invalidArtifact = definitions();
    invalidArtifact.lowReturnDefinitionArtifact = {
      ...artifact('9'),
      storageUri: `artifact://sha256/${digest('a')}`,
    };
    expect(aflTradeValuationSnapshotDefinitionsSchema.safeParse(invalidArtifact).success).toBe(
      false
    );

    const valuationCase = caseValue();
    expect(() =>
      createAflTradeValuationSnapshotSet(
        calculation(valuationCase),
        caseValue(),
        definitions(),
        '2026-08-05T01:00:00.000Z'
      )
    ).not.toThrow();
    const otherCaseContent = {
      ...valuationCase.content,
      tradeId: 'trade:other-snapshot-fixture',
    };
    const otherCase = createAflTradeValuationCase(otherCaseContent);
    expect(() =>
      createAflTradeValuationSnapshotSet(
        calculation(valuationCase),
        otherCase,
        definitions(),
        '2026-08-05T01:00:00.000Z'
      )
    ).toThrow(/references do not match/i);
  });

  it('rejects layer, pair, numerical, ownership, and content-address tampering', () => {
    const valuationCase = caseValue();
    const set = createAflTradeValuationSnapshotSet(
      calculation(valuationCase),
      valuationCase,
      definitions(),
      '2026-08-05T01:00:00.000Z'
    );
    const snapshot = set.content.snapshots[0];
    const reversedLayers = structuredClone(snapshot.content);
    reversedLayers.parties[0].universal.reverse();
    expect(aflTradeValuationSnapshotContentSchema.safeParse(reversedLayers).success).toBe(false);

    const invalidProbability = structuredClone(snapshot.content);
    const comparison = invalidProbability.pairwiseComparisons[0].universal[0].comparison;
    if (comparison.status !== 'available') throw new Error('Expected comparison.');
    comparison.probabilities.leftAhead = 0.7;
    expect(aflTradeValuationSnapshotContentSchema.safeParse(invalidProbability).success).toBe(
      false
    );

    expect(
      aflTradeValuationSnapshotContentSchema.safeParse({
        ...snapshot.content,
        userId: 'forbidden',
      }).success
    ).toBe(false);
    expect(
      aflTradeValuationSnapshotSetSchema.safeParse({
        ...set,
        content: {
          ...set.content,
          snapshots: [
            {
              ...set.content.snapshots[0],
              content: { ...set.content.snapshots[0].content, valueUnitId: 'tampered-unit' },
            },
            ...set.content.snapshots.slice(1),
          ],
        },
      }).success
    ).toBe(false);
  });
});
