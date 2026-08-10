// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
  aflTradeValuationBundleManifestV2Schema,
  type AflTradeValuationBundleManifestV2,
} from '@/server/aflTradeIntelligence/artifacts/valuationBundleManifest';
import { createAflTradeComponentDrawSet } from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
import { AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION } from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
  type AflTradeJointOutcomeValueQuantizationPolicy,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeValueQuantization';
import {
  aflTradeValuationComparisonSchema,
  createAflTradeValuationComparison,
  type AflTradeValuationComparison,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparisonArtifact';
import { createAflTradePackagePolicy } from '@/server/aflTradeIntelligence/valuation/packagePolicy';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
  type AflTradeStructuralWeightedDistributionPolicy,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  aflTradeStructuredExplanationV2Schema,
  createAflTradeStructuredExplanationV2,
  type AflTradeStructuredExplanationV2,
} from '@/server/aflTradeIntelligence/valuation/structuredExplanationsV2';
import {
  aflTradeValuationCalculationSchema,
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import {
  createAflTradeValuationCase,
  type AflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import {
  aflTradeValuationDistributionSchema,
  createAflTradeValuationDistribution,
  type AflTradeValuationDistribution,
  type AflTradeValuationDistributionMeasure,
  type AflTradeValuationDistributionSubject,
} from '@/server/aflTradeIntelligence/valuation/valuationDistributionArtifact';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_BYTES,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT,
  AflTradeValuationOutputInventoryConstructionError,
  aflTradeValuationOutputInventoryContentSchema,
  aflTradeValuationOutputInventoryResultSchema,
  aflTradeValuationOutputInventorySchema,
  aflTradeValuationOutputInventoryShardSchema,
  createAflTradeValuationOutputInventory,
  isAflTradeValuationOutputInventoryConstructionError,
  verifyAflTradeValuationOutputInventoryDerivation,
  type AflTradeValuationOutputInventoryResult,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputInventory';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

const SOURCE_CREATED_AT = '2026-08-05T03:00:00.000Z';
const MATERIALIZED_AT = '2026-08-05T04:00:00.000Z';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

function artifact(label: string, createdAt = SOURCE_CREATED_AT) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
}

function createBundle(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation,
  scopeKey = 'fabricated-output-inventory-tests'
): AflTradeValuationBundleManifestV2 {
  const inventoryContractPayload = {
    inventorySchemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
    bindingDirection: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION,
    granularity: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY,
    distributionPartitioning: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING,
    semanticBinding: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
    publicationRequirement: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT,
  };
  const content = {
    schemaVersion: 'afl-trade-valuation-bundle/v2' as const,
    environment: 'non_production' as const,
    scopeKey,
    valueUnitId: valuationCase.content.valueUnitId,
    createdAt: SOURCE_CREATED_AT,
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: `model-protocol:${'1'.repeat(64)}`,
        runId: `model-run:${'2'.repeat(64)}`,
        datasetId: `dataset:${'3'.repeat(64)}`,
        gate3DecisionId: `gate-decision:${'4'.repeat(64)}`,
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: `model-protocol:${'5'.repeat(64)}`,
        runId: `model-run:${'6'.repeat(64)}`,
        datasetId: `dataset:${'7'.repeat(64)}`,
        gate3DecisionId: `gate-decision:${'8'.repeat(64)}`,
      },
    ],
    viewContexts: valuationCase.content.viewContexts,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    packagePolicy: {
      calculationUnit: 'complete_multi_party_trade' as const,
      attribution: 'lineage_frontier_exactly_once' as const,
      playerContributionCredit: 'receiving_club_only_until_real_club_departure' as const,
      exercisedPickCredit: 'selected_player_or_return_assets_without_double_counting' as const,
      unresolvedAssetTreatment: 'exclude_with_explicit_reason_no_fallback_value' as const,
      aggregation: 'joint_simulation_not_independent_point_sum' as const,
      sharedFactorTreatment: 'preserve_correlated_outcomes' as const,
      currentOutcomeIdentity: 'realized_club_value_plus_remaining_asset_value' as const,
      universalFootballValue: 'always_visible' as const,
      clubUtilityTreatment: 'separate_optional_view' as const,
      contractValueTreatment: 'separate_or_explicitly_unavailable' as const,
      commercialValueTreatment: 'separate_or_explicitly_unavailable' as const,
      listSpotPolicyArtifact: artifact('list-spot-policy'),
      scarcityPolicyArtifact: artifact('scarcity-policy'),
      roleCongestionPolicyArtifact: artifact('role-congestion-policy'),
    },
    simulation: {
      draws: calculation.content.draws.length,
      seed: 20260805,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('low-return-definition'),
      eliteOutcomeDefinitionArtifact: artifact('elite-outcome-definition'),
      practicalEquivalenceDefinitionArtifact: artifact('practical-equivalence-definition'),
      requiredStatistics: [
        'mean',
        'median',
        'central_interval',
        'downside_quantile',
        'upside_quantile',
        'low_return_probability',
        'elite_outcome_probability',
        'club_finishes_ahead_probability',
        'data_and_model_confidence',
      ] as const,
    },
    explanationPolicy: {
      sourceOfTruth: 'structured_reason_codes_and_measured_factors' as const,
      unconstrainedGenerativeClaims: 'prohibited' as const,
      numericalClaimParity: 'required' as const,
      requiredDistinctions: [
        'measured_fact',
        'model_estimate',
        'assumption',
        'unavailable_information',
        'low_confidence_output',
      ] as const,
      legacyValueTreatment: 'separate_source_metric_never_relabelled_statly_value' as const,
    },
    execution: {
      codeCommitSha: 'f'.repeat(40),
      cleanWorktree: true as const,
      jobId: 'fixture-output-inventory-job',
      attempt: 1,
      initiatedBy: 'fixture-operator',
      workerIdentity: 'fixture-worker',
      startedAt: '2026-08-05T01:00:00.000Z',
      finishedAt: '2026-08-05T02:00:00.000Z',
      sourceCodeArtifact: artifact('source-code'),
      dependencyLockArtifact: artifact('dependency-lock'),
      runtimeArtifact: artifact('runtime'),
      configurationArtifact: artifact('configuration'),
    },
    outputs: {
      immutableSnapshotsArtifact: artifact('snapshots'),
      simulationDrawsArtifact: artifact('draws'),
      attributionInvariantReportArtifact: artifact('attribution'),
      deterministicReplayReportArtifact: artifact('replay'),
      explanationParityReportArtifact: artifact('explanation-parity'),
      coverageAndExclusionReportArtifact: artifact('coverage'),
      confidenceReportArtifact: artifact('confidence'),
      sensitivityReportArtifact: artifact('sensitivity'),
      validationReportArtifact: artifact('validation'),
      modelCardArtifact: artifact('model-card'),
    },
    outputInventoryContract: {
      ...inventoryContractPayload,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(
        inventoryContractPayload,
        '2026-08-05T00:30:00.000Z'
      ),
    },
    limitations: ['Fabricated source-independent output-inventory fixture only.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

interface BoundFixture {
  bundle: AflTradeValuationBundleManifestV2;
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
}

function bindStage5Fixture(
  kind: 'two_party_player_swap' | 'three_party_exchange',
  scopeKey = 'fabricated-output-inventory-tests'
): BoundFixture {
  const source = createFabricatedAflTradeValuationFixture(kind);
  const provisionalBundle = createBundle(source.valuationCase, source.calculation, scopeKey);
  const drawSet = createAflTradeComponentDrawSet({
    ...structuredClone(source.componentDrawSet.content),
    valuationBundleId: provisionalBundle.valuationBundleId,
  });
  const ledger = createAflTradeRealizedContributionLedger({
    ...structuredClone(source.realizedContributionLedger.content),
    valuationBundleId: provisionalBundle.valuationBundleId,
  });
  const packagePolicy = createAflTradePackagePolicy({
    ...structuredClone(source.packagePolicy.content),
    valuationBundleId: provisionalBundle.valuationBundleId,
  });
  const valuationCase = createAflTradeValuationCase({
    ...structuredClone(source.valuationCase.content),
    valuationBundleId: provisionalBundle.valuationBundleId,
    componentDrawSetId: drawSet.componentDrawSetId,
    realizedContributionLedgerId: ledger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
  });
  const calculation = calculateAflTradeValuation(valuationCase, drawSet, ledger, packagePolicy);
  return {
    bundle: createBundle(valuationCase, calculation, scopeKey),
    valuationCase,
    calculation,
  };
}

function distributionPolicy(): AflTradeStructuralWeightedDistributionPolicy {
  return {
    probabilityMeasureDefinitionVersion: AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
    completenessDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
    normalizationDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
    conditionalMeasureDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
    quantileDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
    eventDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
    boundsDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
    dispersionDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
    statisticsArithmeticDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
    measureScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
    quantiles: { downside: 0.1, median: 0.5, upside: 0.9, centralIntervalLevel: 0.8 },
    lowReturnEvent: { operator: 'less_than_or_equal', threshold: 0 },
    eliteOutcomeEvent: { operator: 'greater_than_or_equal', threshold: 10 },
  };
}

function subjects(valuationCase: AflTradeValuationCase): AflTradeValuationDistributionSubject[] {
  return valuationCase.content.parties.flatMap((party) => [
    { kind: 'afl_club_received_package' as const, aflClubId: party.aflClubId },
    ...party.receivedRootAssetIds.map((rootAssetId) => ({
      kind: 'source_native_afl_trade_root' as const,
      aflClubId: party.aflClubId,
      rootAssetId,
    })),
  ]);
}

function distributionsFor(
  fixture: BoundFixture,
  includeClubUtility = false
): AflTradeValuationDistribution[] {
  const measures: AflTradeValuationDistributionMeasure[] = [
    ...UNIVERSAL_LAYERS.map((layer) => ({
      kind: 'universal_football_value' as const,
      layer,
    })),
    ...(includeClubUtility ? [{ kind: 'single_afl_club_utility' as const }] : []),
  ];
  return AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    measures.flatMap((measure) =>
      subjects(fixture.valuationCase).map((subject) =>
        createAflTradeValuationDistribution({
          valuationCase: fixture.valuationCase,
          valuationCalculation: fixture.calculation,
          view,
          subject,
          measure,
          policy: distributionPolicy(),
        })
      )
    )
  );
}

function comparisonsFor(fixture: BoundFixture): AflTradeValuationComparison[] {
  const quantizationPolicy: AflTradeJointOutcomeValueQuantizationPolicy = {
    definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
    decimalPlaces: 2,
  };
  return AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    UNIVERSAL_LAYERS.map((layer) =>
      createAflTradeValuationComparison({
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
        view,
        measure: { kind: 'universal_football_value', layer },
        quantizationPolicy,
        clearLeaderToleranceQuanta: 0,
      })
    )
  );
}

