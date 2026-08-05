// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
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
import { createAflTradeComponentDrawSet } from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
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
  AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONFIDENCE_TREATMENT,
  AFL_TRADE_STRUCTURED_EXPLANATION_V2_COVERAGE_TREATMENT,
  AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_STRUCTURED_EXPLANATION_V2_RUNTIME_FALLBACK,
  AFL_TRADE_STRUCTURED_EXPLANATION_V2_VERIFICATION_SCOPE,
  AflTradeStructuredExplanationV2ConstructionError,
  aflTradeStructuredExplanationV2ContentSchema,
  aflTradeStructuredExplanationV2Schema,
  createAflTradeStructuredExplanationV2,
  isAflTradeStructuredExplanationV2ConstructionError,
  renderAflTradeStructuredExplanationV2Statement,
  verifyAflTradeStructuredExplanationV2Derivation,
  type AflTradeStructuredExplanationV2Statement,
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
  type AflTradeValuationDistributionSubject,
} from '@/server/aflTradeIntelligence/valuation/valuationDistributionArtifact';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

const CREATED_AT = '2026-08-05T03:00:00.000Z';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

function artifact(label: string) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, CREATED_AT);
}

function createBundle(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation
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
    scopeKey: 'fabricated-v2-explanation-tests',
    valueUnitId: valuationCase.content.valueUnitId,
    createdAt: CREATED_AT,
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
      jobId: 'fixture-v2-explanation-job',
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
    limitations: ['Fabricated source-independent V2 explanation fixture only.'],
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

function bindStage5Fixture(kind: 'two_party_player_swap' | 'three_party_exchange'): BoundFixture {
  const source = createFabricatedAflTradeValuationFixture(kind);
  const provisionalBundle = createBundle(source.valuationCase, source.calculation);
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
    bundle: createBundle(valuationCase, calculation),
    valuationCase,
    calculation,
  };
}

function policy(): AflTradeStructuralWeightedDistributionPolicy {
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

function numericArtifacts(fixture: BoundFixture): {
  distributions: AflTradeValuationDistribution[];
  comparisons: AflTradeValuationComparison[];
} {
  const distributions = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    UNIVERSAL_LAYERS.flatMap((layer) =>
      subjects(fixture.valuationCase).map((subject) =>
        createAflTradeValuationDistribution({
          valuationCase: fixture.valuationCase,
          valuationCalculation: fixture.calculation,
          view,
          subject,
          measure: { kind: 'universal_football_value', layer },
          policy: policy(),
        })
      )
    )
  );
  const quantizationPolicy: AflTradeJointOutcomeValueQuantizationPolicy = {
    definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
    decimalPlaces: 2,
  };
  const comparisons = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
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
  return { distributions, comparisons };
}

function input(fixture: BoundFixture, artifacts = numericArtifacts(fixture)) {
  return {
    valuationBundleManifest: fixture.bundle,
    valuationCase: fixture.valuationCase,
    valuationCalculation: fixture.calculation,
    valuationDistributions: artifacts.distributions,
    valuationComparisons: artifacts.comparisons,
  };
}

function readdressCalculation(
  content: AflTradeValuationCalculation['content']
): AflTradeValuationCalculation {
  return aflTradeValuationCalculationSchema.parse({
    valuationCalculationId: createAflTradeContentAddress('valuation-calculation', content),
    content,
  });
}

function makeAtTradeUnavailable(
  source: BoundFixture,
  drawIndexes: readonly number[]
): BoundFixture {
  const content = structuredClone(source.calculation.content);
  for (const drawIndex of drawIndexes) {
    const view = content.draws[drawIndex].parties[0].views.find(
      (candidate) => candidate.view === 'at_trade'
    )!;
    const root = view.roots[0];
    if (root.universal.status !== 'available' || view.universal.status !== 'available') {
      throw new Error('Controlled fixture must start available.');
    }
    root.universal = {
      status: 'unavailable',
      partialLayers: { ...root.universal.layers, gross: 999_999 },
      reasonCodes: ['fixture-unavailable'],
    };
    view.universal = {
      status: 'unavailable',
      partialLayers: { ...view.universal.layers, gross: 999_999 },
      reasonCodes: ['fixture-unavailable'],
    };
  }
  const calculation = readdressCalculation(content);
  return { ...source, calculation, bundle: createBundle(source.valuationCase, calculation) };
}

