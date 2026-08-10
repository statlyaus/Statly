// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradePublicationManifestV3Schema,
  type AflTradePublicationManifestV3,
} from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';
import { createAflTradeValuationOutputInventoryIndex } from '@/server/aflTradeIntelligence/artifacts/valuationOutputInventoryIndex';
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
import {
  aflTradeProjectionEvidenceSourceArtifactSchema,
  createAflTradeProjectionEvidenceSourceVerification,
  type AflTradeProjectionEvidenceSourceArtifact,
} from '@/server/aflTradeIntelligence/publication/projectionEvidenceSourceVerification';
import {
  AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION,
  AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING,
  AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION,
  AFL_TRADE_PROJECTION_MATERIALIZATION_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_DIGEST_DEFINITION,
  AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_SCHEMA_VERSION,
  AflTradeProjectionMaterializationError,
  aflTradeProjectionMaterializationEntrySchema,
  createAflTradeProjectionMaterialization,
  createAflTradeProjectionMaterializationShard,
  isAflTradeProjectionMaterializationError,
  verifyAflTradeProjectionMaterialization,
  verifyAflTradeProjectionMaterializationShard,
  type AflTradeProjectionMaterializationCreateInput,
  type AflTradeProjectionMaterializationShardCreateInput,
  type AflTradeProjectionMaterializationShardVerifyInput,
} from '@/server/aflTradeIntelligence/publication/projectionMaterialization';
import { createAflTradeProjectionPresentationPolicy } from '@/server/aflTradeIntelligence/publication/projectionPresentationPolicy';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  aflTradeProjectionPublicEvidenceContentSchema,
  createAflTradeProjectionPublicEvidence,
  type AflTradeProjectionPublicEvidenceContent,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidence';
import { createAflTradeProjectionPublicEvidenceIndex } from '@/server/aflTradeIntelligence/publication/projectionPublicEvidenceIndex';
import {
  createAflTradeProjectionSchemaBundle,
  createAflTradeProjectionSchemaBundleV2,
} from '@/server/aflTradeIntelligence/publication/projectionSchemaBundle';
import {
  createAflTradeProjectionTradeMaterialization,
  type AflTradeProjectionTradeMaterializerCreateInput,
  type AflTradeProjectionTradeMaterializationVerifyInput,
} from '@/server/aflTradeIntelligence/publication/projectionTradeMaterializer';
import { createAflTradeComponentDrawSet } from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
import { AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION } from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
  type AflTradeJointOutcomeValueQuantizationPolicy,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeValueQuantization';
import { createAflTradeValuationComparison } from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparisonArtifact';
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
import { createAflTradeStructuredExplanationV2 } from '@/server/aflTradeIntelligence/valuation/structuredExplanationsV2';
import {
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import {
  createAflTradeValuationCase,
  type AflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import {
  createAflTradeValuationDistribution,
  type AflTradeValuationDistributionMeasure,
  type AflTradeValuationDistributionSubject,
} from '@/server/aflTradeIntelligence/valuation/valuationDistributionArtifact';
import { createAflTradeValuationOutputInventory } from '@/server/aflTradeIntelligence/valuation/valuationOutputInventory';
import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
} from '@/types/aflTradeIntelligence';

const SOURCE_AT = '2026-08-05T00:00:00.000Z';
const CLAIM_AT = '2020-01-01T00:00:00.000Z';
const INVENTORY_AT = '2026-08-05T04:00:00.000Z';
const INDEX_AT = '2026-08-05T05:00:00.000Z';
const PUBLICATION_AT = '2026-08-05T06:00:00.000Z';
const EVIDENCE_AT = '2026-08-05T07:00:00.000Z';
const EVIDENCE_INDEX_AT = '2026-08-05T08:00:00.000Z';
const SCHEMA_AT = '2026-08-05T08:30:00.000Z';
const VERIFIED_AT = '2026-08-05T09:00:00.000Z';
const TRADE_MATERIALIZED_AT = '2026-08-05T10:00:00.000Z';
const SHARD_MATERIALIZED_AT = '2026-08-05T11:00:00.000Z';
const ROOT_MATERIALIZED_AT = '2026-08-05T12:00:00.000Z';
const SCOPE_KEY = 'fixture-projection-materialization';
const LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;
const SELECTED_LAYER = 'scarcity_adjusted' as const;

type SourceRole = 'confidence' | 'coverage' | 'asset_identity' | 'lineage_frontier' | 'factor';

function artifact(label: string, createdAt = SOURCE_AT) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
}

