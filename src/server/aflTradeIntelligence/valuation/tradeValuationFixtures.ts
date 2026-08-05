import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type {
  AflTradeAsset,
  AflTradeAssetCustodySpell,
  AflTradeLineageEdge,
  AflTradeLineageGraph,
} from '../domain/lineageTypes';
import {
  createAflTradeComponentDrawSet,
  type AflTradeComponentDrawSet,
  type AflTradeComponentDrawSetContent,
} from './componentDrawSet';
import {
  createAflTradePackagePolicy,
  type AflTradePackagePolicy,
  type AflTradePackagePolicyContent,
} from './packagePolicy';
import {
  createAflTradeRealizedContributionLedger,
  type AflTradeRealizedContributionLedger,
  type AflTradeRealizedContributionLedgerContent,
  type AflTradeRealizedContributionRecord,
} from './realizedContributionLedger';
import {
  createAflTradeStructuredExplanation,
  type AflTradeStructuredExplanation,
} from './structuredExplanations';
import {
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import {
  createAflTradeLineageGraphId,
  createAflTradeValuationCase,
  type AflTradeValuationCase,
} from './valuationCaseContracts';
import {
  createAflTradeValuationSnapshotSet,
  type AflTradeValuationSnapshotDefinitions,
  type AflTradeValuationSnapshotSet,
} from './valuationSnapshots';

export const AFL_TRADE_VALUATION_FIXTURE_KINDS = [
  'two_party_player_swap',
  'three_party_exchange',
  'future_pick_resolution',
  'on_traded_pick_return',
] as const;

export type AflTradeValuationFixtureKind = (typeof AFL_TRADE_VALUATION_FIXTURE_KINDS)[number];

export interface FabricatedAflTradeValuationFixture {
  fixtureKind: AflTradeValuationFixtureKind;
  evidenceClassification: 'fabricated_test_evidence_not_real_afl_data';
  valuationCase: AflTradeValuationCase;
  lineageGraph: AflTradeLineageGraph;
  componentDrawSet: AflTradeComponentDrawSet;
  realizedContributionLedger: AflTradeRealizedContributionLedger;
  packagePolicy: AflTradePackagePolicy;
  calculation: AflTradeValuationCalculation;
  snapshotSet: AflTradeValuationSnapshotSet;
  explanation: AflTradeStructuredExplanation;
}

const T = {
  trade: '2024-10-10T00:00:00.000Z',
  onTrade: '2024-11-01T00:00:00.000Z',
  resolve: '2025-01-01T00:00:00.000Z',
  draft: '2025-02-01T00:00:00.000Z',
  seasonStart: '2025-03-01T00:00:00.000Z',
  seasonEnd: '2025-10-01T00:00:00.000Z',
  current: '2026-08-05T00:00:00.000Z',
  snapshot: '2026-08-05T01:00:00.000Z',
} as const;

const BUNDLE_ID = `valuation-bundle:${'1'.repeat(64)}`;
const VALUE_UNIT_ID = 'fabricated-football-contribution-above-replacement-v1';

type RootFlow = 'player' | 'future_pick' | 'on_traded_pick';

interface RootSpec {
  rootAssetId: string;
  aflClubId: string;
  clubName: string;
  flow: RootFlow;
}

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
    createdAt: T.current,
  };
}

function asset(assetId: string, assetType: AflTradeAsset['assetType'], effectiveFrom: string) {
  return {
    assetId,
    assetType,
    effectiveFrom,
    knownFrom: effectiveFrom,
    knownTo: null,
    evidenceId: `fabricated-evidence:${assetId}`,
  } satisfies AflTradeAsset;
}

function custody(
  custodySpellId: string,
  assetId: string,
  aflClubId: string,
  effectiveFrom: string,
  effectiveTo: string | null
) {
  return {
    custodySpellId,
    assetId,
    aflClubId,
    effectiveFrom,
    effectiveTo,
    knownFrom: effectiveFrom,
    knownTo: null,
    evidenceId: `fabricated-evidence:${custodySpellId}`,
  } satisfies AflTradeAssetCustodySpell;
}