interface CompleteFixture extends BoundFixture {
  universalDistributions: AflTradeValuationDistribution[];
  utilityDistributions: AflTradeValuationDistribution[];
  comparisons: AflTradeValuationComparison[];
  explanation: AflTradeStructuredExplanationV2;
}

function completeFixture(
  kind: 'two_party_player_swap' | 'three_party_exchange',
  scopeKey = 'fabricated-output-inventory-tests'
): CompleteFixture {
  const fixture = bindStage5Fixture(kind, scopeKey);
  const universalDistributions = distributionsFor(fixture);
  const comparisons = comparisonsFor(fixture);
  const explanation = createAflTradeStructuredExplanationV2({
    valuationBundleManifest: fixture.bundle,
    valuationCase: fixture.valuationCase,
    valuationCalculation: fixture.calculation,
    valuationDistributions: universalDistributions,
    valuationComparisons: comparisons,
  });
  return {
    ...fixture,
    universalDistributions,
    utilityDistributions: distributionsFor(fixture, true).filter(
      (distribution) => distribution.content.measure.kind === 'single_afl_club_utility'
    ),
    comparisons,
    explanation,
  };
}

function binding<T>(value: T) {
  return { artifactRef: createAflTradeCanonicalJsonArtifactRef(value, SOURCE_CREATED_AT), value };
}