function multiRootFixture(): BoundFixture {
  const source = bindStage5Fixture('two_party_player_swap');
  const extraRootId = 'fixture:synthetic-explanation-extra-root';
  const caseContent = structuredClone(source.valuationCase.content);
  caseContent.parties[0].receivedRootAssetIds.push(extraRootId);
  caseContent.parties[0].receivedRootAssetIds.sort();
  const valuationCase = createAflTradeValuationCase(caseContent);
  const calculationContent = structuredClone(source.calculation.content);
  calculationContent.valuationCaseId = valuationCase.valuationCaseId;
  for (const draw of calculationContent.draws) {
    for (const view of draw.parties[0].views) {
      view.roots.push({
        ...structuredClone(view.roots[0]),
        assetId: extraRootId,
        universal: {
          status: 'available',
          layers: { gross: 0, listSpotAdjusted: 0, scarcityAdjusted: 0 },
        },
        clubUtility: { status: 'available', value: 0 },
      });
      view.roots.sort((left, right) => left.assetId.localeCompare(right.assetId));
    }
  }
  const calculation = readdressCalculation(calculationContent);
  return { bundle: createBundle(valuationCase, calculation), valuationCase, calculation };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeStructuredExplanationV2ConstructionError['code']
): AflTradeStructuredExplanationV2ConstructionError {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AflTradeStructuredExplanationV2ConstructionError);
    expect(error).toMatchObject({ code });
    expect(Object.isFrozen(error)).toBe(true);
    return error as AflTradeStructuredExplanationV2ConstructionError;
  }
}

function readdressDistribution(
  artifactValue: AflTradeValuationDistribution
): AflTradeValuationDistribution {
  return aflTradeValuationDistributionSchema.parse({
    valuationDistributionId: createAflTradeContentAddress(
      'valuation-distribution',
      artifactValue.content
    ),
    content: artifactValue.content,
  });
}

function readdressComparison(
  artifactValue: AflTradeValuationComparison
): AflTradeValuationComparison {
  return aflTradeValuationComparisonSchema.parse({
    valuationComparisonId: createAflTradeContentAddress(
      'valuation-comparison',
      artifactValue.content
    ),
    content: artifactValue.content,
  });
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((child) => isDeeplyFrozen(child, seen))
  );
}

function sourceWithoutRenderedText(statement: AflTradeStructuredExplanationV2Statement) {
  const { renderedText: _renderedText, ...source } = statement;
  return source;
}