function edge(
  edgeId: string,
  kind: AflTradeLineageEdge['kind'],
  sourceAssetId: string,
  targetAssetId: string,
  effectiveAt: string
) {
  return {
    edgeId,
    kind,
    sourceAssetId,
    targetAssetId,
    effectiveAt,
    knownFrom: effectiveAt,
    knownTo: null,
    evidenceId: `fabricated-evidence:${edgeId}`,
    ruleVersion: 'fabricated-valuation-fixture/v1',
  } satisfies AflTradeLineageEdge;
}

function lineageForRoot(spec: RootSpec): {
  assets: AflTradeAsset[];
  custodySpells: AflTradeAssetCustodySpell[];
  edges: AflTradeLineageEdge[];
  contributorPlayerAssetId: string;
  contributorCustodySpellId: string;
} {
  const custodyId = (assetId: string) => `custody:${assetId}:${spec.aflClubId}`;
  if (spec.flow === 'player') {
    return {
      assets: [asset(spec.rootAssetId, 'player', T.trade)],
      custodySpells: [
        custody(custodyId(spec.rootAssetId), spec.rootAssetId, spec.aflClubId, T.trade, null),
      ],
      edges: [],
      contributorPlayerAssetId: spec.rootAssetId,
      contributorCustodySpellId: custodyId(spec.rootAssetId),
    };
  }

  const prefix = spec.rootAssetId;
  const resolvedPick = `${prefix}:resolved-pick`;
  const selection = `${prefix}:selection`;
  const player = `${prefix}:selected-player`;
  if (spec.flow === 'future_pick') {
    return {
      assets: [
        asset(spec.rootAssetId, 'future_pick_entitlement', T.trade),
        asset(resolvedPick, 'current_pick_entitlement', T.resolve),
        asset(selection, 'draft_selection', T.draft),
        asset(player, 'player', T.draft),
      ],
      custodySpells: [
        custody(custodyId(spec.rootAssetId), spec.rootAssetId, spec.aflClubId, T.trade, T.resolve),
        custody(custodyId(resolvedPick), resolvedPick, spec.aflClubId, T.resolve, T.draft),
        custody(custodyId(player), player, spec.aflClubId, T.draft, null),
      ],
      edges: [
        edge(
          `edge:${prefix}:resolve`,
          'future_right_resolved_to_pick',
          spec.rootAssetId,
          resolvedPick,
          T.resolve
        ),
        edge(
          `edge:${prefix}:exercise`,
          'pick_exercised_at_selection',
          resolvedPick,
          selection,
          T.draft
        ),
        edge(`edge:${prefix}:player`, 'selection_created_player', selection, player, T.draft),
      ],
      contributorPlayerAssetId: player,
      contributorCustodySpellId: custodyId(player),
    };
  }

  const returnRight = `${prefix}:on-trade-return`;
  return {
    assets: [
      asset(spec.rootAssetId, 'current_pick_entitlement', T.trade),
      asset(returnRight, 'future_pick_entitlement', T.onTrade),
      asset(resolvedPick, 'current_pick_entitlement', T.resolve),
      asset(selection, 'draft_selection', T.draft),
      asset(player, 'player', T.draft),
    ],
    custodySpells: [
      custody(custodyId(spec.rootAssetId), spec.rootAssetId, spec.aflClubId, T.trade, T.onTrade),
      custody(custodyId(returnRight), returnRight, spec.aflClubId, T.onTrade, T.resolve),
      custody(custodyId(resolvedPick), resolvedPick, spec.aflClubId, T.resolve, T.draft),
      custody(custodyId(player), player, spec.aflClubId, T.draft, null),
    ],
    edges: [
      edge(
        `edge:${prefix}:on-trade`,
        'asset_traded_for_asset',
        spec.rootAssetId,
        returnRight,
        T.onTrade
      ),
      edge(
        `edge:${prefix}:resolve`,
        'future_right_resolved_to_pick',
        returnRight,
        resolvedPick,
        T.resolve
      ),
      edge(
        `edge:${prefix}:exercise`,
        'pick_exercised_at_selection',
        resolvedPick,
        selection,
        T.draft
      ),
      edge(`edge:${prefix}:player`, 'selection_created_player', selection, player, T.draft),
    ],
    contributorPlayerAssetId: player,
    contributorCustodySpellId: custodyId(player),
  };
}