function inventoryInput(fixture: CompleteFixture, includeClubUtility = false) {
  const distributions = includeClubUtility
    ? [...fixture.universalDistributions, ...fixture.utilityDistributions]
    : fixture.universalDistributions;
  return {
    valuationBundle: {
      valuationBundleManifest: fixture.bundle,
      artifactRef: binding(fixture.bundle).artifactRef,
    },
    valuationCase: {
      valuationCase: fixture.valuationCase,
      artifactRef: binding(fixture.valuationCase).artifactRef,
    },
    valuationCalculation: {
      valuationCalculation: fixture.calculation,
      artifactRef: binding(fixture.calculation).artifactRef,
    },
    valuationDistributions: distributions.map((valuationDistribution) => ({
      valuationDistribution,
      artifactRef: binding(valuationDistribution).artifactRef,
    })),
    valuationComparisons: fixture.comparisons.map((valuationComparison) => ({
      valuationComparison,
      artifactRef: binding(valuationComparison).artifactRef,
    })),
    structuredExplanation: {
      structuredExplanation: fixture.explanation,
      artifactRef: binding(fixture.explanation).artifactRef,
    },
    materializedAt: MATERIALIZED_AT,
  };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeValuationOutputInventoryConstructionError['code']
): AflTradeValuationOutputInventoryConstructionError {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AflTradeValuationOutputInventoryConstructionError);
    expect(error).toMatchObject({ code });
    expect(Object.isFrozen(error)).toBe(true);
    return error as AflTradeValuationOutputInventoryConstructionError;
  }
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((child) => isDeeplyFrozen(child, seen))
  );
}

let cachedTwoParty: CompleteFixture | undefined;
let cachedThreeParty: CompleteFixture | undefined;

function twoPartyFixture(): CompleteFixture {
  cachedTwoParty ??= completeFixture('two_party_player_swap');
  return cachedTwoParty;
}

function threePartyFixture(): CompleteFixture {
  cachedThreeParty ??= completeFixture('three_party_exchange');
  return cachedThreeParty;
}

function coordinateKey(value: { view: string; measure: unknown }): string {
  return canonicalizeAflTradeJson({ view: value.view, measure: value.measure });
}