describe('AFL trade structured explanations v2', () => {
  it('builds the complete canonical 63-statement explanation with exact text and addressing', () => {
    const fixture = bindStage5Fixture('two_party_player_swap');
    const artifacts = numericArtifacts(fixture);
    const explanation = createAflTradeStructuredExplanationV2(input(fixture, artifacts));

    expect(explanation.content.statementCount).toBe(63);
    expect(explanation.content.statements).toHaveLength(63);
    expect(explanation.content.statements.map((statement) => statement.statementId)).toEqual(
      Array.from({ length: 63 }, (_value, index) => `statement:${index + 1}`)
    );
    expect(
      explanation.content.statements.slice(0, 3).map((statement) => statement.template)
    ).toEqual(['definition_assumption', 'definition_assumption', 'definition_assumption']);
    expect(explanation.content.statements[3]).toMatchObject({
      template: 'distribution_complete',
      view: 'at_trade',
      subject: { kind: 'afl_club_received_package', aflClubId: 'fixture-club-a' },
      measure: { kind: 'universal_football_value', layer: 'gross' },
    });
    expect(explanation.content.statements[50]).toMatchObject({
      template: 'distribution_complete',
      view: 'current',
      subject: {
        kind: 'source_native_afl_trade_root',
        aflClubId: 'fixture-club-b',
        rootAssetId: 'fixture:two_party_player_swap:player:b',
      },
      measure: { kind: 'universal_football_value', layer: 'scarcity_adjusted' },
    });
    expect(explanation.content.statements.slice(51).map((statement) => statement.template)).toEqual(
      Array(12).fill('joint_comparison_available')
    );
    expect(explanation.content.statements[0].renderedText).toBe(
      `The low return definition is governed by immutable artifact ${fixture.bundle.content.simulation.lowReturnDefinitionArtifact.artifactId}.`
    );
    for (const statement of explanation.content.statements) {
      expect(statement.renderedText).toBe(
        renderAflTradeStructuredExplanationV2Statement(sourceWithoutRenderedText(statement))
      );
    }
    expect(explanation.structuredExplanationId).toBe(
      createAflTradeContentAddress('structured-explanation', explanation.content)
    );
    expect(aflTradeStructuredExplanationV2Schema.safeParse(explanation).success).toBe(true);
    expect(
      verifyAflTradeStructuredExplanationV2Derivation({
        structuredExplanation: explanation,
        ...input(fixture, artifacts),
      })
    ).toBe(true);
  });

  it('canonicalizes shuffled sources and covers the 75- and 87-statement lattices', () => {
    const twoParty = bindStage5Fixture('two_party_player_swap');
    const artifacts = numericArtifacts(twoParty);
    const canonical = createAflTradeStructuredExplanationV2(input(twoParty, artifacts));
    const shuffled = createAflTradeStructuredExplanationV2(
      input(twoParty, {
        distributions: [...artifacts.distributions].reverse(),
        comparisons: [...artifacts.comparisons].reverse(),
      })
    );
    expect(shuffled).toEqual(canonical);

    const multiRoot = multiRootFixture();
    expect(createAflTradeStructuredExplanationV2(input(multiRoot)).content.statementCount).toBe(75);
    const threeParty = bindStage5Fixture('three_party_exchange');
    expect(createAflTradeStructuredExplanationV2(input(threeParty)).content.statementCount).toBe(
      87
    );
  });

  it('renders partial and wholly unavailable distributions without substituting partial layers', () => {
    const complete = bindStage5Fixture('three_party_exchange');
    const partial = makeAtTradeUnavailable(complete, [0]);
    const partialExplanation = createAflTradeStructuredExplanationV2(input(partial));
    const partialStatement = partialExplanation.content.statements.find(
      (statement) => statement.template === 'distribution_partial'
    );
    expect(partialStatement).toMatchObject({
      claimKind: 'unavailable_information',
      availableProbabilityMass: 0.6,
      unavailableProbabilityMass: 0.4,
      unavailableReasonCodes: ['fixture-unavailable'],
    });
    expect(partialStatement?.renderedText).toContain(
      'No unconditional point statistic is claimed.'
    );
    expect(partialStatement?.renderedText).toContain('Conditional on available draws only');
    expect(canonicalizeAflTradeJson(partialExplanation)).not.toContain('999999');

    const unavailable = makeAtTradeUnavailable(
      complete,
      complete.calculation.content.draws.map((_draw, index) => index)
    );
    const unavailableExplanation = createAflTradeStructuredExplanationV2(input(unavailable));
    const unavailableStatement = unavailableExplanation.content.statements.find(
      (statement) => statement.template === 'distribution_unavailable'
    );
    expect(unavailableStatement).toMatchObject({
      availableProbabilityMass: 0,
      unavailableProbabilityMass: 1,
      unavailableReasonCodes: ['fixture-unavailable'],
    });
    expect(unavailableStatement?.renderedText).toContain(
      'No unconditional or conditional point statistic is claimed.'
    );
  });

  it('renders available, partial, and wholly unavailable joint comparisons with governed bounds', () => {
    const complete = bindStage5Fixture('three_party_exchange');
    const completeExplanation = createAflTradeStructuredExplanationV2(input(complete));
    expect(
      completeExplanation.content.statements.find(
        (statement) => statement.template === 'joint_comparison_available'
      )
    ).toMatchObject({
      claimKind: 'model_estimate',
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
    });

    const partial = makeAtTradeUnavailable(complete, [0]);
    const partialExplanation = createAflTradeStructuredExplanationV2(input(partial));
    const partialComparison = partialExplanation.content.statements.find(
      (statement) =>
        statement.template === 'joint_comparison_unavailable' && statement.view === 'at_trade'
    );
    expect(partialComparison).toMatchObject({
      availableProbabilityMass: 0.6,
      unavailableProbabilityMass: 0.4,
      unavailableReasonCodes: ['fixture-unavailable'],
    });
    expect(partialComparison?.renderedText).toContain(
      'No unconditional point probability is claimed.'
    );
    expect(partialComparison?.renderedText).toContain('Unconditional bounds are:');

    const missing = makeAtTradeUnavailable(
      complete,
      complete.calculation.content.draws.map((_draw, index) => index)
    );
    const missingExplanation = createAflTradeStructuredExplanationV2(input(missing));
    const missingComparison = missingExplanation.content.statements.find(
      (statement) =>
        statement.template === 'joint_comparison_unavailable' && statement.view === 'at_trade'
    );
    expect(missingComparison).toMatchObject({
      conditionalOnAvailableProbabilities: null,
      availableProbabilityMass: 0,
      unavailableProbabilityMass: 1,
    });
    expect(missingComparison?.renderedText).toContain('has no available draws');
    expect(missingComparison?.renderedText).toContain('[0%, 100%]');
  });

  it('rejects omitted, duplicate, extra-utility, and cross-parent lattice entries', () => {
    const fixture = bindStage5Fixture('two_party_player_swap');
    const artifacts = numericArtifacts(fixture);
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, { ...artifacts, distributions: artifacts.distributions.slice(1) })
        ),
      'INCOMPLETE_DISTRIBUTION_LATTICE'
    );
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, {
            ...artifacts,
            distributions: [...artifacts.distributions.slice(0, -1), artifacts.distributions[0]],
          })
        ),
      'INCOMPLETE_DISTRIBUTION_LATTICE'
    );
    const utility = createAflTradeValuationDistribution({
      valuationCase: fixture.valuationCase,
      valuationCalculation: fixture.calculation,
      view: 'at_trade',
      subject: subjects(fixture.valuationCase)[0],
      measure: { kind: 'single_afl_club_utility' },
      policy: policy(),
    });
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, {
            ...artifacts,
            distributions: [...artifacts.distributions.slice(1), utility],
          })
        ),
      'INCOMPLETE_DISTRIBUTION_LATTICE'
    );
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, { ...artifacts, comparisons: artifacts.comparisons.slice(1) })
        ),
      'INVALID_VALUATION_COMPARISONS'
    );
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, {
            ...artifacts,
            comparisons: [...artifacts.comparisons.slice(0, -1), artifacts.comparisons[0]],
          })
        ),
      'INCOMPLETE_COMPARISON_LATTICE'
    );
    const other = bindStage5Fixture('three_party_exchange');
    const foreign = numericArtifacts(other).distributions[0];
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, {
            ...artifacts,
            distributions: [foreign, ...artifacts.distributions.slice(1)],
          })
        ),
      'PARENT_LINEAGE_MISMATCH'
    );
  });

  it('rejects schema-valid distribution and comparison replay tampering', () => {
    const fixture = bindStage5Fixture('two_party_player_swap');
    const artifacts = numericArtifacts(fixture);
    const distribution = structuredClone(artifacts.distributions[0]);
    distribution.content.derivation.observationSha256 = '0'.repeat(64);
    const forgedDistribution = readdressDistribution(distribution);
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, {
            ...artifacts,
            distributions: [forgedDistribution, ...artifacts.distributions.slice(1)],
          })
        ),
      'DISTRIBUTION_REPLAY_FAILURE'
    );

    const comparison = structuredClone(artifacts.comparisons[0]);
    comparison.content.derivation.observationSha256 = '0'.repeat(64);
    const forgedComparison = readdressComparison(comparison);
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          input(fixture, {
            ...artifacts,
            comparisons: [forgedComparison, ...artifacts.comparisons.slice(1)],
          })
        ),
      'COMPARISON_REPLAY_FAILURE'
    );
  });

  it('keeps predecessor v1 audit-only, prohibits fallback, and separates coverage from confidence', () => {
    const fixture = bindStage5Fixture('three_party_exchange');
    const partial = makeAtTradeUnavailable(fixture, [0]);
    const explanation = createAflTradeStructuredExplanationV2(input(partial));
    expect(explanation.content.predecessorPolicy).toMatchObject({
      valuationSnapshotSetSchemaVersion: 'afl-trade-valuation-snapshot-set/v1',
      structuredExplanationSchemaVersion: 'afl-trade-structured-explanation/v1',
      compatibility: AFL_TRADE_STRUCTURED_EXPLANATION_V2_PREDECESSOR_COMPATIBILITY,
      runtimeFallback: AFL_TRADE_STRUCTURED_EXPLANATION_V2_RUNTIME_FALLBACK,
      publicationAuthority: 'successor_outputs_only',
      legacyTreatment: 'optional_audit_evidence_never_satisfies_required_output_roles',
    });
    expect(explanation.content.confidenceTreatment).toBe(
      AFL_TRADE_STRUCTURED_EXPLANATION_V2_CONFIDENCE_TREATMENT
    );
    expect(explanation.content.coverageTreatment).toBe(
      AFL_TRADE_STRUCTURED_EXPLANATION_V2_COVERAGE_TREATMENT
    );
    expect(explanation.content.verificationScope).toBe(
      AFL_TRADE_STRUCTURED_EXPLANATION_V2_VERIFICATION_SCOPE
    );
    expect(
      explanation.content.statements.some(
        (statement) => statement.claimKind === ('low_confidence_output' as never)
      )
    ).toBe(false);
    expect(
      explanation.content.statements.map((statement) => statement.renderedText).join(' ')
    ).not.toContain('50% confidence');
    expect(explanation.content.statements[2]).toMatchObject({
      reasonCode: 'practical_equivalence_definition_assumption',
      definitionArtifact: partial.bundle.content.simulation.practicalEquivalenceDefinitionArtifact,
    });

    for (const forbiddenKey of [
      'valuationSnapshotSet',
      'structuredExplanation',
      'fallbackValues',
    ]) {
      expectConstructionError(
        () => createAflTradeStructuredExplanationV2({ ...input(partial), [forbiddenKey]: {} }),
        'INVALID_INPUT_ENVELOPE'
      );
    }
    const tamperedContent = structuredClone(explanation.content) as Record<string, unknown>;
    (tamperedContent.predecessorPolicy as Record<string, unknown>).runtimeFallback = 'allowed';
    expect(aflTradeStructuredExplanationV2ContentSchema.safeParse(tamperedContent).success).toBe(
      false
    );
  });

  it('sanitizes hostile, spoofed, and revoked inputs and makes the verifier total', () => {
    const fixture = bindStage5Fixture('two_party_player_swap');
    const validInput = input(fixture);
    expectConstructionError(
      () =>
        createAflTradeStructuredExplanationV2(
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('secret-own-keys');
              },
            }
          )
        ),
      'INVALID_INPUT_ENVELOPE'
    );
    const hostile = { ...validInput };
    Object.defineProperty(hostile, 'valuationCase', {
      enumerable: true,
      get() {
        throw new Error('secret-case-getter');
      },
    });
    expectConstructionError(
      () => createAflTradeStructuredExplanationV2(hostile),
      'INVALID_INPUT_ENVELOPE'
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(isAflTradeStructuredExplanationV2ConstructionError(revoked.proxy)).toBe(false);
    const spoof = Object.create(AflTradeStructuredExplanationV2ConstructionError.prototype);
    expect(isAflTradeStructuredExplanationV2ConstructionError(spoof)).toBe(false);
    const trusted = new AflTradeStructuredExplanationV2ConstructionError('INVALID_VALUATION_CASE');
    expect(isAflTradeStructuredExplanationV2ConstructionError(trusted)).toBe(true);
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
    expect(JSON.stringify(trusted)).not.toContain('secret');
    expect(verifyAflTradeStructuredExplanationV2Derivation(revoked.proxy)).toBe(false);
    expect(
      verifyAflTradeStructuredExplanationV2Derivation(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('secret-verifier');
            },
          }
        )
      )
    ).toBe(false);
  });

  it('returns a deeply frozen alias-isolated artifact and fails closed after explanation tampering', () => {
    const fixture = bindStage5Fixture('two_party_player_swap');
    const artifacts = numericArtifacts(fixture);
    const mutableInput = input(fixture, {
      distributions: structuredClone(artifacts.distributions),
      comparisons: structuredClone(artifacts.comparisons),
    });
    const explanation = createAflTradeStructuredExplanationV2(mutableInput);
    const before = canonicalizeAflTradeJson(explanation);
    expect(isDeeplyFrozen(explanation)).toBe(true);
    expect(explanation.content.sourceBindings.distributions).not.toBe(
      mutableInput.valuationDistributions
    );
    mutableInput.valuationDistributions.reverse();
    mutableInput.valuationComparisons.reverse();
    expect(canonicalizeAflTradeJson(explanation)).toBe(before);

    const tampered = structuredClone(explanation);
    tampered.content.statements[0].renderedText = 'forged text';
    tampered.structuredExplanationId = createAflTradeContentAddress(
      'structured-explanation',
      tampered.content
    );
    expect(aflTradeStructuredExplanationV2Schema.safeParse(tampered).success).toBe(false);
    expect(
      verifyAflTradeStructuredExplanationV2Derivation({
        structuredExplanation: tampered,
        ...input(fixture, artifacts),
      })
    ).toBe(false);
  });
});