function specsFor(kind: AflTradeValuationFixtureKind): RootSpec[] {
  if (kind === 'three_party_exchange') {
    return ['a', 'b', 'c'].map((suffix) => ({
      rootAssetId: `fixture:${kind}:player:${suffix}`,
      aflClubId: `fixture-club-${suffix}`,
      clubName: `Fabricated Club ${suffix.toUpperCase()}`,
      flow: 'player' as const,
    }));
  }
  if (kind === 'future_pick_resolution') {
    return [
      {
        rootAssetId: `fixture:${kind}:future-pick:a`,
        aflClubId: 'fixture-club-a',
        clubName: 'Fabricated Club A',
        flow: 'future_pick',
      },
      {
        rootAssetId: `fixture:${kind}:player:b`,
        aflClubId: 'fixture-club-b',
        clubName: 'Fabricated Club B',
        flow: 'player',
      },
    ];
  }
  if (kind === 'on_traded_pick_return') {
    return [
      {
        rootAssetId: `fixture:${kind}:pick:a`,
        aflClubId: 'fixture-club-a',
        clubName: 'Fabricated Club A',
        flow: 'on_traded_pick',
      },
      {
        rootAssetId: `fixture:${kind}:player:b`,
        aflClubId: 'fixture-club-b',
        clubName: 'Fabricated Club B',
        flow: 'player',
      },
    ];
  }
  return ['a', 'b'].map((suffix) => ({
    rootAssetId: `fixture:${kind}:player:${suffix}`,
    aflClubId: `fixture-club-${suffix}`,
    clubName: `Fabricated Club ${suffix.toUpperCase()}`,
    flow: 'player' as const,
  }));
}

function forecast(view: 'at_trade' | 'remaining', value: number) {
  return {
    view,
    timingTreatment: 'component_applied_football_timing_only_no_market_discount' as const,
    seasons: [
      {
        seasonOffset: 0,
        undiscountedContribution: value,
        footballTimingWeight: 1,
        timingAdjustedContribution: value,
      },
    ],
    undiscountedContribution: value,
    timingAdjustedContribution: value,
  };
}

function componentDrawSetContent(specs: RootSpec[]): AflTradeComponentDrawSetContent {
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
    assets: specs.map((spec) => ({
      status: 'supported' as const,
      assetId: spec.rootAssetId,
      assetKind:
        spec.flow === 'player'
          ? ('player' as const)
          : spec.flow === 'future_pick'
            ? ('future_pick_entitlement' as const)
            : ('current_pick_entitlement' as const),
      componentRole:
        spec.flow === 'player'
          ? ('player_contribution_and_availability' as const)
          : ('draft_pick_and_future_pick_distribution' as const),
      forecastRepresentation: 'season_path' as const,
    })),
    draws: [0.4, 0.6].map((probabilityWeight, drawIndex) => ({
      drawIndex,
      drawKey: `fixture-draw:${drawIndex}`,
      probabilityWeight,
      sharedFactorStates: [
        {
          kind: 'draft_class' as const,
          factorKey: 'fixture-draft-class',
          stateId: `fixture-state:${drawIndex}`,
        },
      ],
      assetOutcomes: specs.map((spec, assetIndex) => {
        const base = (assetIndex + 1) * 5;
        const factor = drawIndex === 0 ? 0.8 : 1.2;
        return {
          assetId: spec.rootAssetId,
          componentRole:
            spec.flow === 'player'
              ? ('player_contribution_and_availability' as const)
              : ('draft_pick_and_future_pick_distribution' as const),
          forecasts: [
            forecast('at_trade', base * factor),
            forecast('remaining', base * factor * 0.5),
          ],
        };
      }),
    })),
    uncertaintyTreatments: [
      {
        kind: 'model_estimation',
        treatment: 'reported_separately',
        reasonCode: 'fabricated-bootstrap',
      },
      {
        kind: 'outcome_distribution',
        treatment: 'included_in_draws',
        reasonCode: 'fabricated-outcome',
      },
      {
        kind: 'draft_class_shared_effect',
        treatment: 'included_in_draws',
        reasonCode: 'fabricated-shared-class',
      },
      {
        kind: 'future_ladder_landing',
        treatment: 'included_in_draws',
        reasonCode: 'fabricated-ladder',
      },
      {
        kind: 'monte_carlo_error',
        treatment: 'not_available',
        reasonCode: 'exact-fixture',
      },
    ],
    limitation:
      'Normalized source-independent component handoff only; not source approval, model calibration, Gate approval, or publication readiness.',
  };
}