function bundleFor(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation
): AflTradeValuationBundleManifestV2 {
  const inventoryContract = {
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
    scopeKey: SCOPE_KEY,
    valueUnitId: valuationCase.content.valueUnitId,
    createdAt: SOURCE_AT,
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
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
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
      listSpotPolicyArtifact: artifact('list-spot'),
      scarcityPolicyArtifact: artifact('scarcity'),
      roleCongestionPolicyArtifact: artifact('role-congestion'),
    },
    simulation: {
      draws: calculation.content.draws.length,
      seed: 20260805,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('low-return'),
      eliteOutcomeDefinitionArtifact: artifact('elite-outcome'),
      practicalEquivalenceDefinitionArtifact: artifact('equivalence'),
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
      jobId: 'fixture-projection-materialization',
      attempt: 1,
      initiatedBy: 'fixture-operator',
      workerIdentity: 'fixture-worker',
      startedAt: SOURCE_AT,
      finishedAt: SOURCE_AT,
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
      explanationParityReportArtifact: artifact('parity'),
      coverageAndExclusionReportArtifact: artifact('coverage'),
      confidenceReportArtifact: artifact('confidence'),
      sensitivityReportArtifact: artifact('sensitivity'),
      validationReportArtifact: artifact('validation'),
      modelCardArtifact: artifact('model-card'),
    },
    outputInventoryContract: {
      ...inventoryContract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(inventoryContract, SOURCE_AT),
    },
    limitations: ['Fabricated aggregate-materialization fixture only.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

function boundValuationFixture() {
  const source = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const provisionalBundle = bundleFor(source.valuationCase, source.calculation);
  const componentDrawSet = createAflTradeComponentDrawSet({
    ...structuredClone(source.componentDrawSet.content),
    valuationBundleId: provisionalBundle.valuationBundleId,
  });
  const realizedContributionLedger = createAflTradeRealizedContributionLedger({
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
    componentDrawSetId: componentDrawSet.componentDrawSetId,
    realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
  });
  const calculation = calculateAflTradeValuation(
    valuationCase,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy
  );
  return { valuationCase, calculation, bundle: bundleFor(valuationCase, calculation) };
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

function numericArtifacts(fixture: ReturnType<typeof boundValuationFixture>) {
  const subjects: AflTradeValuationDistributionSubject[] =
    fixture.valuationCase.content.parties.flatMap((party) => [
      { kind: 'afl_club_received_package' as const, aflClubId: party.aflClubId },
      ...party.receivedRootAssetIds.map((rootAssetId) => ({
        kind: 'source_native_afl_trade_root' as const,
        aflClubId: party.aflClubId,
        rootAssetId,
      })),
    ]);
  const measures: AflTradeValuationDistributionMeasure[] = LAYERS.map((layer) => ({
    kind: 'universal_football_value',
    layer,
  }));
  const distributions = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    measures.flatMap((measure) =>
      subjects.map((subject) =>
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
  const quantizationPolicy: AflTradeJointOutcomeValueQuantizationPolicy = {
    definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
    decimalPlaces: 2,
  };
  const comparisons = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    LAYERS.map((layer) =>
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

function sourceArtifacts(): AflTradeProjectionEvidenceSourceArtifact[] {
  const roles: SourceRole[] = [
    'confidence',
    'coverage',
    'asset_identity',
    'lineage_frontier',
    'factor',
  ];
  return roles.map((role) => {
    const semanticArtifactId = `source-fixture:${sha256AflTradeCanonicalJson({ role })}`;
    const sourceArtifact = {
      sourceArtifactId: semanticArtifactId,
      content: {
        schemaVersion: 'afl-trade-source-fixture/v1',
        records: Array.from({ length: 40 }, (_, index) => ({
          locator: `${role}:${index}`,
          value: { role, index },
        })),
      },
    };
    return aflTradeProjectionEvidenceSourceArtifactSchema.parse({
      sourceSchemaVersion: 'afl-trade-source-fixture/v1',
      semanticArtifactId,
      sourceArtifact,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(sourceArtifact, SOURCE_AT),
    });
  });
}

function sourceBinding(
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[],
  role: SourceRole,
  index: number
) {
  const selected =
    sources[
      ['confidence', 'coverage', 'asset_identity', 'lineage_frontier', 'factor'].indexOf(role)
    ];
  if (!selected) throw new Error(`Missing ${role} fixture source.`);
  return {
    sourceRole: role,
    sourceSchemaVersion: selected.sourceSchemaVersion,
    semanticArtifactId: selected.semanticArtifactId,
    artifactRef: selected.artifactRef,
    recordLocator: `${role}:${index}`,
    fieldPath: '/value',
    claimedValueSha256: sha256AflTradeCanonicalJson({ role, index }),
    sourceEffectiveAt: CLAIM_AT,
    sourceKnownAt: CLAIM_AT,
  };
}

function evidenceContent(
  fixture: ReturnType<typeof boundValuationFixture>,
  publication: AflTradePublicationManifestV3,
  inventoryIndexId: string,
  inventoryId: string,
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[]
): AflTradeProjectionPublicEvidenceContent {
  const viewContexts = fixture.valuationCase.content.viewContexts.map(
    ({ view, effectiveAt, knowledgeCutoffAt, valuationAsOf }) => ({
      view,
      temporalContext: { effectiveAt, knowledgeCutoffAt, valuationAsOf },
    })
  );
  const roots = fixture.valuationCase.content.parties
    .flatMap((party) =>
      party.receivedRootAssetIds.map((rootAssetId) => ({
        rootAssetId,
        aflClubId: party.aflClubId,
      }))
    )
    .sort((left, right) => left.rootAssetId.localeCompare(right.rootAssetId));
  return aflTradeProjectionPublicEvidenceContentSchema.parse({
    schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
    publicationId: publication.publicationId,
    valuationBundleId: fixture.bundle.valuationBundleId,
    valuationOutputInventoryIndexId: inventoryIndexId,
    valuationOutputInventoryId: inventoryId,
    valuationCaseId: fixture.valuationCase.valuationCaseId,
    valuationCalculationId: fixture.calculation.valuationCalculationId,
    tradeId: fixture.valuationCase.content.tradeId,
    scopeKey: SCOPE_KEY,
    valueUnitId: fixture.valuationCase.content.valueUnitId,
    materializedAt: EVIDENCE_AT,
    viewContexts,
    confidenceByView: viewContexts.map(({ view, temporalContext }, viewIndex) => ({
      view,
      temporalContext,
      overallLevel: 'moderate' as const,
      dimensions: AFL_TRADE_CONFIDENCE_DIMENSIONS.map((dimension, dimensionIndex) => ({
        dimension,
        level: dimensionIndex === 0 ? ('moderate' as const) : ('high' as const),
        reasonCode: `verified-${dimension}`,
        explanation: `Fabricated direct evidence verifies ${dimension}.`,
        sourceBindings: [
          sourceBinding(
            sources,
            'confidence',
            viewIndex * AFL_TRADE_CONFIDENCE_DIMENSIONS.length + dimensionIndex
          ),
        ],
      })),
    })),
    coverageByView: viewContexts.map(({ view, temporalContext }, index) => ({
      view,
      temporalContext,
      status: 'complete' as const,
      totalAssetCount: roots.length,
      valuedAssetCount: roots.length,
      excludedAssetCount: 0 as const,
      excludedRoots: [],
      sourceBindings: [sourceBinding(sources, 'coverage', index)],
    })),
    assets: roots.map(({ rootAssetId, aflClubId }, index) => ({
      assetId: rootAssetId,
      assetKind: 'player' as const,
      label: `Fabricated player ${index + 1}`,
      receivedByAflClubId: aflClubId,
      identitySourceBindings: [sourceBinding(sources, 'asset_identity', index)],
      lineage: {
        status: 'resolved' as const,
        rootAssetId,
        creditedAssetIds: [rootAssetId],
        summary: 'The source-native player root is credited exactly once.',
        edgeCount: 0,
        maximumDepth: 0,
        sourceBindings: [sourceBinding(sources, 'lineage_frontier', index)],
      },
    })),
    factorsByView: viewContexts.map(({ view, temporalContext }, index) => ({
      view,
      temporalContext,
      factors: [
        {
          kind: 'positive' as const,
          code: 'verified-upside',
          label: 'Verified upside',
          explanation: 'A fabricated direct claim supports football-value upside.',
          sourceBindings: [sourceBinding(sources, 'factor', index * 2)],
        },
        {
          kind: 'uncertainty' as const,
          code: 'verified-uncertainty',
          label: 'Verified uncertainty',
          explanation: 'A fabricated direct claim identifies outcome uncertainty.',
          sourceBindings: [sourceBinding(sources, 'factor', index * 2 + 1)],
        },
      ],
    })),
    predecessorPolicy: {
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
    },
    limitation: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  });
}

function publicationFor(
  bundle: AflTradeValuationBundleManifestV2,
  inventoryIndex: ReturnType<typeof createAflTradeValuationOutputInventoryIndex>,
  policy: ReturnType<typeof createAflTradeProjectionPresentationPolicy>
) {
  const content = {
    schemaVersion: 'afl-trade-publication/v3' as const,
    environment: bundle.content.environment,
    scopeKey: SCOPE_KEY,
    createdAt: PUBLICATION_AT,
    valuationBundleId: bundle.valuationBundleId,
    gate3DecisionId: bundle.content.components[0].gate3DecisionId,
    sourceRegisterIds: ['source-register:fixture'],
    supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
    supportedCohorts: ['cohort:fixture'],
    excludedCohorts: [],
    valueUnitId: bundle.content.valueUnitId,
    entryCount: 1,
    publicationBundleArtifact: artifact('publication-bundle', INDEX_AT),
    methodologyArtifact: artifact('methodology', INDEX_AT),
    validationReportArtifact: artifact('publication-validation', INDEX_AT),
    modelCardArtifact: artifact('publication-model-card', INDEX_AT),
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
    valuationOutputInventoryIndex: {
      schemaVersion: inventoryIndex.valuationOutputInventoryIndex.content.schemaVersion,
      valuationOutputInventoryIndexId:
        inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      artifactRef: inventoryIndex.valuationOutputInventoryIndexArtifactRef,
      entryCount: inventoryIndex.valuationOutputInventoryIndex.content.entryCount,
      inventorySetSha256: inventoryIndex.valuationOutputInventoryIndex.content.inventorySetSha256,
    },
    freshnessPolicy: {
      schemaVersion: 'afl-trade-publication-freshness-policy/v1' as const,
      freshnessPolicyId: `freshness-policy:${'9'.repeat(64)}`,
      artifactRef: artifact('freshness-policy', INDEX_AT),
    },
    projectionPresentationPolicy: {
      schemaVersion: policy.projectionPresentationPolicy.content.schemaVersion,
      projectionPresentationPolicyId:
        policy.projectionPresentationPolicy.projectionPresentationPolicyId,
      artifactRef: policy.projectionPresentationPolicyArtifactRef,
      valueUnitId: policy.projectionPresentationPolicy.content.valueUnit.id,
      universalLayer: policy.projectionPresentationPolicy.content.universalLayer,
      supportedViews: policy.projectionPresentationPolicy.content.supportedViews,
    },
  };
  const publicationManifest = aflTradePublicationManifestV3Schema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
  return {
    publicationManifest,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(publicationManifest, PUBLICATION_AT),
  };
}

function buildTradeInput(): AflTradeProjectionTradeMaterializerCreateInput {
  const fixture = boundValuationFixture();
  const numeric = numericArtifacts(fixture);
  const explanation = createAflTradeStructuredExplanationV2({
    valuationBundleManifest: fixture.bundle,
    valuationCase: fixture.valuationCase,
    valuationCalculation: fixture.calculation,
    valuationDistributions: numeric.distributions,
    valuationComparisons: numeric.comparisons,
  });
  const bundleRef = createAflTradeCanonicalJsonArtifactRef(fixture.bundle, SOURCE_AT);
  const caseRef = createAflTradeCanonicalJsonArtifactRef(fixture.valuationCase, SOURCE_AT);
  const inventory = createAflTradeValuationOutputInventory({
    valuationBundle: { valuationBundleManifest: fixture.bundle, artifactRef: bundleRef },
    valuationCase: { valuationCase: fixture.valuationCase, artifactRef: caseRef },
    valuationCalculation: {
      valuationCalculation: fixture.calculation,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(fixture.calculation, SOURCE_AT),
    },
    valuationDistributions: numeric.distributions.map((valuationDistribution) => ({
      valuationDistribution,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationDistribution, SOURCE_AT),
    })),
    valuationComparisons: numeric.comparisons.map((valuationComparison) => ({
      valuationComparison,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationComparison, SOURCE_AT),
    })),
    structuredExplanation: {
      structuredExplanation: explanation,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(explanation, SOURCE_AT),
    },
    materializedAt: INVENTORY_AT,
  });
  const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
    valuationBundleManifest: fixture.bundle,
    valuationBundleArtifactRef: bundleRef,
    valuationOutputInventories: [
      {
        valuationOutputInventory: inventory.valuationOutputInventory,
        artifactRef: inventory.valuationOutputInventoryArtifactRef,
      },
    ],
    createdAt: INDEX_AT,
  });
  const policy = createAflTradeProjectionPresentationPolicy({
    valueUnit: {
      id: fixture.bundle.content.valueUnitId,
      label: 'Fabricated football contribution',
      description: 'A fabricated cross-club football-contribution unit for aggregate tests.',
      direction: 'higher_is_better',
    },
    universalLayer: SELECTED_LAYER,
    balancedMaximumLeaderMargin: 0.05,
    balancedMinimumPracticalEquivalenceProbability: 0.4,
    strongMinimumLeaderMargin: 0.2,
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
    createdAt: INDEX_AT,
  });
  const publication = publicationFor(fixture.bundle, inventoryIndex, policy);
  const sources = sourceArtifacts();
  const evidence = createAflTradeProjectionPublicEvidence({
    content: evidenceContent(
      fixture,
      publication.publicationManifest,
      inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      inventory.valuationOutputInventory.valuationOutputInventoryId,
      sources
    ),
    materializedAt: EVIDENCE_AT,
  });
  const evidenceIndex = createAflTradeProjectionPublicEvidenceIndex({
    publicationManifest: publication.publicationManifest,
    publicationManifestArtifactRef: publication.artifactRef,
    valuationOutputInventoryIndex: inventoryIndex.valuationOutputInventoryIndex,
    valuationOutputInventoryIndexArtifactRef:
      inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    valuationOutputInventories: [
      {
        valuationOutputInventory: inventory.valuationOutputInventory,
        artifactRef: inventory.valuationOutputInventoryArtifactRef,
      },
    ],
    projectionPublicEvidences: [
      {
        projectionPublicEvidence: evidence.projectionPublicEvidence,
        projectionPublicEvidenceArtifactRef: evidence.projectionPublicEvidenceArtifactRef,
      },
    ],
    materializedAt: EVIDENCE_INDEX_AT,
  });
  const evidenceSourceVerificationInput = {
    projectionPublicEvidenceResult: evidence,
    sourceArtifacts: sources,
    verifiedAt: VERIFIED_AT,
  };
  const evidenceSourceVerification = createAflTradeProjectionEvidenceSourceVerification(
    evidenceSourceVerificationInput
  );
  const selectedDistributions = numeric.distributions
    .filter(
      ({ content }) =>
        content.measure.kind === 'universal_football_value' &&
        content.measure.layer === SELECTED_LAYER
    )
    .map((valuationDistribution) => ({
      valuationDistribution,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationDistribution, SOURCE_AT),
    }));
  const selectedComparisons = numeric.comparisons
    .filter(({ content }) => content.measure.layer === SELECTED_LAYER)
    .map((valuationComparison) => ({
      valuationComparison,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationComparison, SOURCE_AT),
    }));
  return {
    publication,
    valuationOutputInventoryIndex: inventoryIndex,
    projectionPublicEvidenceIndex: evidenceIndex,
    projectionPresentationPolicy: policy,
    valuationOutputInventory: inventory,
    valuationCase: { valuationCase: fixture.valuationCase, artifactRef: caseRef },
    selectedDistributions,
    selectedComparisons,
    projectionPublicEvidence: evidence,
    evidenceSourceVerification: {
      ...evidenceSourceVerificationInput,
      output: evidenceSourceVerification,
    },
    materializedAt: TRADE_MATERIALIZED_AT,
  };
}

function buildPipeline() {
  const tradeInput = buildTradeInput();
  const tradeOutput = createAflTradeProjectionTradeMaterialization(tradeInput);
  const tradeVerification: AflTradeProjectionTradeMaterializationVerifyInput = {
    ...tradeInput,
    output: tradeOutput,
  };
  const commonParents = {
    publication: tradeInput.publication,
    valuationOutputInventoryIndex: tradeInput.valuationOutputInventoryIndex,
    projectionPublicEvidenceIndex: tradeInput.projectionPublicEvidenceIndex,
    projectionPresentationPolicy: tradeInput.projectionPresentationPolicy,
    projectionSchemaBundle: createAflTradeProjectionSchemaBundle({ createdAt: SCHEMA_AT }),
  };
  const shardInput: AflTradeProjectionMaterializationShardCreateInput = {
    ...commonParents,
    shardOrdinal: 0,
    projectionTradeMaterializerVerifications: [tradeVerification],
    materializedAt: SHARD_MATERIALIZED_AT,
  };
  const shardOutput = createAflTradeProjectionMaterializationShard(shardInput);
  const shardVerification: AflTradeProjectionMaterializationShardVerifyInput = {
    ...shardInput,
    output: shardOutput,
  };
  const rootInput: AflTradeProjectionMaterializationCreateInput = {
    ...commonParents,
    projectionMaterializationShardVerifications: [shardVerification],
    materializedAt: ROOT_MATERIALIZED_AT,
  };
  const rootOutput = createAflTradeProjectionMaterialization(rootInput);
  return {
    tradeInput,
    tradeOutput,
    tradeVerification,
    commonParents,
    shardInput,
    shardOutput,
    shardVerification,
    rootInput,
    rootOutput,
  };
}

function expectAggregateError(
  action: () => unknown,
  code: string
): AflTradeProjectionMaterializationError {
  try {
    action();
  } catch (error) {
    expect(isAflTradeProjectionMaterializationError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return error as AflTradeProjectionMaterializationError;
  }
  throw new Error(`Expected projection-materialization error ${code}.`);
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) &&
    Reflect.ownKeys(value).every((key) => isDeeplyFrozen(Reflect.get(value, key, value), seen))
  );
}

