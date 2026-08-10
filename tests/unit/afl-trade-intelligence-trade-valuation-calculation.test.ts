import { describe, expect, it } from 'vitest';

import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeComponentDrawSet,
  type AflTradeComponentDrawSetContent,
} from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
import {
  createAflTradePackagePolicy,
  type AflTradePackagePolicyContent,
} from '@/server/aflTradeIntelligence/valuation/packagePolicy';
import {
  createAflTradeRealizedContributionLedger,
  type AflTradeRealizedContributionLedgerContent,
  type AflTradeRealizedContributionRecord,
} from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import {
  aflTradeValuationCalculationContentSchema,
  aflTradeValuationCalculationSchema,
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
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

function forecast(view: 'at_trade' | 'remaining', contribution: number) {
  return {
    view,
    timingTreatment: 'component_applied_football_timing_only_no_market_discount' as const,
    seasons: [
      {
        seasonOffset: 0,
        undiscountedContribution: contribution,
        footballTimingWeight: 1,
        timingAdjustedContribution: contribution,
      },
    ],
    undiscountedContribution: contribution,
    timingAdjustedContribution: contribution,
  };
}

function drawOutcome(
  assetId: string,
  componentRole: 'player_contribution_and_availability' | 'draft_pick_and_future_pick_distribution',
  atTrade: number,
  remaining: number
) {
  return {
    assetId,
    componentRole,
    forecasts: [forecast('at_trade', atTrade), forecast('remaining', remaining)],
  };
}

function drawSetContent(): AflTradeComponentDrawSetContent {
  const playerComponent = {
    role: 'player_contribution_and_availability' as const,
    modelKind: 'player_contribution_and_availability' as const,
    protocolId: `model-protocol:${digest('2')}`,
    runId: `model-run:${digest('3')}`,
    datasetId: `dataset:${digest('4')}`,
    gate3DecisionId: `gate-decision:${digest('5')}`,
  };
  const pickComponent = {
    role: 'draft_pick_and_future_pick_distribution' as const,
    modelKind: 'draft_pick_and_future_pick_distribution' as const,
    protocolId: `model-protocol:${digest('6')}`,
    runId: `model-run:${digest('7')}`,
    datasetId: `dataset:${digest('8')}`,
    gate3DecisionId: `gate-decision:${digest('9')}`,
  };
  return {
    schemaVersion: 'afl-trade-component-draw-set/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationBundleId: BUNDLE_ID,
    valueUnitId: VALUE_UNIT_ID,
    components: [playerComponent, pickComponent],
    execution: {
      mode: 'exact_joint_mixture',
      samplingAlgorithmVersion: null,
      seed: null,
      monteCarloError: 'zero_exact_enumeration',
    },
    assets: [
      {
        status: 'supported',
        assetId: 'asset:a-one',
        assetKind: 'player',
        componentRole: 'player_contribution_and_availability',
        forecastRepresentation: 'season_path',
      },
      {
        status: 'supported',
        assetId: 'asset:a-two',
        assetKind: 'current_pick_entitlement',
        componentRole: 'draft_pick_and_future_pick_distribution',
        forecastRepresentation: 'season_path',
      },
      {
        status: 'supported',
        assetId: 'asset:b-one',
        assetKind: 'future_pick_entitlement',
        componentRole: 'draft_pick_and_future_pick_distribution',
        forecastRepresentation: 'season_path',
      },
    ],
    draws: [
      {
        drawIndex: 0,
        drawKey: 'draw:zero',
        probabilityWeight: 0.4,
        sharedFactorStates: [
          { kind: 'draft_class', factorKey: 'draft-class:2025', stateId: 'strong' },
        ],
        assetOutcomes: [
          drawOutcome('asset:a-one', 'player_contribution_and_availability', 10, 4),
          drawOutcome('asset:a-two', 'draft_pick_and_future_pick_distribution', 5, 2),
          drawOutcome('asset:b-one', 'draft_pick_and_future_pick_distribution', 8, 4),
        ],
      },
      {
        drawIndex: 1,
        drawKey: 'draw:one',
        probabilityWeight: 0.6,
        sharedFactorStates: [
          { kind: 'draft_class', factorKey: 'draft-class:2025', stateId: 'weak' },
        ],
        assetOutcomes: [
          drawOutcome('asset:a-one', 'player_contribution_and_availability', 12, 6),
          drawOutcome('asset:a-two', 'draft_pick_and_future_pick_distribution', 3, 1),
          drawOutcome('asset:b-one', 'draft_pick_and_future_pick_distribution', 6, 3),
        ],
      },
    ],
    uncertaintyTreatments: [
      {
        kind: 'model_estimation',
        treatment: 'reported_separately',
        reasonCode: 'cluster-bootstrap',
      },
      {
        kind: 'outcome_distribution',
        treatment: 'included_in_draws',
        reasonCode: 'joint-outcome',
      },
      {
        kind: 'draft_class_shared_effect',
        treatment: 'included_in_draws',
        reasonCode: 'shared-class',
      },
      {
        kind: 'future_ladder_landing',
        treatment: 'included_in_draws',
        reasonCode: 'shared-ladder',
      },
      {
        kind: 'monte_carlo_error',
        treatment: 'not_available',
        reasonCode: 'exact-enumeration',
      },
    ],
    limitation:
      'Normalized source-independent component handoff only; not source approval, model calibration, Gate approval, or publication readiness.',
  };
}

function observedRecord(
  rootAssetId: string,
  contribution: number
): AflTradeRealizedContributionRecord {
  return {
    contributionRecordId: `contribution:${rootAssetId}`,
    rootAssetId,
    contributorPlayerAssetId: `player:${rootAssetId}`,
    aflClubId: 'club-a',
    custodySpellId: `custody:${rootAssetId}`,
    periodStartAt: '2025-03-01T00:00:00.000Z',
    periodEndAt: '2025-10-01T00:00:00.000Z',
    knownFrom: '2025-10-01T00:00:00.000Z',
    knownTo: null,
    evidenceId: `evidence:${rootAssetId}`,
    sourceObservationId: `observation:${rootAssetId}`,
    contributionDefinitionId: 'contribution-definition:v1',
    transformationVersion: 'transformation:v1',
    state: 'observed',
    contribution,
  };
}

function ledgerContent(): AflTradeRealizedContributionLedgerContent {
  return {
    schemaVersion: 'afl-trade-realized-contribution-ledger/v1',
    publicAssetBoundary: 'source_native_afl_players_no_user_or_fantasy_ownership',
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: `lineage-graph:${digest('a')}`,
    valueUnitId: VALUE_UNIT_ID,
    records: [
      observedRecord('asset:a-one', 3),
      observedRecord('asset:a-two', 0),
      {
        contributionRecordId: 'contribution:asset:b-one',
        rootAssetId: 'asset:b-one',
        contributorPlayerAssetId: 'player:asset:b-one',
        aflClubId: 'club-b',
        custodySpellId: 'custody:asset:b-one',
        periodStartAt: '2025-03-01T00:00:00.000Z',
        periodEndAt: '2025-10-01T00:00:00.000Z',
        knownFrom: '2025-10-01T00:00:00.000Z',
        knownTo: null,
        evidenceId: 'evidence:asset:b-one',
        sourceObservationId: 'observation:asset:b-one',
        contributionDefinitionId: 'contribution-definition:v1',
        transformationVersion: 'transformation:v1',
        state: 'unavailable',
        reasonCode: 'source-missing',
        explanation: 'The fabricated source observation is intentionally unavailable.',
      },
    ],
    missingnessPolicy: 'unavailable_is_explicit_and_never_coerced_to_zero',
    contributionCreditPolicy: 'receiving_afl_club_only_during_verified_custody',
    limitation:
      'Source-independent ledger contract only; records require lawfully approved evidence before any real valuation run.',
  };
}

function policyContent(utilityAvailable = true): AflTradePackagePolicyContent {
  return {
    schemaVersion: 'afl-trade-package-policy/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationBundleId: BUNDLE_ID,
    valueUnitId: VALUE_UNIT_ID,
    universalValueLayers: {
      calculationOrder: 'gross_then_list_spot_opportunity_cost_then_scarcity_adjustment',
      gross: {
        aggregation: 'sum_supported_lineage_frontier_contribution_exactly_once',
        negativeContributionTreatment: 'retain_without_flooring',
      },
      listSpot: {
        method: 'per_season_ranked_positive_contributors',
        ranking: 'descending_contribution_then_asset_id',
        unconstrainedPositiveContributorsPerSeason: 1,
        overflowRetentionTiers: [
          { firstOverflowRank: 1, lastOverflowRank: null, retentionRate: 0.5 },
        ],
        nonPositiveContributionTreatment: 'retain_without_consuming_positive_slot',
        policyArtifact: artifact('b'),
      },
      scarcity: {
        method: 'piecewise_linear_marginal_contribution_transform',
        input: 'post_list_spot_positive_asset_season_contribution',
        segments: [
          { lowerBoundInclusive: 0, upperBoundExclusive: 8, marginalMultiplier: 1 },
          { lowerBoundInclusive: 8, upperBoundExclusive: null, marginalMultiplier: 2 },
        ],
        nonPositiveContributionTreatment: 'retain_unchanged',
        policyArtifact: artifact('c'),
      },
    },
    clubUtility: utilityAvailable
      ? {
          status: 'available',
          calculation:
            'separate_club_specific_timing_and_role_congestion_never_relabels_universal_value',
          riskTreatment: 'distribution_reported_without_opaque_preference_collapse',
          profiles: [
            {
              aflClubId: 'club-a',
              profileEvidenceArtifact: artifact('d'),
              defaultSeasonTimingMultiplier: 1,
              seasonTimingMultipliers: [{ seasonOffset: 0, multiplier: 1.2 }],
              roleRules: [
                {
                  roleKey: 'midfield',
                  uncongestedContributorsPerSeason: 1,
                  overflowRetentionRate: 0.25,
                },
              ],
              assetRoleAssignments: [
                {
                  assetId: 'asset:a-one',
                  roleKey: 'midfield',
                  evidenceArtifact: artifact('e'),
                },
                {
                  assetId: 'asset:a-two',
                  roleKey: 'midfield',
                  evidenceArtifact: artifact('f'),
                },
              ],
            },
            {
              aflClubId: 'club-b',
              profileEvidenceArtifact: artifact('1'),
              defaultSeasonTimingMultiplier: 1,
              seasonTimingMultipliers: [],
              roleRules: [
                {
                  roleKey: 'draft-asset',
                  uncongestedContributorsPerSeason: 1,
                  overflowRetentionRate: 1,
                },
              ],
              assetRoleAssignments: [
                {
                  assetId: 'asset:b-one',
                  roleKey: 'draft-asset',
                  evidenceArtifact: artifact('2'),
                },
              ],
            },
          ],
        }
      : {
          status: 'unavailable',
          reasonCode: 'no-approved-club-policy',
          explanation: 'No evidence-backed club utility policy is approved for this calculation.',
        },
    excludedValueConcepts: {
      marketValue: 'separate_not_calculated_by_this_policy',
      contractValue: 'separate_and_unavailable_without_supported_data',
      commercialValue: 'separate_and_unavailable_without_supported_data',
    },
    legacySourceMetricsTreatment: 'excluded_from_every_policy_calculation',
    limitation:
      'Policy parameters require separately approved evidence and are not production defaults, source approval, model calibration, Gate approval, or publication readiness.',
  };
}

function valuationCase(
  componentDrawSetId: string,
  realizedContributionLedgerId: string,
  packagePolicyId: string
): AflTradeValuationCase {
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
    tradeId: 'trade:calculation-fixture',
    tradeEffectiveAt: TRADE_AT,
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: `lineage-graph:${digest('a')}`,
    componentDrawSetId,
    realizedContributionLedgerId,
    packagePolicyId,
    valueUnitId: VALUE_UNIT_ID,
    parties: [
      {
        aflClubId: 'club-a',
        clubName: 'Club A',
        receivedRootAssetIds: ['asset:a-one', 'asset:a-two'],
      },
      { aflClubId: 'club-b', clubName: 'Club B', receivedRootAssetIds: ['asset:b-one'] },
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

function inputs(utilityAvailable = true) {
  const drawSet = createAflTradeComponentDrawSet(drawSetContent());
  const ledger = createAflTradeRealizedContributionLedger(ledgerContent());
  const policy = createAflTradePackagePolicy(policyContent(utilityAvailable));
  const caseValue = valuationCase(
    drawSet.componentDrawSetId,
    ledger.realizedContributionLedgerId,
    policy.packagePolicyId
  );
  return { caseValue, drawSet, ledger, policy };
}

function partyView(
  calculation: AflTradeValuationCalculation,
  drawIndex: number,
  clubId: string,
  view: 'at_trade' | 'realized' | 'remaining' | 'current'
) {
  return calculation.content.draws[drawIndex].parties
    .find((party) => party.aflClubId === clubId)!
    .views.find((candidate) => candidate.view === view)!;
}

describe('AFL trade valuation calculation', () => {
  it('calculates gross, list-spot, scarcity, and separate club-utility layers per joint draw', () => {
    const value = inputs();
    const calculation = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );
    const atTrade = partyView(calculation, 0, 'club-a', 'at_trade');

    expect(atTrade.universal).toEqual({
      status: 'available',
      layers: { gross: 15, listSpotAdjusted: 12.5, scarcityAdjusted: 14.5 },
    });
    expect(atTrade.roots.map((root) => root.universal)).toEqual([
      {
        status: 'available',
        layers: { gross: 10, listSpotAdjusted: 10, scarcityAdjusted: 12 },
      },
      {
        status: 'available',
        layers: { gross: 5, listSpotAdjusted: 2.5, scarcityAdjusted: 2.5 },
      },
    ]);
    expect(atTrade.clubUtility).toEqual({ status: 'available', value: 13.5 });
    expect(atTrade.roots.map((root) => root.clubUtility)).toEqual([
      { status: 'available', value: 12 },
      { status: 'available', value: 1.5 },
    ]);
  });

  it('keeps realized contribution unadjusted and enforces current equals realized plus remaining', () => {
    const value = inputs();
    const calculation = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );
    const realized = partyView(calculation, 0, 'club-a', 'realized');
    const remaining = partyView(calculation, 0, 'club-a', 'remaining');
    const current = partyView(calculation, 0, 'club-a', 'current');

    expect(realized.universal).toEqual({
      status: 'available',
      layers: { gross: 3, listSpotAdjusted: 3, scarcityAdjusted: 3 },
    });
    expect(remaining.universal).toEqual({
      status: 'available',
      layers: { gross: 6, listSpotAdjusted: 5, scarcityAdjusted: 5 },
    });
    expect(current.universal).toEqual({
      status: 'available',
      layers: { gross: 9, listSpotAdjusted: 8, scarcityAdjusted: 8 },
    });
    expect(current.clubUtility).toEqual({ status: 'available', value: 8.4 });
    expect(aflTradeValuationCalculationSchema.parse(calculation)).toEqual(calculation);
  });

  it('propagates unavailable evidence with partial values instead of coercing it to zero', () => {
    const value = inputs();
    const calculation = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );
    const realized = partyView(calculation, 0, 'club-b', 'realized');
    const current = partyView(calculation, 0, 'club-b', 'current');

    expect(realized.universal).toEqual({
      status: 'unavailable',
      partialLayers: { gross: 0, listSpotAdjusted: 0, scarcityAdjusted: 0 },
      reasonCodes: ['realized_evidence_unavailable'],
    });
    expect(realized.roots[0].realizedEvidence).toEqual({
      observedRecordCount: 0,
      unavailableRecordCount: 1,
      state: 'unavailable_only',
    });
    expect(current.universal).toEqual({
      status: 'unavailable',
      partialLayers: { gross: 4, listSpotAdjusted: 4, scarcityAdjusted: 4 },
      reasonCodes: ['realized_evidence_unavailable'],
    });
  });

  it('replays deterministically without breaking joint draw weights or keys', () => {
    const value = inputs();
    const first = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );
    const second = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );

    expect(second).toEqual(first);
    expect(
      first.content.draws.map(({ drawKey, probabilityWeight }) => [drawKey, probabilityWeight])
    ).toEqual([
      ['draw:zero', 0.4],
      ['draw:one', 0.6],
    ]);
  });

  it('keeps unavailable club utility null and universal football value visible', () => {
    const value = inputs(false);
    const calculation = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );
    const atTrade = partyView(calculation, 0, 'club-a', 'at_trade');

    expect(atTrade.universal.status).toBe('available');
    expect(atTrade.clubUtility).toEqual({
      status: 'unavailable',
      partialValue: null,
      reasonCodes: ['club_utility_policy_unavailable'],
    });
  });

  it('fails closed across case references, bundles, roots, profiles, and role assignments', () => {
    const value = inputs();
    const unreferencedPolicy = createAflTradePackagePolicy(policyContent(false));
    expect(() =>
      calculateAflTradeValuation(value.caseValue, value.drawSet, value.ledger, unreferencedPolicy)
    ).toThrow(/must reference/i);

    const wrongBundleContent = policyContent();
    wrongBundleContent.valuationBundleId = `valuation-bundle:${digest('f')}`;
    const wrongBundlePolicy = createAflTradePackagePolicy(wrongBundleContent);
    expect(() =>
      calculateAflTradeValuation(
        valuationCase(
          value.drawSet.componentDrawSetId,
          value.ledger.realizedContributionLedgerId,
          wrongBundlePolicy.packagePolicyId
        ),
        value.drawSet,
        value.ledger,
        wrongBundlePolicy
      )
    ).toThrow(/same valuation bundle/i);

    const extraAssetContent = drawSetContent();
    extraAssetContent.assets.push({
      status: 'excluded',
      assetId: 'asset:outside-case',
      assetKind: 'unresolved',
      componentRole: null,
      reasonCode: 'unsupported',
      explanation: 'Fabricated extra asset outside the case frontier.',
    });
    const extraAssetDrawSet = createAflTradeComponentDrawSet(extraAssetContent);
    expect(() =>
      calculateAflTradeValuation(
        valuationCase(
          extraAssetDrawSet.componentDrawSetId,
          value.ledger.realizedContributionLedgerId,
          value.policy.packagePolicyId
        ),
        extraAssetDrawSet,
        value.ledger,
        value.policy
      )
    ).toThrow(/trade-root frontier/i);

    const missingProfileContent = policyContent();
    if (missingProfileContent.clubUtility.status !== 'available')
      throw new Error('Expected profiles.');
    missingProfileContent.clubUtility.profiles.pop();
    const missingProfilePolicy = createAflTradePackagePolicy(missingProfileContent);
    expect(() =>
      calculateAflTradeValuation(
        valuationCase(
          value.drawSet.componentDrawSetId,
          value.ledger.realizedContributionLedgerId,
          missingProfilePolicy.packagePolicyId
        ),
        value.drawSet,
        value.ledger,
        missingProfilePolicy
      )
    ).toThrow(/profile for every receiving AFL club/i);

    const missingRoleContent = policyContent();
    if (missingRoleContent.clubUtility.status !== 'available')
      throw new Error('Expected profiles.');
    missingRoleContent.clubUtility.profiles[0].assetRoleAssignments.pop();
    const missingRolePolicy = createAflTradePackagePolicy(missingRoleContent);
    expect(() =>
      calculateAflTradeValuation(
        valuationCase(
          value.drawSet.componentDrawSetId,
          value.ledger.realizedContributionLedgerId,
          missingRolePolicy.packagePolicyId
        ),
        value.drawSet,
        value.ledger,
        missingRolePolicy
      )
    ).toThrow(/role assignment/i);
  });

  it('rejects accounting, availability, and content-address tampering', () => {
    const value = inputs();
    const calculation = calculateAflTradeValuation(
      value.caseValue,
      value.drawSet,
      value.ledger,
      value.policy
    );
    const brokenIdentity = structuredClone(calculation.content);
    const current = brokenIdentity.draws[0].parties[0].views[3];
    if (current.universal.status !== 'available') throw new Error('Expected current value.');
    current.universal.layers.gross += 1;
    expect(aflTradeValuationCalculationContentSchema.safeParse(brokenIdentity).success).toBe(false);

    const brokenAvailability = structuredClone(calculation.content);
    const atTrade = brokenAvailability.draws[0].parties[0].views[0];
    if (atTrade.universal.status !== 'available') throw new Error('Expected at-trade value.');
    atTrade.universal = {
      status: 'unavailable',
      partialLayers: atTrade.universal.layers,
      reasonCodes: ['fabricated-unavailable'],
    };
    expect(aflTradeValuationCalculationContentSchema.safeParse(brokenAvailability).success).toBe(
      false
    );

    expect(
      aflTradeValuationCalculationSchema.safeParse({
        ...calculation,
        content: { ...calculation.content, valueUnitId: 'tampered-unit' },
      }).success
    ).toBe(false);
  });

  it.each(['userId', 'fantasyLeagueId', 'rosterOwnerId', 'legacyExpectedValue'])(
    'rejects forbidden calculation field %s',
    (field) => {
      const value = inputs();
      const calculation = calculateAflTradeValuation(
        value.caseValue,
        value.drawSet,
        value.ledger,
        value.policy
      );
      expect(
        aflTradeValuationCalculationContentSchema.safeParse({
          ...calculation.content,
          [field]: 'forbidden',
        }).success
      ).toBe(false);
    }
  );
});
