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
  aflTradeProjectionEvidenceSourceArtifactSchema,
  createAflTradeProjectionEvidenceSourceVerification,
  type AflTradeProjectionEvidenceSourceArtifact,
} from '@/server/aflTradeIntelligence/publication/projectionEvidenceSourceVerification';
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
  createAflTradeProjectionTradeMaterialization,
  isAflTradeProjectionTradeMaterializationError,
  verifyAflTradeProjectionTradeMaterialization,
  type AflTradeProjectionTradeMaterializerCreateInput,
} from '@/server/aflTradeIntelligence/publication/projectionTradeMaterializer';
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
const VERIFIED_AT = '2026-08-05T09:00:00.000Z';
const MATERIALIZED_AT = '2026-08-05T10:00:00.000Z';
const SCOPE_KEY = 'fixture-projection-trade-materializer';
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
  const contract = {
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
      jobId: 'fixture-materializer',
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
      ...contract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(contract, SOURCE_AT),
    },
    limitations: ['Fabricated materializer fixture only.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

function boundValuationFixture() {
  const source = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const provisionalBundle = bundleFor(source.valuationCase, source.calculation);
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

function numericArtifacts(fixture: ReturnType<typeof boundValuationFixture>) {
  const measures: AflTradeValuationDistributionMeasure[] = LAYERS.map((layer) => ({
    kind: 'universal_football_value',
    layer,
  }));
  const distributions = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
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
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[],
  partialCurrentCoverage: boolean
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
  const content = {
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
    coverageByView: viewContexts.map(({ view, temporalContext }, index) => {
      if (partialCurrentCoverage && view === 'current') {
        return {
          view,
          temporalContext,
          status: 'partial' as const,
          totalAssetCount: roots.length,
          valuedAssetCount: roots.length - 1,
          excludedAssetCount: 1,
          excludedRoots: [
            {
              rootAssetId: roots[0].rootAssetId,
              reasonCode: 'fixture-current-coverage-gap',
              message: 'The fabricated current root lacks complete admissible coverage.',
              sourceBindings: [sourceBinding(sources, 'coverage', 10)],
            },
          ],
          sourceBindings: [sourceBinding(sources, 'coverage', index)],
        };
      }
      return {
        view,
        temporalContext,
        status: 'complete' as const,
        totalAssetCount: roots.length,
        valuedAssetCount: roots.length,
        excludedAssetCount: 0 as const,
        excludedRoots: [],
        sourceBindings: [sourceBinding(sources, 'coverage', index)],
      };
    }),
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
  };
  return aflTradeProjectionPublicEvidenceContentSchema.parse(content);
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

function buildInput(
  options: {
    partialCurrentCoverage?: boolean;
  } = {}
): AflTradeProjectionTradeMaterializerCreateInput {
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
      description: 'A fabricated cross-club football-contribution unit for materializer tests.',
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
      sources,
      options.partialCurrentCoverage ?? false
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
  const verificationInput = {
    projectionPublicEvidenceResult: evidence,
    sourceArtifacts: sources,
    verifiedAt: VERIFIED_AT,
  };
  const verification = createAflTradeProjectionEvidenceSourceVerification(verificationInput);
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
    publication: {
      publicationManifest: publication.publicationManifest,
      artifactRef: publication.artifactRef,
    },
    valuationOutputInventoryIndex: inventoryIndex,
    projectionPublicEvidenceIndex: evidenceIndex,
    projectionPresentationPolicy: policy,
    valuationOutputInventory: inventory,
    valuationCase: { valuationCase: fixture.valuationCase, artifactRef: caseRef },
    selectedDistributions,
    selectedComparisons,
    projectionPublicEvidence: evidence,
    evidenceSourceVerification: { ...verificationInput, output: verification },
    materializedAt: MATERIALIZED_AT,
  };
}

function expectMaterializationError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isAflTradeProjectionTradeMaterializationError(error)).toBe(true);
    expect(error).toMatchObject({ code });
  }
}

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((child) => deeplyFrozen(child, seen));
}