describe('AFL trade valuation output inventory', () => {
  it('builds the canonical required 12-shard publication inventory', () => {
    const fixture = twoPartyFixture();
    const input = inventoryInput(fixture);
    const output = createAflTradeValuationOutputInventory(input);
    const expectedSubjects = subjects(fixture.valuationCase);
    const root = output.valuationOutputInventory.content;

    expect(fixture.universalDistributions).toHaveLength(12 * expectedSubjects.length);
    expect(root.distributionCount).toBe(12 * expectedSubjects.length);
    expect(root.distributionShardCount).toBe(12);
    expect(output.distributionShards).toHaveLength(12);
    expect(root.valuationComparisonCount).toBe(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT
    );
    expect(root.valuationComparisons).toHaveLength(12);
    expect(root.structuredExplanation.structuredExplanationId).toBe(
      fixture.explanation.structuredExplanationId
    );
    expect(root.valuationBundle.valuationBundleId).toBe(fixture.bundle.valuationBundleId);
    expect(root.valuationCase.valuationCaseId).toBe(fixture.valuationCase.valuationCaseId);
    expect(root.valuationCalculation.valuationCalculationId).toBe(
      fixture.calculation.valuationCalculationId
    );
    expect(aflTradeValuationOutputInventoryResultSchema.safeParse(output).success).toBe(true);
    expect(verifyAflTradeValuationOutputInventoryDerivation({ ...input, output })).toBe(true);

    for (const shard of output.distributionShards) {
      expect(shard.shard.content.distributionCount).toBe(expectedSubjects.length);
      expect(shard.shard.content.distributions.map((entry) => entry.subject)).toEqual(
        expectedSubjects
      );
    }
  });

  it('accepts the complete optional club-utility lattice as exactly 16 shards', () => {
    const fixture = twoPartyFixture();
    const input = inventoryInput(fixture, true);
    const output = createAflTradeValuationOutputInventory(input);
    const subjectCount = subjects(fixture.valuationCase).length;

    expect(fixture.utilityDistributions).toHaveLength(4 * subjectCount);
    expect(output.distributionShards).toHaveLength(16);
    expect(output.valuationOutputInventory.content.distributionShardCount).toBe(16);
    expect(output.valuationOutputInventory.content.distributionCount).toBe(16 * subjectCount);
    expect(
      output.distributionShards.filter(
        ({ shard }) => shard.content.coordinate.measure.kind === 'single_afl_club_utility'
      )
    ).toHaveLength(4);
    expect(output.valuationOutputInventory.content.structuredExplanation.artifactRef).toEqual(
      input.structuredExplanation.artifactRef
    );
    expect(verifyAflTradeValuationOutputInventoryDerivation({ ...input, output })).toBe(true);
  });

  it('canonicalizes shuffled sources into fixed view, measure, party, package, and root order', () => {
    const fixture = threePartyFixture();
    const canonicalInput = inventoryInput(fixture, true);
    const canonical = createAflTradeValuationOutputInventory(canonicalInput);
    const shuffledInput = {
      ...canonicalInput,
      valuationDistributions: [...canonicalInput.valuationDistributions].reverse(),
      valuationComparisons: [...canonicalInput.valuationComparisons].reverse(),
    };
    const shuffled = createAflTradeValuationOutputInventory(shuffledInput);
    const measures = [
      ...UNIVERSAL_LAYERS.map((layer) => ({
        kind: 'universal_football_value' as const,
        layer,
      })),
      { kind: 'single_afl_club_utility' as const },
    ];
    const expectedShardCoordinates = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
      measures.map((measure) => coordinateKey({ view, measure }))
    );

    expect(shuffled).toEqual(canonical);
    expect(
      canonical.distributionShards.map(({ shard }) => coordinateKey(shard.content.coordinate))
    ).toEqual(expectedShardCoordinates);
    expect(
      canonical.distributionShards.every(({ shard }) =>
        sameJson(
          shard.content.distributions.map((entry) => entry.subject),
          subjects(fixture.valuationCase)
        )
      )
    ).toBe(true);
    expect(
      canonical.valuationOutputInventory.content.valuationComparisons.map(coordinateKey)
    ).toEqual(expectedShardCoordinates.filter((_coordinate, index) => index % 4 !== 3));
  });

  it('authenticates every semantic output with exact immutable canonical UTF-8 byte references', () => {
    const fixture = twoPartyFixture();
    const input = inventoryInput(fixture, true);
    const output = createAflTradeValuationOutputInventory(input);
    const root = output.valuationOutputInventory.content;

    for (const { shard, artifactRef } of output.distributionShards) {
      expect(artifactRef).toEqual(createAflTradeCanonicalJsonArtifactRef(shard, MATERIALIZED_AT));
      expect(artifactRef.mediaType).toBe(AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE);
      expect(artifactRef.byteLength).toBe(
        new TextEncoder().encode(canonicalizeAflTradeJson(shard)).byteLength
      );
      const rootBinding = root.distributionShards.find(
        (bindingValue) =>
          bindingValue.valuationOutputInventoryShardId === shard.valuationOutputInventoryShardId
      );
      expect(rootBinding?.artifactRef).toEqual(artifactRef);
      expect(rootBinding?.distributionSetSha256).toBe(shard.content.distributionSetSha256);
    }
    expect(output.valuationOutputInventoryArtifactRef).toEqual(
      createAflTradeCanonicalJsonArtifactRef(output.valuationOutputInventory, MATERIALIZED_AT)
    );
    expect(root.distributionShardSetSha256).toBe(
      sha256AflTradeCanonicalJson(root.distributionShards)
    );
    expect(root.valuationComparisonSetSha256).toBe(
      sha256AflTradeCanonicalJson(root.valuationComparisons)
    );
    expect(root.valuationBundle.artifactRef).toEqual(input.valuationBundle.artifactRef);
    expect(root.valuationCase.artifactRef).toEqual(input.valuationCase.artifactRef);
    expect(root.valuationCalculation.artifactRef).toEqual(input.valuationCalculation.artifactRef);
    expect(root.structuredExplanation.artifactRef).toEqual(input.structuredExplanation.artifactRef);
  });

  it('rejects missing, duplicate, extra, and incomplete optional distribution coordinates', () => {
    const fixture = twoPartyFixture();
    const base = inventoryInput(fixture);
    const universalCases = [
      base.valuationDistributions.slice(1),
      [base.valuationDistributions[0], ...base.valuationDistributions.slice(0, -1)],
      [...base.valuationDistributions, base.valuationDistributions[0]],
    ];
    for (const valuationDistributions of universalCases) {
      expectConstructionError(
        () =>
          createAflTradeValuationOutputInventory({
            ...base,
            valuationDistributions,
          }),
        'INCOMPLETE_UNIVERSAL_DISTRIBUTION_LATTICE'
      );
    }

    const oneUtility = {
      valuationDistribution: fixture.utilityDistributions[0],
      artifactRef: binding(fixture.utilityDistributions[0]).artifactRef,
    };
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventory({
          ...base,
          valuationDistributions: [...base.valuationDistributions, oneUtility],
        }),
      'INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE'
    );

    const completeUtility = inventoryInput(fixture, true);
    const duplicateUtility = [...completeUtility.valuationDistributions];
    duplicateUtility[duplicateUtility.length - 1] =
      duplicateUtility[base.valuationDistributions.length];
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventory({
          ...completeUtility,
          valuationDistributions: duplicateUtility,
        }),
      'INCOMPLETE_OPTIONAL_CLUB_UTILITY_LATTICE'
    );
  });

  it('rejects duplicate comparison coordinates and preserves validation precedence for array size', () => {
    const input = inventoryInput(twoPartyFixture());
    const duplicateCoordinate = [...input.valuationComparisons];
    duplicateCoordinate[1] = duplicateCoordinate[0];
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventory({
          ...input,
          valuationComparisons: duplicateCoordinate,
        }),
      'INCOMPLETE_COMPARISON_LATTICE'
    );
    for (const valuationComparisons of [
      input.valuationComparisons.slice(1),
      [...input.valuationComparisons, input.valuationComparisons[0]],
    ]) {
      expectConstructionError(
        () => createAflTradeValuationOutputInventory({ ...input, valuationComparisons }),
        'INVALID_VALUATION_COMPARISON_BINDINGS'
      );
    }
  });

  it('rejects authentic-but-wrong byte references, non-JSON media, and future chronology', () => {
    const fixture = twoPartyFixture();
    const source = inventoryInput(fixture);
    const wrongReference = artifact('authentic-wrong-bytes');
    const referenceMutations: Array<(candidate: ReturnType<typeof inventoryInput>) => void> = [
      (candidate) => {
        candidate.valuationBundle.artifactRef = wrongReference;
      },
      (candidate) => {
        candidate.valuationCase.artifactRef = wrongReference;
      },
      (candidate) => {
        candidate.valuationCalculation.artifactRef = wrongReference;
      },
      (candidate) => {
        candidate.valuationDistributions[0].artifactRef = wrongReference;
      },
      (candidate) => {
        candidate.valuationComparisons[0].artifactRef = wrongReference;
      },
      (candidate) => {
        candidate.structuredExplanation.artifactRef = wrongReference;
      },
    ];
    for (const mutate of referenceMutations) {
      const candidate = structuredClone(source);
      mutate(candidate);
      expectConstructionError(
        () => createAflTradeValuationOutputInventory(candidate),
        'ARTIFACT_REFERENCE_MISMATCH'
      );
    }

    const nonJson = structuredClone(source);
    nonJson.valuationDistributions[0].artifactRef.mediaType = 'application/octet-stream';
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(nonJson),
      'INVALID_VALUATION_DISTRIBUTION_BINDINGS'
    );

    const future = structuredClone(source);
    future.structuredExplanation.artifactRef = createAflTradeCanonicalJsonArtifactRef(
      fixture.explanation,
      '2026-08-05T04:00:00.001Z'
    );
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(future),
      'ARTIFACT_REFERENCE_MISMATCH'
    );
  });

  it('rejects individually valid inputs that do not share one complete parent lineage', () => {
    const source = inventoryInput(twoPartyFixture());
    const foreignFixture = completeFixture(
      'two_party_player_swap',
      'fabricated-output-inventory-foreign-lineage'
    );
    const foreignBundle = structuredClone(source);
    foreignBundle.valuationBundle = {
      valuationBundleManifest: foreignFixture.bundle,
      artifactRef: binding(foreignFixture.bundle).artifactRef,
    };
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(foreignBundle),
      'PARENT_LINEAGE_MISMATCH'
    );

    const calculationContent = structuredClone(twoPartyFixture().calculation.content);
    calculationContent.packagePolicyId = `package-policy:${'9'.repeat(64)}`;
    const calculation = aflTradeValuationCalculationSchema.parse({
      valuationCalculationId: createAflTradeContentAddress(
        'valuation-calculation',
        calculationContent
      ),
      content: calculationContent,
    });
    const foreignCalculation = structuredClone(source);
    foreignCalculation.valuationCalculation = {
      valuationCalculation: calculation,
      artifactRef: binding(calculation).artifactRef,
    };
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(foreignCalculation),
      'PARENT_LINEAGE_MISMATCH'
    );
  });

  it('rejects readdressed distribution, comparison, and explanation semantic replay forgeries', () => {
    const fixture = twoPartyFixture();
    const source = inventoryInput(fixture);

    const forgedDistribution = structuredClone(fixture.universalDistributions[0]);
    forgedDistribution.content.derivation.observationSha256 = 'f'.repeat(64);
    const distribution = aflTradeValuationDistributionSchema.parse({
      valuationDistributionId: createAflTradeContentAddress(
        'valuation-distribution',
        forgedDistribution.content
      ),
      content: forgedDistribution.content,
    });
    const distributionInput = structuredClone(source);
    distributionInput.valuationDistributions[0] = {
      valuationDistribution: distribution,
      artifactRef: binding(distribution).artifactRef,
    };
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(distributionInput),
      'DISTRIBUTION_REPLAY_FAILURE'
    );

    const forgedComparison = structuredClone(fixture.comparisons[0]);
    forgedComparison.content.derivation.observationSha256 = 'e'.repeat(64);
    const comparison = aflTradeValuationComparisonSchema.parse({
      valuationComparisonId: createAflTradeContentAddress(
        'valuation-comparison',
        forgedComparison.content
      ),
      content: forgedComparison.content,
    });
    const comparisonInput = structuredClone(source);
    comparisonInput.valuationComparisons[0] = {
      valuationComparison: comparison,
      artifactRef: binding(comparison).artifactRef,
    };
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(comparisonInput),
      'COMPARISON_REPLAY_FAILURE'
    );

    const explanationContent = structuredClone(fixture.explanation.content);
    const forgedDefinitionArtifact = artifact('forged-low-return-definition');
    const firstStatement = explanationContent.statements[0];
    if (firstStatement.template !== 'definition_assumption') {
      throw new Error('Controlled fixture must begin with a definition statement.');
    }
    firstStatement.definitionArtifact = forgedDefinitionArtifact;
    firstStatement.renderedText = `The ${firstStatement.definitionName} definition is governed by immutable artifact ${forgedDefinitionArtifact.artifactId}.`;
    const explanation = aflTradeStructuredExplanationV2Schema.parse({
      structuredExplanationId: createAflTradeContentAddress(
        'structured-explanation',
        explanationContent
      ),
      content: explanationContent,
    });
    const explanationInput = structuredClone(source);
    explanationInput.structuredExplanation = {
      structuredExplanation: explanation,
      artifactRef: binding(explanation).artifactRef,
    };
    expectConstructionError(
      () => createAflTradeValuationOutputInventory(explanationInput),
      'STRUCTURED_EXPLANATION_REPLAY_FAILURE'
    );
  });

  it('rejects duplicated root identities and returned shards whose parents do not reconcile', () => {
    const source = createAflTradeValuationOutputInventory(inventoryInput(twoPartyFixture(), true));

    const duplicateShardSemanticId = structuredClone(source.valuationOutputInventory.content);
    duplicateShardSemanticId.distributionShards[1].valuationOutputInventoryShardId =
      duplicateShardSemanticId.distributionShards[0].valuationOutputInventoryShardId;
    refreshRootDigests(duplicateShardSemanticId);
    expect(
      aflTradeValuationOutputInventorySchema.safeParse({
        valuationOutputInventoryId: createAflTradeContentAddress(
          'valuation-output-inventory',
          duplicateShardSemanticId
        ),
        content: duplicateShardSemanticId,
      }).success
    ).toBe(false);

    const duplicateShardByteId = structuredClone(source.valuationOutputInventory.content);
    duplicateShardByteId.distributionShards[1].artifactRef =
      duplicateShardByteId.distributionShards[0].artifactRef;
    refreshRootDigests(duplicateShardByteId);
    expect(
      aflTradeValuationOutputInventoryContentSchema.safeParse(duplicateShardByteId).success
    ).toBe(false);

    const duplicateComparisonSemanticId = structuredClone(source.valuationOutputInventory.content);
    duplicateComparisonSemanticId.valuationComparisons[1].valuationComparisonId =
      duplicateComparisonSemanticId.valuationComparisons[0].valuationComparisonId;
    refreshRootDigests(duplicateComparisonSemanticId);
    expect(
      aflTradeValuationOutputInventoryContentSchema.safeParse(duplicateComparisonSemanticId).success
    ).toBe(false);

    const duplicateComparisonByteId = structuredClone(source.valuationOutputInventory.content);
    duplicateComparisonByteId.valuationComparisons[1].artifactRef =
      duplicateComparisonByteId.valuationComparisons[0].artifactRef;
    refreshRootDigests(duplicateComparisonByteId);
    expect(
      aflTradeValuationOutputInventoryContentSchema.safeParse(duplicateComparisonByteId).success
    ).toBe(false);

    const mismatchedParent = structuredClone(source);
    const returnedShard = mismatchedParent.distributionShards[0];
    returnedShard.shard.content.tradeId = 'fixture:forged-parent-trade';
    returnedShard.shard.valuationOutputInventoryShardId = createAflTradeContentAddress(
      'valuation-output-inventory-shard',
      returnedShard.shard.content
    );
    returnedShard.artifactRef = createAflTradeCanonicalJsonArtifactRef(
      returnedShard.shard,
      MATERIALIZED_AT
    );
    const rootBinding = mismatchedParent.valuationOutputInventory.content.distributionShards[0];
    rootBinding.valuationOutputInventoryShardId =
      returnedShard.shard.valuationOutputInventoryShardId;
    rootBinding.artifactRef = returnedShard.artifactRef;
    readdressRoot(mismatchedParent);
    expect(
      aflTradeValuationOutputInventorySchema.safeParse(mismatchedParent.valuationOutputInventory)
        .success
    ).toBe(true);
    expect(aflTradeValuationOutputInventoryResultSchema.safeParse(mismatchedParent).success).toBe(
      false
    );

    const mismatchedMaterialization = structuredClone(source);
    mismatchedMaterialization.distributionShards[0].shard.content.materializedAt =
      '2026-08-05T03:59:59.999Z';
    expect(
      aflTradeValuationOutputInventoryResultSchema.safeParse(mismatchedMaterialization).success
    ).toBe(false);
  });

  it('pins audit-only predecessor isolation and rejects predecessor-shaped successor roles', () => {
    const source = createAflTradeValuationOutputInventory(inventoryInput(twoPartyFixture()));
    const policy = source.valuationOutputInventory.content.predecessorPolicy;
    expect(policy).toEqual({
      definitionVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION,
      valuationBundlePredecessorSchemaVersion: 'afl-trade-valuation-bundle/v1',
      valuationSnapshotSetSchemaVersion: 'afl-trade-valuation-snapshot-set/v1',
      structuredExplanationSchemaVersion: 'afl-trade-structured-explanation/v1',
      compatibility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY,
      upcastTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT,
      downcastTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT,
      runtimeFallback: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK,
      publicationAuthority: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY,
      legacyTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT,
    });

    const alteredPolicy = structuredClone(source.valuationOutputInventory.content);
    alteredPolicy.predecessorPolicy.runtimeFallback = 'permitted' as never;
    expect(aflTradeValuationOutputInventoryContentSchema.safeParse(alteredPolicy).success).toBe(
      false
    );
    const unknownLegacyField = structuredClone(source.valuationOutputInventory.content) as Record<
      string,
      unknown
    >;
    (unknownLegacyField.predecessorPolicy as Record<string, unknown>).legacyInventoryArtifact =
      artifact('legacy-inventory');
    expect(
      aflTradeValuationOutputInventoryContentSchema.safeParse(unknownLegacyField).success
    ).toBe(false);

    const input = inventoryInput(twoPartyFixture());
    const predecessorBundle = structuredClone(input.valuationBundle.valuationBundleManifest) as {
      content: Record<string, unknown>;
      valuationBundleId: string;
    };
    predecessorBundle.content.schemaVersion = 'afl-trade-valuation-bundle/v1';
    delete predecessorBundle.content.outputInventoryContract;
    predecessorBundle.valuationBundleId = createAflTradeContentAddress(
      'valuation-bundle',
      predecessorBundle.content
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventory({
          ...input,
          valuationBundle: {
            valuationBundleManifest: predecessorBundle,
            artifactRef: binding(predecessorBundle).artifactRef,
          },
        }),
      'INVALID_VALUATION_BUNDLE_BINDING'
    );
  });

  it('contains hostile envelopes and exposes only frozen trusted construction errors', () => {
    const input = inventoryInput(twoPartyFixture());
    const missing = { ...input } as Record<string, unknown>;
    delete missing.materializedAt;
    const extra = { ...input, unexpected: true };
    const symbolKey = { ...input } as Record<PropertyKey, unknown>;
    symbolKey[Symbol('hostile')] = true;
    const throwingGetter = Object.defineProperty({ ...input }, 'valuationBundle', {
      enumerable: true,
      get() {
        throw new Error('private hostile getter detail');
      },
    });
    const throwingProxy = new Proxy(input, {
      ownKeys() {
        throw new Error('private hostile proxy detail');
      },
    });
    const revocable = Proxy.revocable(input, {});
    revocable.revoke();

    for (const hostile of [
      null,
      [],
      missing,
      extra,
      symbolKey,
      throwingGetter,
      throwingProxy,
      revocable.proxy,
    ]) {
      const error = expectConstructionError(
        () => createAflTradeValuationOutputInventory(hostile),
        'INVALID_INPUT_ENVELOPE'
      );
      expect(error.message).toBe('The valuation-output-inventory input envelope is invalid.');
      expect(error.toJSON()).toEqual({
        name: 'AflTradeValuationOutputInventoryConstructionError',
        code: 'INVALID_INPUT_ENVELOPE',
        message: 'The valuation-output-inventory input envelope is invalid.',
      });
      expect(Object.isFrozen(error.toJSON())).toBe(true);
      expect(isAflTradeValuationOutputInventoryConstructionError(error)).toBe(true);
    }
    expect(
      isAflTradeValuationOutputInventoryConstructionError({
        name: 'AflTradeValuationOutputInventoryConstructionError',
        code: 'INVALID_INPUT_ENVELOPE',
        message: 'The valuation-output-inventory input envelope is invalid.',
      })
    ).toBe(false);
    expect(
      verifyAflTradeValuationOutputInventoryDerivation({ ...input, extra: true, output: {} })
    ).toBe(false);
  });

  it('proves maximum schema-valid shard cardinality and maximum root cardinality remain bounded', () => {
    const source = createAflTradeValuationOutputInventory(inventoryInput(twoPartyFixture(), true));
    const shardContent = structuredClone(source.distributionShards[0].shard.content);
    const maximalBindings = Array.from({ length: 18 }, (_club, clubIndex) => {
      const aflClubId = `club-${String(clubIndex).padStart(2, '0')}-${'c'.repeat(150)}`;
      const packageSubject = { kind: 'afl_club_received_package' as const, aflClubId };
      const rootSubjects = Array.from({ length: 100 }, (_root, rootIndex) => ({
        kind: 'source_native_afl_trade_root' as const,
        aflClubId,
        rootAssetId: `root-${String(rootIndex).padStart(3, '0')}-${'r'.repeat(148)}`,
      }));
      return [packageSubject, ...rootSubjects];
    })
      .flat()
      .map((subject, index) => ({
        subject,
        valuationDistributionId: `valuation-distribution:${sha256AflTradeCanonicalJson({ index })}`,
        artifactRef: createAflTradeCanonicalJsonArtifactRef({ index }, SOURCE_CREATED_AT),
      }));
    expect(maximalBindings).toHaveLength(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD
    );
    shardContent.distributions = maximalBindings;
    shardContent.distributionCount = maximalBindings.length;
    shardContent.distributionSetSha256 = sha256AflTradeCanonicalJson(maximalBindings);
    const maximalShard = {
      valuationOutputInventoryShardId: createAflTradeContentAddress(
        'valuation-output-inventory-shard',
        shardContent
      ),
      content: shardContent,
    };
    expect(aflTradeValuationOutputInventoryShardSchema.safeParse(maximalShard).success).toBe(true);
    const maximalShardReference = createAflTradeCanonicalJsonArtifactRef(
      maximalShard,
      MATERIALIZED_AT
    );
    expect(maximalShardReference.byteLength).toBeLessThan(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_BYTES
    );

    expect(source.distributionShards).toHaveLength(16);
    expect(source.valuationOutputInventory.content.valuationComparisons).toHaveLength(12);
    expect(source.valuationOutputInventoryArtifactRef.byteLength).toBeLessThan(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES
    );
    expect(source.valuationOutputInventoryArtifactRef.byteLength).toBe(
      new TextEncoder().encode(canonicalizeAflTradeJson(source.valuationOutputInventory)).byteLength
    );
  });

  it('deep-freezes outputs, isolates caller aliases, and verifies only exact replayed results', () => {
    const input = inventoryInput(twoPartyFixture(), true);
    const output = createAflTradeValuationOutputInventory(input);
    const snapshot = canonicalizeAflTradeJson(output);
    expect(isDeeplyFrozen(output)).toBe(true);
    expect(createAflTradeValuationOutputInventory(input)).toEqual(output);

    input.valuationDistributions.reverse();
    input.valuationComparisons.reverse();
    input.valuationBundle.artifactRef = artifact('caller-owned-alias-mutation');
    expect(canonicalizeAflTradeJson(output)).toBe(snapshot);

    const cleanInput = inventoryInput(twoPartyFixture(), true);
    expect(verifyAflTradeValuationOutputInventoryDerivation({ ...cleanInput, output })).toBe(true);
    const shuffledInput = {
      ...cleanInput,
      valuationDistributions: [...cleanInput.valuationDistributions].reverse(),
      valuationComparisons: [...cleanInput.valuationComparisons].reverse(),
    };
    expect(verifyAflTradeValuationOutputInventoryDerivation({ ...shuffledInput, output })).toBe(
      true
    );

    const reordered = structuredClone(output);
    reordered.distributionShards.reverse();
    expect(
      verifyAflTradeValuationOutputInventoryDerivation({
        ...cleanInput,
        output: reordered,
      })
    ).toBe(false);
    const tamperedRootRef = structuredClone(output);
    tamperedRootRef.valuationOutputInventoryArtifactRef = artifact('forged-root-ref');
    expect(
      verifyAflTradeValuationOutputInventoryDerivation({
        ...cleanInput,
        output: tamperedRootRef,
      })
    ).toBe(false);
    expect(
      verifyAflTradeValuationOutputInventoryDerivation({
        ...cleanInput,
        output,
        unexpected: true,
      })
    ).toBe(false);
  });
});

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function refreshRootDigests(
  content: AflTradeValuationOutputInventoryResult['valuationOutputInventory']['content']
): void {
  content.distributionShardSetSha256 = sha256AflTradeCanonicalJson(content.distributionShards);
  content.valuationComparisonSetSha256 = sha256AflTradeCanonicalJson(content.valuationComparisons);
  content.outputSetSha256 = sha256AflTradeCanonicalJson({
    valuationCalculation: content.valuationCalculation,
    distributionShards: content.distributionShards,
    valuationComparisons: content.valuationComparisons,
    structuredExplanation: content.structuredExplanation,
  });
}

function readdressRoot(
  output: AflTradeValuationOutputInventoryResult
): AflTradeValuationOutputInventoryResult {
  refreshRootDigests(output.valuationOutputInventory.content);
  output.valuationOutputInventory.valuationOutputInventoryId = createAflTradeContentAddress(
    'valuation-output-inventory',
    output.valuationOutputInventory.content
  );
  output.valuationOutputInventoryArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    output.valuationOutputInventory,
    output.valuationOutputInventory.content.materializedAt
  );
  return output;
}