function ledgerContent(
  graph: AflTradeLineageGraph,
  specs: RootSpec[],
  lineageByRoot: ReadonlyMap<string, ReturnType<typeof lineageForRoot>>
): AflTradeRealizedContributionLedgerContent {
  const records: AflTradeRealizedContributionRecord[] = specs.map((spec, index) => {
    const lineage = lineageByRoot.get(spec.rootAssetId)!;
    return {
      contributionRecordId: `contribution:${spec.rootAssetId}`,
      rootAssetId: spec.rootAssetId,
      contributorPlayerAssetId: lineage.contributorPlayerAssetId,
      aflClubId: spec.aflClubId,
      custodySpellId: lineage.contributorCustodySpellId,
      periodStartAt: T.seasonStart,
      periodEndAt: T.seasonEnd,
      knownFrom: T.seasonEnd,
      knownTo: null,
      evidenceId: `fabricated-evidence:contribution:${spec.rootAssetId}`,
      sourceObservationId: `fabricated-observation:${spec.rootAssetId}`,
      contributionDefinitionId: 'fabricated-contribution-definition:v1',
      transformationVersion: 'fabricated-transformation:v1',
      state: 'observed',
      contribution: index + 1,
    };
  });
  return {
    schemaVersion: 'afl-trade-realized-contribution-ledger/v1',
    publicAssetBoundary: 'source_native_afl_players_no_user_or_fantasy_ownership',
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: createAflTradeLineageGraphId(graph),
    valueUnitId: VALUE_UNIT_ID,
    records,
    missingnessPolicy: 'unavailable_is_explicit_and_never_coerced_to_zero',
    contributionCreditPolicy: 'receiving_afl_club_only_during_verified_custody',
    limitation:
      'Source-independent ledger contract only; records require lawfully approved evidence before any real valuation run.',
  };
}