function collectKeys(value: unknown, keys = new Set<string>(), seen = new WeakSet<object>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string') keys.add(key);
    collectKeys(Reflect.get(value, key, value), keys, seen);
  }
  return keys;
}

describe('AFL trade projection aggregate materialization', () => {
  it('creates compact deterministic shard and root artifacts, freezes them, and totally replays both envelopes', () => {
    const pipeline = buildPipeline();
    const { shardOutput, shardVerification, rootInput, rootOutput } = pipeline;

    expect(pipeline.tradeInput.valuationCase.valuationCase.content.parties).toHaveLength(2);
    expect(Object.keys(shardOutput)).toEqual([
      'projectionMaterializationShard',
      'projectionMaterializationShardArtifactRef',
    ]);
    expect(Object.keys(rootOutput)).toEqual([
      'projectionMaterialization',
      'projectionMaterializationArtifactRef',
    ]);
    expect('projectionMaterializationShards' in rootOutput).toBe(false);
    expect(isDeeplyFrozen(shardOutput)).toBe(true);
    expect(isDeeplyFrozen(rootOutput)).toBe(true);
    expect(createAflTradeProjectionMaterializationShard(pipeline.shardInput)).toEqual(shardOutput);
    expect(createAflTradeProjectionMaterialization(rootInput)).toEqual(rootOutput);
    expect(verifyAflTradeProjectionMaterializationShard(shardVerification)).toBe(true);
    expect(verifyAflTradeProjectionMaterialization({ ...rootInput, output: rootOutput })).toBe(
      true
    );
  });

  it('authenticates the exact evidence join, document lattice, global counts, digests, and detached references', () => {
    const { tradeOutput, commonParents, shardOutput, rootOutput } = buildPipeline();
    const shard = shardOutput.projectionMaterializationShard;
    const shardContent = shard.content;
    const root = rootOutput.projectionMaterialization;
    const rootContent = root.content;
    const evidenceEntry =
      commonParents.projectionPublicEvidenceIndex.projectionPublicEvidenceIndex.content.entries[0];
    const entry = shardContent.entries[0];

    expect(shardContent).toMatchObject({
      schemaVersion: AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_SCHEMA_VERSION,
      ordering: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING,
      digestDefinition: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION,
      tradeCount: 1,
      documentCount: 13,
      materializedAt: SHARD_MATERIALIZED_AT,
      limitation: AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION,
    });
    expect(entry).toMatchObject({
      tradeId: evidenceEntry.tradeId,
      valuationCaseId: evidenceEntry.valuationCaseId,
      valuationCalculationId: evidenceEntry.valuationCalculationId,
      valuationOutputInventoryId: evidenceEntry.valuationOutputInventoryId,
      inventoryArtifactRef: evidenceEntry.inventoryArtifactRef,
      projectionPublicEvidence: {
        projectionPublicEvidenceId: evidenceEntry.projectionPublicEvidenceId,
        artifactRef: evidenceEntry.evidenceArtifactRef,
      },
      projectionTradeMaterialization: {
        projectionTradeMaterializationId:
          tradeOutput.projectionTradeMaterialization.projectionTradeMaterializationId,
        artifactRef: tradeOutput.projectionTradeMaterializationArtifactRef,
        documentSetSha256: tradeOutput.projectionTradeMaterialization.content.documentSetSha256,
      },
    });
    expect(entry.documents.map(({ kind }) => kind)).toEqual([
      'trade_detail',
      'trade_summary',
      'trade_summary',
      'trade_summary',
      'trade_summary',
      ...Array.from({ length: 8 }, () => 'valuation_export_row' as const),
    ]);
    expect(entry.documents.slice(1, 5).map(({ view }) => view)).toEqual(AFL_TRADE_VALUATION_VIEWS);
    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      expect(
        entry.documents
          .filter((document) => document.kind === 'valuation_export_row' && document.view === view)
          .map(({ rowOrdinal }) => rowOrdinal)
      ).toEqual([0, 1]);
    }
    expect(aflTradeProjectionMaterializationEntrySchema.safeParse(entry).success).toBe(true);
    expect(shardContent.entrySetSha256).toBe(sha256AflTradeCanonicalJson([entry]));
    expect(shard.projectionMaterializationShardId).toBe(
      createAflTradeContentAddress('projection-materialization-shard', shardContent)
    );
    expect(shardOutput.projectionMaterializationShardArtifactRef).toEqual(
      createAflTradeCanonicalJsonArtifactRef(shard, SHARD_MATERIALIZED_AT)
    );

    expect(rootContent).toMatchObject({
      schemaVersion: AFL_TRADE_PROJECTION_MATERIALIZATION_SCHEMA_VERSION,
      ordering: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING,
      entryDigestDefinition: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION,
      shardDigestDefinition: AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_DIGEST_DEFINITION,
      shardCount: 1,
      tradeCount: 1,
      documentCount: 13,
      materializedAt: ROOT_MATERIALIZED_AT,
      limitation: AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION,
    });
    expect(rootContent.calculationAsOf).toBe(shardContent.calculationAsOf);
    expect(rootContent.knowledgeCutoffAt).toBe(shardContent.knowledgeCutoffAt);
    expect(rootContent.evidenceTradeSetSha256).toBe(
      sha256AflTradeCanonicalJson([evidenceEntry.tradeId])
    );
    expect(rootContent.entrySetSha256).toBe(sha256AflTradeCanonicalJson([entry]));
    expect(rootContent.shardSetSha256).toBe(sha256AflTradeCanonicalJson(rootContent.shards));
    expect(root.projectionMaterializationId).toBe(
      createAflTradeContentAddress('projection-materialization', rootContent)
    );
    expect(rootOutput.projectionMaterializationArtifactRef).toEqual(
      createAflTradeCanonicalJsonArtifactRef(root, ROOT_MATERIALIZED_AT)
    );
  });

  it('rejects forged source verification, receipt output, and common-parent bindings before aggregation', () => {
    const pipeline = buildPipeline();

    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionSchemaBundle: createAflTradeProjectionSchemaBundleV2({
            createdAt: SCHEMA_AT,
          }),
        }),
      'PARENT_BINDING_MISMATCH'
    );

    const forgedVerification = structuredClone(pipeline.tradeVerification);
    forgedVerification.evidenceSourceVerification.output.projectionEvidenceSourceVerification.content.sourceArtifactSetSha256 =
      '0'.repeat(64);
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionTradeMaterializerVerifications: [forgedVerification],
        }),
      'INVALID_TRADE_MATERIALIZATIONS'
    );

    const forgedReceipt = structuredClone(pipeline.tradeVerification);
    forgedReceipt.output.projectionTradeMaterialization.content.documents.reverse();
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionTradeMaterializerVerifications: [forgedReceipt],
        }),
      'INVALID_TRADE_MATERIALIZATIONS'
    );

    const forgedPublication = structuredClone(pipeline.shardInput.publication);
    forgedPublication.artifactRef.contentSha256 = '0'.repeat(64);
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          publication: forgedPublication,
        }),
      'INVALID_PUBLICATION_BINDING'
    );

    const forgedSchemaBundle = structuredClone(pipeline.shardInput.projectionSchemaBundle);
    forgedSchemaBundle.projectionSchemaBundleArtifactRef.contentSha256 = '0'.repeat(64);
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionSchemaBundle: forgedSchemaBundle,
        }),
      'INVALID_SCHEMA_BUNDLE'
    );
  });

  it('rejects lattice drift, evidence substitution, and duplicate global receipt identities', () => {
    const pipeline = buildPipeline();
    const entry = structuredClone(
      pipeline.shardOutput.projectionMaterializationShard.content.entries[0]
    );

    const reorderedLattice = structuredClone(entry);
    reorderedLattice.documents.reverse();
    reorderedLattice.projectionTradeMaterialization.documentSetSha256 = sha256AflTradeCanonicalJson(
      reorderedLattice.documents
    );
    expect(aflTradeProjectionMaterializationEntrySchema.safeParse(reorderedLattice).success).toBe(
      false
    );

    const substitutedTrade = structuredClone(entry);
    substitutedTrade.documents[0].tradeId = 'fabricated-trade:substitution';
    substitutedTrade.projectionTradeMaterialization.documentSetSha256 = sha256AflTradeCanonicalJson(
      substitutedTrade.documents
    );
    expect(aflTradeProjectionMaterializationEntrySchema.safeParse(substitutedTrade).success).toBe(
      false
    );

    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionTradeMaterializerVerifications: [
            pipeline.tradeVerification,
            pipeline.tradeVerification,
          ],
        }),
      'MATERIALIZATION_BINDING_MISMATCH'
    );
  });

  it('rejects shard ordinal, root count, digest, range, and detached-result drift', () => {
    const pipeline = buildPipeline();
    const ordinalOneInput: AflTradeProjectionMaterializationShardCreateInput = {
      ...pipeline.shardInput,
      shardOrdinal: 1,
    };
    const ordinalOneOutput = createAflTradeProjectionMaterializationShard(ordinalOneInput);
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterialization({
          ...pipeline.rootInput,
          projectionMaterializationShardVerifications: [
            { ...ordinalOneInput, output: ordinalOneOutput },
          ],
        }),
      'INVALID_SHARDS'
    );

    const rootCases = [
      (() => {
        const candidate = structuredClone(pipeline.rootOutput);
        candidate.projectionMaterialization.content.shardCount += 1;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(pipeline.rootOutput);
        candidate.projectionMaterialization.content.documentCount += 1;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(pipeline.rootOutput);
        candidate.projectionMaterialization.content.entrySetSha256 = '0'.repeat(64);
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(pipeline.rootOutput);
        candidate.projectionMaterialization.content.shardSetSha256 = '0'.repeat(64);
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(pipeline.rootOutput);
        candidate.projectionMaterialization.content.shards[0].firstTradeId =
          'fabricated-trade:substitution';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(pipeline.rootOutput);
        candidate.projectionMaterializationArtifactRef.byteLength += 1;
        return candidate;
      })(),
    ];
    for (const output of rootCases) {
      expect(verifyAflTradeProjectionMaterialization({ ...pipeline.rootInput, output })).toBe(
        false
      );
    }
  });

  it('enforces evidence, verification, receipt, shard, and root chronology', () => {
    const pipeline = buildPipeline();
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          materializedAt: VERIFIED_AT,
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionSchemaBundle: createAflTradeProjectionSchemaBundle({
            createdAt: ROOT_MATERIALIZED_AT,
          }),
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterialization({
          ...pipeline.rootInput,
          materializedAt: TRADE_MATERIALIZED_AT,
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
  });

  it('contains hostile and inexact aggregate envelopes with stable branded errors', () => {
    const pipeline = buildPipeline();

    for (const input of [
      null,
      { ...pipeline.shardInput, unexpected: true },
      { ...pipeline.shardInput, userId: 'fixture-user', fantasyLeagueId: 'fixture-league' },
      { ...pipeline.shardInput, projectionDocumentSet: 'reverse-cycle' },
    ]) {
      expectAggregateError(
        () => createAflTradeProjectionMaterializationShard(input),
        'INVALID_INPUT_ENVELOPE'
      );
    }
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionTradeMaterializerVerifications: [],
        }),
      'INVALID_TRADE_MATERIALIZATIONS'
    );
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionTradeMaterializerVerifications: Array.from(
            { length: 27 },
            () => pipeline.tradeVerification
          ),
        }),
      'INVALID_TRADE_MATERIALIZATIONS'
    );
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          publication: 'latest',
        }),
      'INVALID_PUBLICATION_BINDING'
    );
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterializationShard({
          ...pipeline.shardInput,
          projectionTradeMaterializerVerifications: 'fallback',
        }),
      'INVALID_TRADE_MATERIALIZATIONS'
    );

    for (const input of [
      null,
      { ...pipeline.rootInput, unexpected: true },
      { ...pipeline.rootInput, ownerId: 'fixture-owner', fantasyTeamId: 'fixture-team' },
      { ...pipeline.rootInput, projectionManifest: 'reverse-cycle' },
    ]) {
      expectAggregateError(
        () => createAflTradeProjectionMaterialization(input),
        'INVALID_INPUT_ENVELOPE'
      );
    }
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterialization({
          ...pipeline.rootInput,
          projectionMaterializationShardVerifications: [],
        }),
      'INVALID_SHARDS'
    );
    expectAggregateError(
      () =>
        createAflTradeProjectionMaterialization({
          ...pipeline.rootInput,
          projectionMaterializationShardVerifications: Array.from(
            { length: 513 },
            () => pipeline.shardVerification
          ),
        }),
      'INVALID_SHARDS'
    );

    const benignShardProxy = new Proxy(pipeline.shardInput, {});
    expectAggregateError(
      () => createAflTradeProjectionMaterializationShard(benignShardProxy),
      'INVALID_INPUT_ENVELOPE'
    );
    let accessorReads = 0;
    const accessorRoot = Object.defineProperty({ ...pipeline.rootInput }, 'materializedAt', {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return ROOT_MATERIALIZED_AT;
      },
    });
    expectAggregateError(
      () => createAflTradeProjectionMaterialization(accessorRoot),
      'INVALID_INPUT_ENVELOPE'
    );
    expect(accessorReads).toBe(0);

    const hostileShard = new Proxy(pipeline.shardInput, {
      ownKeys() {
        throw new Error('hostile shard ownKeys');
      },
    });
    expectAggregateError(
      () => createAflTradeProjectionMaterializationShard(hostileShard),
      'INVALID_INPUT_ENVELOPE'
    );
    const revokedRoot = Proxy.revocable(pipeline.rootInput, {});
    revokedRoot.revoke();
    expectAggregateError(
      () => createAflTradeProjectionMaterialization(revokedRoot.proxy),
      'INVALID_INPUT_ENVELOPE'
    );

    const branded = new AflTradeProjectionMaterializationError('INVALID_SHARDS');
    expect(isAflTradeProjectionMaterializationError(branded)).toBe(true);
    expect(Object.isFrozen(branded)).toBe(true);
    expect(branded.toJSON()).toEqual({
      name: 'AflTradeProjectionMaterializationError',
      code: 'INVALID_SHARDS',
      message: 'The shard verification envelopes are invalid or fail total replay.',
    });
    expect(isAflTradeProjectionMaterializationError(new Error(branded.message))).toBe(false);
  });

  it('contains no ownership, fantasy-state, serving, or reverse-cycle identities', () => {
    const { rootOutput } = buildPipeline();
    const keys = collectKeys(rootOutput);
    for (const prohibited of [
      'userId',
      'ownerId',
      'fantasyLeagueId',
      'fantasyTeamId',
      'rosterId',
      'projectionDocumentSetId',
      'projectionParityReportId',
      'projectionId',
      'projectionManifest',
      'publicationApproval',
      'servingAuthority',
    ]) {
      expect(keys.has(prohibited)).toBe(false);
    }
    expect(rootOutput.projectionMaterialization.content.publicAssetBoundary).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(rootOutput.projectionMaterialization.content.limitation).toMatch(
      /does not approve or activate publication/i
    );
    expect(rootOutput.projectionMaterialization.content.limitation).toMatch(
      /authorize serving or fantasy state/i
    );
    expect(rootOutput.projectionMaterialization.content.limitation).toMatch(
      /user or fantasy ownership/i
    );
  });
});