describe('AFL trade projection trade materializer', () => {
  it('materializes one authenticated two-party trade deterministically and deeply freezes it', () => {
    const input = buildInput();
    const output = createAflTradeProjectionTradeMaterialization(input);

    expect(input.valuationCase.valuationCase.content.parties).toHaveLength(2);
    expect(
      input.valuationCase.valuationCase.content.parties.every(
        ({ receivedRootAssetIds }) => receivedRootAssetIds.length === 1
      )
    ).toBe(true);
    expect(output.projectionDocuments).toHaveLength(13);
    expect(
      output.projectionDocuments.map(({ projectionDocument }) => projectionDocument.content.kind)
    ).toEqual([
      'trade_detail',
      'trade_summary',
      'trade_summary',
      'trade_summary',
      'trade_summary',
      ...Array.from({ length: 8 }, () => 'valuation_export_row' as const),
    ]);
    expect(deeplyFrozen(output)).toBe(true);
    expect(createAflTradeProjectionTradeMaterialization(input)).toEqual(output);
    expect(verifyAflTradeProjectionTradeMaterialization({ ...input, output })).toBe(true);
  });

  it('maps selected distributions, comparison probabilities, factors, and current identities losslessly', () => {
    const input = buildInput();
    const output = createAflTradeProjectionTradeMaterialization(input);
    const detail = output.projectionDocuments[0].projectionDocument.content;
    if (detail.kind !== 'trade_detail') throw new Error('Expected detail first.');

    const current = detail.valuations.find(({ view }) => view === 'current');
    const realized = detail.valuations.find(({ view }) => view === 'realized');
    const remaining = detail.valuations.find(({ view }) => view === 'remaining');
    if (
      current?.availability !== 'available' ||
      realized?.availability !== 'available' ||
      remaining?.availability !== 'available'
    ) {
      throw new Error('Expected complete value fixtures.');
    }
    for (const club of current.clubValues) {
      const realizedClub = realized.clubValues.find(
        ({ aflClubId }) => aflClubId === club.aflClubId
      );
      const remainingClub = remaining.clubValues.find(
        ({ aflClubId }) => aflClubId === club.aflClubId
      );
      expect(club.estimate).toBeCloseTo(
        (realizedClub?.estimate ?? Number.NaN) + (remainingClub?.estimate ?? Number.NaN),
        10
      );
    }
    const currentSummary = output.projectionDocuments.find(
      ({ projectionDocument }) =>
        projectionDocument.content.kind === 'trade_summary' &&
        projectionDocument.content.view === 'current'
    )?.projectionDocument.content;
    if (!currentSummary || currentSummary.kind !== 'trade_summary') {
      throw new Error('Expected current summary.');
    }
    expect(currentSummary.viewGlobalFactors).toEqual(
      detail.viewGlobalFactors.find(({ view }) => view === 'current')
    );
    const currentExports = output.projectionDocuments.flatMap(({ projectionDocument }) => {
      const content = projectionDocument.content;
      return content.kind === 'valuation_export_row' && content.exportRow.view === 'current'
        ? [content]
        : [];
    });
    expect(currentExports).toHaveLength(2);
    expect(currentExports[0].viewGlobalFactors).toEqual(currentSummary.viewGlobalFactors);
    expect(currentExports[1].viewGlobalFactors).toBeNull();
    expect(currentExports.map((content) => content.exportRow.clubValue)).toEqual(
      'clubValues' in currentSummary.valuation ? currentSummary.valuation.clubValues : []
    );
    expect(
      currentExports.map((content) => content.exportRow.selectedClubOutcome?.distribution)
    ).toEqual(current.clubValues.map(({ distribution }) => distribution));
  });

  it('fails closed to a non-value-bearing current document when coverage is incomplete', () => {
    const output = createAflTradeProjectionTradeMaterialization(
      buildInput({ partialCurrentCoverage: true })
    );
    const currentSummary = output.projectionDocuments.find(
      ({ projectionDocument }) =>
        projectionDocument.content.kind === 'trade_summary' &&
        projectionDocument.content.view === 'current'
    )?.projectionDocument.content;
    if (!currentSummary || currentSummary.kind !== 'trade_summary') {
      throw new Error('Expected current summary.');
    }
    expect(currentSummary.valuation).toMatchObject({
      availability: 'insufficient_data',
      reasonCode: 'asset-coverage-incomplete',
    });
    const currentExports = output.projectionDocuments.filter(
      ({ projectionDocument }) =>
        projectionDocument.content.kind === 'valuation_export_row' &&
        projectionDocument.content.exportRow.view === 'current'
    );
    expect(currentExports).toHaveLength(1);
    expect(currentExports[0].projectionDocument.content).toMatchObject({
      exportRow: { rowOrdinal: 0, clubValue: null, selectedClubOutcome: null },
    });
  });

  it('rejects evidence/case context drift and comparison party-frontier drift', () => {
    const contextDrift = buildInput();
    const evidence = structuredClone(contextDrift.projectionPublicEvidence);
    evidence.projectionPublicEvidence.content.viewContexts[0].temporalContext.valuationAsOf =
      '2024-10-11T00:00:00.000Z';
    expectMaterializationError(
      () =>
        createAflTradeProjectionTradeMaterialization({
          ...contextDrift,
          projectionPublicEvidence: evidence,
        }),
      'INVALID_PUBLIC_EVIDENCE'
    );

    const partyDrift = buildInput();
    const comparisons = structuredClone(partyDrift.selectedComparisons);
    comparisons[0].valuationComparison.content.derivation.partyRootFrontiers.reverse();
    expectMaterializationError(
      () =>
        createAflTradeProjectionTradeMaterialization({
          ...partyDrift,
          selectedComparisons: comparisons,
        }),
      'INVALID_SELECTED_COMPARISONS'
    );
  });

  it('rejects receipt membership, digest, time, detached-result, and replay tampering', () => {
    const input = buildInput();
    const output = createAflTradeProjectionTradeMaterialization(input);
    const cases = [
      (() => {
        const candidate = structuredClone(output);
        candidate.projectionTradeMaterialization.content.documents.reverse();
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(output);
        candidate.projectionTradeMaterialization.content.documentCount += 1;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(output);
        candidate.projectionTradeMaterialization.content.documentSetSha256 = '0'.repeat(64);
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(output);
        candidate.projectionTradeMaterialization.content.materializedAt = SOURCE_AT;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(output);
        candidate.projectionDocuments.pop();
        return candidate;
      })(),
    ];
    for (const candidate of cases) {
      expect(verifyAflTradeProjectionTradeMaterialization({ ...input, output: candidate })).toBe(
        false
      );
    }
    expect(
      verifyAflTradeProjectionTradeMaterialization({
        ...input,
        materializedAt: '2026-08-05T10:00:00.001Z',
        output,
      })
    ).toBe(false);
  });

  it('rejects hostile, inexact, ownership-bearing, latest, and fallback envelopes', () => {
    const input = buildInput();
    for (const hostile of [
      null,
      { ...input, extra: true },
      { ...input, userId: 'fixture-user', fantasyLeagueId: 'fixture-league' },
      { ...input, publication: 'latest' },
      { ...input, valuationOutputInventory: { fallback: true } },
    ]) {
      expect(() => createAflTradeProjectionTradeMaterialization(hostile)).toThrow();
    }
    const throwing = new Proxy(input, {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
    });
    expectMaterializationError(
      () => createAflTradeProjectionTradeMaterialization(throwing),
      'INVALID_INPUT_ENVELOPE'
    );
  });
});