function packagePolicyContent(specs: RootSpec[]): AflTradePackagePolicyContent {
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
        policyArtifact: artifact('a'),
      },
      scarcity: {
        method: 'piecewise_linear_marginal_contribution_transform',
        input: 'post_list_spot_positive_asset_season_contribution',
        segments: [{ lowerBoundInclusive: 0, upperBoundExclusive: null, marginalMultiplier: 1 }],
        nonPositiveContributionTreatment: 'retain_unchanged',
        policyArtifact: artifact('b'),
      },
    },
    clubUtility: {
      status: 'available',
      calculation:
        'separate_club_specific_timing_and_role_congestion_never_relabels_universal_value',
      riskTreatment: 'distribution_reported_without_opaque_preference_collapse',
      profiles: specs.map((spec, index) => ({
        aflClubId: spec.aflClubId,
        profileEvidenceArtifact: artifact(index % 2 === 0 ? 'c' : 'd'),
        defaultSeasonTimingMultiplier: 1,
        seasonTimingMultipliers: [],
        roleRules: [
          {
            roleKey: 'fixture-role',
            uncongestedContributorsPerSeason: 1,
            overflowRetentionRate: 0.5,
          },
        ],
        assetRoleAssignments: [
          {
            assetId: spec.rootAssetId,
            roleKey: 'fixture-role',
            evidenceArtifact: artifact(index % 2 === 0 ? 'e' : 'f'),
          },
        ],
      })),
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

function snapshotDefinitions(): AflTradeValuationSnapshotDefinitions {
  return {
    quantileMethod: 'weighted_inverse_cdf_left_continuous',
    centralIntervalLevel: 0.8,
    downsideQuantile: 0.1,
    upsideQuantile: 0.9,
    lowReturnThreshold: 2,
    eliteOutcomeThreshold: 20,
    practicalEquivalenceTolerance: 0.5,
    lowReturnDefinitionArtifact: artifact('2'),
    eliteOutcomeDefinitionArtifact: artifact('3'),
    practicalEquivalenceDefinitionArtifact: artifact('4'),
    confidence: {
      status: 'unavailable',
      reasonCode: 'fabricated-fixture-no-confidence-claim',
      explanation: 'Fabricated fixtures cannot establish real data or model confidence.',
    },
    samplingUncertainty: { mode: 'exact', monteCarloStandardError: 0 },
  };
}

export function createFabricatedAflTradeValuationFixture(
  fixtureKind: AflTradeValuationFixtureKind
): FabricatedAflTradeValuationFixture {
  const specs = specsFor(fixtureKind).sort((left, right) =>
    left.aflClubId.localeCompare(right.aflClubId)
  );
  const lineageByRoot = new Map(
    specs.map((spec) => [spec.rootAssetId, lineageForRoot(spec)] as const)
  );
  const lineageGraph: AflTradeLineageGraph = {
    assets: [...lineageByRoot.values()].flatMap((lineage) => lineage.assets),
    custodySpells: [...lineageByRoot.values()].flatMap((lineage) => lineage.custodySpells),
    edges: [...lineageByRoot.values()].flatMap((lineage) => lineage.edges),
    dispositions: [],
    corrections: [],
  };
  const componentDrawSet = createAflTradeComponentDrawSet(componentDrawSetContent(specs));
  const realizedContributionLedger = createAflTradeRealizedContributionLedger(
    ledgerContent(lineageGraph, specs, lineageByRoot)
  );
  const packagePolicy = createAflTradePackagePolicy(packagePolicyContent(specs));
  const current = {
    modelVintage: 'current' as const,
    effectiveAt: T.current,
    knowledgeCutoffAt: T.current,
    valuationAsOf: T.current,
  };
  const valuationCase = createAflTradeValuationCase({
    schemaVersion: 'afl-trade-valuation-case/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: `fabricated-trade:${fixtureKind}`,
    tradeEffectiveAt: T.trade,
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
    componentDrawSetId: componentDrawSet.componentDrawSetId,
    realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
    valueUnitId: VALUE_UNIT_ID,
    parties: specs.map((spec) => ({
      aflClubId: spec.aflClubId,
      clubName: spec.clubName,
      receivedRootAssetIds: [spec.rootAssetId],
    })),
    viewContexts: [
      {
        view: 'at_trade',
        modelVintage: 'historical_restatement',
        effectiveAt: T.trade,
        knowledgeCutoffAt: T.trade,
        valuationAsOf: T.trade,
      },
      { view: 'realized', ...current },
      { view: 'remaining', ...current },
      { view: 'current', ...current },
    ],
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
  });
  const calculation = calculateAflTradeValuation(
    valuationCase,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy
  );
  const snapshotSet = createAflTradeValuationSnapshotSet(
    calculation,
    valuationCase,
    snapshotDefinitions(),
    T.snapshot
  );
  const explanation = createAflTradeStructuredExplanation(calculation, snapshotSet, valuationCase);
  return {
    fixtureKind,
    evidenceClassification: 'fabricated_test_evidence_not_real_afl_data',
    valuationCase,
    lineageGraph,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    calculation,
    snapshotSet,
    explanation,
  };
}

export function createAllFabricatedAflTradeValuationFixtures() {
  return AFL_TRADE_VALUATION_FIXTURE_KINDS.map(createFabricatedAflTradeValuationFixture);
}
