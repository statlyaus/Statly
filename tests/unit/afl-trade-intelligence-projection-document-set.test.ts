// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
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
  AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
  aflTradeProjectionMaterializationBindingSchema,
  createAflTradeProjectionDocumentArtifact,
  type AflTradeProjectionDocumentContent,
} from '@/server/aflTradeIntelligence/publication/projectionDocumentContracts';
import {
  AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_SHARD_BYTES,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_ORDERING,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLICATION_AUTHORITY,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_RUNTIME_FALLBACK,
  AflTradeProjectionDocumentSetConstructionError,
  createAflTradeProjectionDocumentSet,
  isAflTradeProjectionDocumentSetConstructionError,
  verifyAflTradeProjectionDocumentSet,
  type AflTradeProjectionDocumentSetConstructionErrorCode,
} from '@/server/aflTradeIntelligence/publication/projectionDocumentSet';
import { createAflTradeFreshnessPolicy } from '@/server/aflTradeIntelligence/publication/freshnessPolicy';
import {
  aflTradeProjectionEvidenceSourceArtifactSchema,
  createAflTradeProjectionEvidenceSourceVerification,
  type AflTradeProjectionEvidenceSourceArtifact,
} from '@/server/aflTradeIntelligence/publication/projectionEvidenceSourceVerification';
import {
  createAflTradeProjectionMaterialization,
  createAflTradeProjectionMaterializationShard,
  type AflTradeProjectionMaterializationResult,
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
import { createAflTradeProjectionSchemaBundle } from '@/server/aflTradeIntelligence/publication/projectionSchemaBundle';
import { createAflTradeProjectionTradeMaterialization } from '@/server/aflTradeIntelligence/publication/projectionTradeMaterializer';
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
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
  createAflTradeValuationOutputInventory,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputInventory';
import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
  type AflTradePublishedMethodology,
} from '@/types/aflTradeIntelligence';

const CONTRACT_AT = '2026-08-05T00:30:00.000Z';
const SOURCE_AT = '2026-08-05T03:00:00.000Z';
const BUNDLE_REF_AT = '2026-08-05T03:10:00.000Z';
const ROOT_AT = '2026-08-05T04:00:00.000Z';
const INDEX_AT = '2026-08-05T05:00:00.000Z';
const POLICY_AT = '2026-08-05T05:10:00.000Z';
const PUBLICATION_ARTIFACT_AT = '2026-08-05T05:20:00.000Z';
const PUBLICATION_AT = '2026-08-05T06:00:00.000Z';
const DOCUMENT_AT = '2026-08-05T07:00:00.000Z';
const EVIDENCE_AT = '2026-08-05T06:10:00.000Z';
const EVIDENCE_INDEX_AT = '2026-08-05T06:20:00.000Z';
const SCHEMA_AT = '2026-08-05T06:30:00.000Z';
const VERIFIED_AT = '2026-08-05T06:40:00.000Z';
const MATERIALIZATION_SHARD_AT = '2026-08-05T07:10:00.000Z';
const MATERIALIZATION_ROOT_AT = '2026-08-05T07:20:00.000Z';
const METHODOLOGY_AT = '2026-08-05T07:30:00.000Z';
const SET_AT = '2026-08-05T08:00:00.000Z';
const SCOPE_KEY = 'public-afl-trade-values';
const VALUE_UNIT_ID = 'fixture-football-value-v1';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

function artifact(label: string, createdAt = SOURCE_AT) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
}

function semanticId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function inventoryContractPayload() {
  return {
    inventorySchemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
    bindingDirection: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION,
    granularity: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY,
    distributionPartitioning: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING,
    semanticBinding: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
    publicationRequirement: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT,
  } as const;
}

function createBundle(
  valuationCase?: AflTradeValuationCase,
  calculation?: AflTradeValuationCalculation
): AflTradeValuationBundleManifestV2 {
  const contract = inventoryContractPayload();
  const currentContext = {
    modelVintage: 'current' as const,
    effectiveAt: '2026-01-01T00:00:00.000Z',
    knowledgeCutoffAt: '2026-01-01T00:00:00.000Z',
    valuationAsOf: '2026-01-01T00:00:00.000Z',
  };
  const content = {
    schemaVersion: 'afl-trade-valuation-bundle/v2' as const,
    environment: 'non_production' as const,
    scopeKey: SCOPE_KEY,
    valueUnitId: valuationCase?.content.valueUnitId ?? VALUE_UNIT_ID,
    createdAt: SOURCE_AT,
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: semanticId('model-protocol', 'player-protocol'),
        runId: semanticId('model-run', 'player-run'),
        datasetId: semanticId('dataset', 'player-dataset'),
        gate3DecisionId: semanticId('gate-decision', 'player-gate'),
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: semanticId('model-protocol', 'pick-protocol'),
        runId: semanticId('model-run', 'pick-run'),
        datasetId: semanticId('dataset', 'pick-dataset'),
        gate3DecisionId: semanticId('gate-decision', 'pick-gate'),
      },
    ],
    viewContexts: valuationCase?.content.viewContexts ?? [
      {
        view: 'at_trade' as const,
        modelVintage: 'historical_restatement' as const,
        effectiveAt: '2020-11-12T00:00:00.000Z',
        knowledgeCutoffAt: '2020-11-11T23:59:59.000Z',
        valuationAsOf: '2020-11-12T00:00:00.000Z',
      },
      { view: 'realized' as const, ...currentContext },
      { view: 'remaining' as const, ...currentContext },
      { view: 'current' as const, ...currentContext },
    ],
    publicAssetBoundary: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
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
      draws: calculation?.content.draws.length ?? 2,
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
      jobId: 'fixture-job',
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
      ...contract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(contract, CONTRACT_AT),
    },
    limitations: ['Focused source-independent projection-document-set fixture.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

type SourceRole = 'confidence' | 'coverage' | 'asset_identity' | 'lineage_frontier' | 'factor';

function boundValuationFixture() {
  const source = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const provisionalBundle = createBundle(source.valuationCase, source.calculation);
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
  return { valuationCase, calculation, bundle: createBundle(valuationCase, calculation) };
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
  const measures: AflTradeValuationDistributionMeasure[] = UNIVERSAL_LAYERS.map((layer) => ({
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
  if (!selected) throw new Error(`Missing ${role} source.`);
  return {
    sourceRole: role,
    sourceSchemaVersion: selected.sourceSchemaVersion,
    semanticArtifactId: selected.semanticArtifactId,
    artifactRef: selected.artifactRef,
    recordLocator: `${role}:${index}`,
    fieldPath: '/value',
    claimedValueSha256: sha256AflTradeCanonicalJson({ role, index }),
    sourceEffectiveAt: '2020-01-01T00:00:00.000Z',
    sourceKnownAt: '2020-01-01T00:00:00.000Z',
  };
}

function realEvidenceContent(
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
      party.receivedRootAssetIds.map((rootAssetId) => ({ rootAssetId, aflClubId: party.aflClubId }))
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
        explanation: `Fabricated evidence verifies ${dimension}.`,
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

function buildAggregatePipeline(options: { substituteMethodologyArtifact?: boolean } = {}) {
  const fixture = boundValuationFixture();
  const numeric = numericArtifacts(fixture);
  const explanation = createAflTradeStructuredExplanationV2({
    valuationBundleManifest: fixture.bundle,
    valuationCase: fixture.valuationCase,
    valuationCalculation: fixture.calculation,
    valuationDistributions: numeric.distributions,
    valuationComparisons: numeric.comparisons,
  });
  const bundleArtifactRef = createAflTradeCanonicalJsonArtifactRef(fixture.bundle, BUNDLE_REF_AT);
  const caseArtifactRef = createAflTradeCanonicalJsonArtifactRef(fixture.valuationCase, SOURCE_AT);
  const inventory = createAflTradeValuationOutputInventory({
    valuationBundle: {
      valuationBundleManifest: fixture.bundle,
      artifactRef: bundleArtifactRef,
    },
    valuationCase: { valuationCase: fixture.valuationCase, artifactRef: caseArtifactRef },
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
    materializedAt: ROOT_AT,
  });
  const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
    valuationBundleManifest: fixture.bundle,
    valuationBundleArtifactRef: bundleArtifactRef,
    valuationOutputInventories: [
      {
        valuationOutputInventory: inventory.valuationOutputInventory,
        artifactRef: inventory.valuationOutputInventoryArtifactRef,
      },
    ],
    createdAt: INDEX_AT,
  });
  const freshness = createAflTradeFreshnessPolicy({
    scopeKey: SCOPE_KEY,
    valueUnitId: fixture.bundle.content.valueUnitId,
    currentDurationSeconds: 86_400,
    staleServeDurationSeconds: 86_400,
    createdAt: POLICY_AT,
  });
  const presentationPolicy = createAflTradeProjectionPresentationPolicy({
    valueUnit: {
      id: fixture.bundle.content.valueUnitId,
      label: 'Fabricated football contribution',
      description: 'A fabricated cross-club football-contribution unit for document-set tests.',
      direction: 'higher_is_better',
    },
    universalLayer: 'scarcity_adjusted',
    balancedMaximumLeaderMargin: 0.05,
    balancedMinimumPracticalEquivalenceProbability: 0.4,
    strongMinimumLeaderMargin: 0.2,
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
    createdAt: POLICY_AT,
  });
  const currentContext = fixture.valuationCase.content.viewContexts.find(
    ({ view }) => view === 'current'
  );
  if (!currentContext) throw new Error('Missing current valuation context.');
  const methodologyPayload = methodology(
    fixture.bundle.valuationBundleId,
    fixture.bundle.content.valueUnitId,
    currentContext.valuationAsOf
  );
  const methodologyArtifact = options.substituteMethodologyArtifact
    ? artifact('substituted-publication-methodology', PUBLICATION_ARTIFACT_AT)
    : createAflTradeCanonicalJsonArtifactRef(methodologyPayload, PUBLICATION_ARTIFACT_AT);
  const publicationContent = {
    schemaVersion: 'afl-trade-publication/v3' as const,
    environment: 'non_production' as const,
    scopeKey: SCOPE_KEY,
    createdAt: PUBLICATION_AT,
    valuationBundleId: fixture.bundle.valuationBundleId,
    gate3DecisionId: fixture.bundle.content.components[0].gate3DecisionId,
    sourceRegisterIds: ['fixture-source-register'],
    supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
    supportedCohorts: ['fixture-supported-cohort'],
    excludedCohorts: [],
    valueUnitId: fixture.bundle.content.valueUnitId,
    entryCount: 1,
    publicationBundleArtifact: artifact('publication-bundle', PUBLICATION_ARTIFACT_AT),
    methodologyArtifact,
    validationReportArtifact: artifact('publication-validation', PUBLICATION_ARTIFACT_AT),
    modelCardArtifact: artifact('publication-model-card', PUBLICATION_ARTIFACT_AT),
    publicAssetBoundary: AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY,
    valuationOutputInventoryIndex: {
      schemaVersion: inventoryIndex.valuationOutputInventoryIndex.content.schemaVersion,
      valuationOutputInventoryIndexId:
        inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      artifactRef: inventoryIndex.valuationOutputInventoryIndexArtifactRef,
      entryCount: inventoryIndex.valuationOutputInventoryIndex.content.entryCount,
      inventorySetSha256: inventoryIndex.valuationOutputInventoryIndex.content.inventorySetSha256,
    },
    freshnessPolicy: {
      schemaVersion: freshness.freshnessPolicy.content.schemaVersion,
      freshnessPolicyId: freshness.freshnessPolicy.freshnessPolicyId,
      artifactRef: freshness.freshnessPolicyArtifactRef,
    },
    projectionPresentationPolicy: {
      schemaVersion: presentationPolicy.projectionPresentationPolicy.content.schemaVersion,
      projectionPresentationPolicyId:
        presentationPolicy.projectionPresentationPolicy.projectionPresentationPolicyId,
      artifactRef: presentationPolicy.projectionPresentationPolicyArtifactRef,
      valueUnitId: presentationPolicy.projectionPresentationPolicy.content.valueUnit.id,
      universalLayer: presentationPolicy.projectionPresentationPolicy.content.universalLayer,
      supportedViews: presentationPolicy.projectionPresentationPolicy.content.supportedViews,
    },
  };
  const publicationManifest = aflTradePublicationManifestV3Schema.parse({
    publicationId: createAflTradeContentAddress('publication', publicationContent),
    content: publicationContent,
  });
  const publication = {
    publicationManifest,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(publicationManifest, PUBLICATION_AT),
  };
  const sources = sourceArtifacts();
  const evidence = createAflTradeProjectionPublicEvidence({
    content: realEvidenceContent(
      fixture,
      publicationManifest,
      inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      inventory.valuationOutputInventory.valuationOutputInventoryId,
      sources
    ),
    materializedAt: EVIDENCE_AT,
  });
  const evidenceIndex = createAflTradeProjectionPublicEvidenceIndex({
    publicationManifest,
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
  const evidenceVerificationInput = {
    projectionPublicEvidenceResult: evidence,
    sourceArtifacts: sources,
    verifiedAt: VERIFIED_AT,
  };
  const tradeInput = {
    publication,
    valuationOutputInventoryIndex: inventoryIndex,
    projectionPublicEvidenceIndex: evidenceIndex,
    projectionPresentationPolicy: presentationPolicy,
    valuationOutputInventory: inventory,
    valuationCase: { valuationCase: fixture.valuationCase, artifactRef: caseArtifactRef },
    selectedDistributions: numeric.distributions
      .filter(
        ({ content }) =>
          content.measure.kind === 'universal_football_value' &&
          content.measure.layer === 'scarcity_adjusted'
      )
      .map((valuationDistribution) => ({
        valuationDistribution,
        artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationDistribution, SOURCE_AT),
      })),
    selectedComparisons: numeric.comparisons
      .filter(({ content }) => content.measure.layer === 'scarcity_adjusted')
      .map((valuationComparison) => ({
        valuationComparison,
        artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationComparison, SOURCE_AT),
      })),
    projectionPublicEvidence: evidence,
    evidenceSourceVerification: {
      ...evidenceVerificationInput,
      output: createAflTradeProjectionEvidenceSourceVerification(evidenceVerificationInput),
    },
    materializedAt: DOCUMENT_AT,
  };
  const tradeOutput = createAflTradeProjectionTradeMaterialization(tradeInput);
  const tradeVerification = { ...tradeInput, output: tradeOutput };
  const commonParents = {
    publication,
    valuationOutputInventoryIndex: inventoryIndex,
    projectionPublicEvidenceIndex: evidenceIndex,
    projectionPresentationPolicy: presentationPolicy,
    projectionSchemaBundle: createAflTradeProjectionSchemaBundle({ createdAt: SCHEMA_AT }),
  };
  const shardInput = {
    ...commonParents,
    shardOrdinal: 0,
    projectionTradeMaterializerVerifications: [tradeVerification],
    materializedAt: MATERIALIZATION_SHARD_AT,
  };
  const shardOutput = createAflTradeProjectionMaterializationShard(shardInput);
  const rootInput = {
    ...commonParents,
    projectionMaterializationShardVerifications: [{ ...shardInput, output: shardOutput }],
    materializedAt: MATERIALIZATION_ROOT_AT,
  };
  const rootOutput = createAflTradeProjectionMaterialization(rootInput);
  return {
    fixture,
    publicationManifest,
    inventoryIndex,
    methodologyPayload,
    tradeOutput,
    rootOutput,
    projectionMaterializationVerification: { ...rootInput, output: rootOutput },
  };
}

function methodology(
  valuationBundleId: string,
  valueUnitId: string,
  calculationAsOf: string
): AflTradePublishedMethodology {
  return {
    valuationBundleId,
    modelVersion: 'fixture-model-2026.1',
    components: [
      {
        role: 'player_contribution_and_availability',
        modelVersion: 'fixture-player-1.0.0',
        summary: 'Fabricated player contribution component.',
      },
      {
        role: 'draft_pick_and_future_pick_distribution',
        modelVersion: 'fixture-pick-1.0.0',
        summary: 'Fabricated draft-pick distribution component.',
      },
    ],
    valueUnit: {
      id: valueUnitId,
      label: 'Fixture football value',
      description: 'A fabricated source-native AFL football contribution unit.',
      direction: 'higher_is_better',
    },
    primaryOutcome: {
      code: 'fixture-club-contribution',
      label: 'Fixture club contribution',
      definition: 'Fabricated definition used only for projection set tests.',
    },
    trainingPeriod: { firstSeason: 2001, lastSeason: 2024 },
    calculationAsOf,
    supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
    supportedDataCoverage: ['Fabricated resolved AFL trade assets'],
    knownLimitations: ['Fabricated limitation used only for contract testing.'],
    materialChangesFromPrevious: [],
  };
}

function materializationBindingFor(result: AflTradeProjectionMaterializationResult) {
  const root = result.projectionMaterialization;
  const content = root.content;
  return aflTradeProjectionMaterializationBindingSchema.parse({
    schemaVersion: content.schemaVersion,
    projectionMaterializationId: root.projectionMaterializationId,
    artifactRef: result.projectionMaterializationArtifactRef,
    publicationId: content.publication.publicationId,
    valuationOutputInventoryIndexId:
      content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    projectionPublicEvidenceIndexId:
      content.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
    projectionPresentationPolicyId:
      content.projectionPresentationPolicy.projectionPresentationPolicyId,
    projectionSchemaBundleId: content.projectionSchemaBundle.projectionSchemaBundleId,
    scopeKey: content.scopeKey,
    valueUnitId: content.valueUnitId,
    calculationAsOf: content.calculationAsOf,
    knowledgeCutoffAt: content.knowledgeCutoffAt,
    tradeCount: content.tradeCount,
    documentCount: content.documentCount,
    evidenceTradeSetSha256: content.evidenceTradeSetSha256,
    entrySetSha256: content.entrySetSha256,
    shardSetSha256: content.shardSetSha256,
  });
}

function documentArtifact(
  content: AflTradeProjectionDocumentContent,
  materializedAt = DOCUMENT_AT
) {
  return createAflTradeProjectionDocumentArtifact({ content, materializedAt });
}

function createFixtureInput(options: { substituteMethodologyArtifact?: boolean } = {}) {
  const aggregate = buildAggregatePipeline(options);
  const materialization = materializationBindingFor(aggregate.rootOutput);
  if (
    aggregate.methodologyPayload.calculationAsOf !== materialization.calculationAsOf ||
    aggregate.methodologyPayload.valueUnit.id !== materialization.valueUnitId
  ) {
    throw new Error('Published methodology does not match materialization time and value unit.');
  }
  const methodologyDocument = documentArtifact(
    {
      schemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
      publicationId: aggregate.publicationManifest.publicationId,
      valuationBundleId: aggregate.publicationManifest.content.valuationBundleId,
      valuationOutputInventoryIndexId:
        aggregate.inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      scopeKey: materialization.scopeKey,
      valueUnitId: materialization.valueUnitId,
      calculationAsOf: materialization.calculationAsOf,
      knowledgeCutoffAt: materialization.knowledgeCutoffAt,
      kind: 'methodology',
      methodology: aggregate.methodologyPayload,
      projectionMaterialization: materialization,
    },
    METHODOLOGY_AT
  );
  const projectionDocuments = [...aggregate.tradeOutput.projectionDocuments, methodologyDocument];
  const input = {
    publicationManifest: aggregate.publicationManifest,
    valuationOutputInventoryIndex: aggregate.inventoryIndex.valuationOutputInventoryIndex,
    valuationOutputInventoryIndexArtifactRef:
      aggregate.inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    projectionMaterializationVerification: aggregate.projectionMaterializationVerification,
    projectionDocuments,
    materializedAt: SET_AT,
  };
  return {
    input,
    tradeIds: [aggregate.fixture.valuationCase.content.tradeId],
    aggregate,
    methodologyDocument,
  };
}

function createFixture() {
  const fixture = createFixtureInput();
  return { ...fixture, output: createAflTradeProjectionDocumentSet(fixture.input) };
}

function expectSetError(
  action: () => unknown,
  code: AflTradeProjectionDocumentSetConstructionErrorCode
): AflTradeProjectionDocumentSetConstructionError {
  try {
    action();
  } catch (error) {
    expect(isAflTradeProjectionDocumentSetConstructionError(error)).toBe(true);
    expect(error).toBeInstanceOf(AflTradeProjectionDocumentSetConstructionError);
    expect((error as AflTradeProjectionDocumentSetConstructionError).code).toBe(code);
    return error as AflTradeProjectionDocumentSetConstructionError;
  }
  throw new Error(`Expected projection document set error ${code}.`);
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child, seen);
}

function canonicalByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value)).byteLength;
}

describe('AFL trade-intelligence projection document set', () => {
  it('creates deterministic shards, compact root, and authentic artifact references', () => {
    const fixture = createFixture();
    const replay = createAflTradeProjectionDocumentSet({
      ...fixture.input,
      projectionDocuments: [...fixture.input.projectionDocuments].reverse(),
    });
    const { output } = fixture;
    const root = output.projectionDocumentSet.content;

    expect(replay).toEqual(output);
    expect(root).toMatchObject({
      publicAssetBoundary: AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY,
      ordering: AFL_TRADE_PROJECTION_DOCUMENT_SET_ORDERING,
      tradeCount: 1,
      documentCount: 14,
      kindCounts: {
        tradeSummary: 4,
        tradeDetail: 1,
        methodology: 1,
        valuationExportRow: 8,
      },
    });
    expect(root.orderedMembershipSha256).toBe(
      sha256AflTradeCanonicalJson(
        output.projectionDocumentShards.flatMap(
          (shard) => shard.projectionDocumentSetShard.content.bindings
        )
      )
    );
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        output.projectionDocumentSetArtifactRef,
        output.projectionDocumentSet
      )
    ).toBe(true);
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        fixture.input.publicationManifest.content.methodologyArtifact,
        fixture.methodologyDocument.projectionDocument.content.kind === 'methodology'
          ? fixture.methodologyDocument.projectionDocument.content.methodology
          : null
      )
    ).toBe(true);
    for (const shard of output.projectionDocumentShards) {
      expect(
        doesAflTradeArtifactRefMatchCanonicalJson(
          shard.projectionDocumentSetShardArtifactRef,
          shard.projectionDocumentSetShard
        )
      ).toBe(true);
    }
    expectDeepFrozen(output);
  });

  it('covers exact index trades with four summaries, one detail, exact exports, and one methodology', () => {
    const { output, tradeIds } = createFixture();
    const bindings = output.projectionDocumentShards.flatMap(
      (shard) => shard.projectionDocumentSetShard.content.bindings
    );

    expect(
      new Set(bindings.flatMap((binding) => (binding.tradeId ? [binding.tradeId] : [])))
    ).toEqual(new Set(tradeIds));
    for (const tradeId of tradeIds) {
      expect(
        bindings
          .filter((binding) => binding.kind === 'trade_summary' && binding.tradeId === tradeId)
          .map((binding) => binding.view)
      ).toEqual(AFL_TRADE_VALUATION_VIEWS);
      expect(
        bindings.filter((binding) => binding.kind === 'trade_detail' && binding.tradeId === tradeId)
      ).toHaveLength(1);
    }
    expect(bindings.filter((binding) => binding.kind === 'methodology')).toHaveLength(1);
    const exportRows = bindings.filter(
      (binding) => binding.kind === 'valuation_export_row' && binding.tradeId === tradeIds[0]
    );
    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      expect(exportRows.filter((row) => row.view === view).map((row) => row.rowOrdinal)).toEqual([
        0, 1,
      ]);
    }
  });

  it('rejects missing, unknown, and duplicated trade document membership', () => {
    const fixture = createFixture();
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.slice(1),
        }),
      'INVALID_PROJECTION_DOCUMENT_BINDINGS'
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document, index) =>
            index === fixture.input.projectionDocuments.length - 1
              ? fixture.input.projectionDocuments[0]
              : document
          ),
        }),
      'DUPLICATE_DOCUMENT_ID'
    );
    const summary = fixture.input.projectionDocuments.find(
      (document) => document.projectionDocument.content.kind === 'trade_summary'
    );
    if (!summary || summary.projectionDocument.content.kind !== 'trade_summary')
      throw new Error('Missing summary fixture.');
    const unknown = documentArtifact(
      {
        ...summary.projectionDocument.content,
        tradeId: 'trade:unknown',
      },
      summary.projectionDocumentArtifactRef.createdAt
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === summary ? unknown : document
          ),
        }),
      'DOCUMENT_MEMBERSHIP_MISMATCH'
    );
  });

  it('rejects document identity, time, index-reference, and export-value tampering', () => {
    const fixture = createFixture();
    const badRef = structuredClone(fixture.input.valuationOutputInventoryIndexArtifactRef);
    badRef.byteLength += 1;
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          valuationOutputInventoryIndexArtifactRef: badRef,
        }),
      'INVENTORY_INDEX_ARTIFACT_REFERENCE_MISMATCH'
    );
    const source = fixture.input.projectionDocuments.find(
      (document) => document.projectionDocument.content.kind === 'trade_summary'
    );
    if (!source || source.projectionDocument.content.kind !== 'trade_summary')
      throw new Error('Missing summary fixture.');
    const wrongScope = documentArtifact(
      {
        ...source.projectionDocument.content,
        scopeKey: 'wrong-scope',
      },
      source.projectionDocumentArtifactRef.createdAt
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === source ? wrongScope : document
          ),
        }),
      'DOCUMENT_IDENTITY_MISMATCH'
    );
    const wrongTime = documentArtifact(
      {
        ...source.projectionDocument.content,
        calculationAsOf: new Date(
          Date.parse(source.projectionDocument.content.calculationAsOf) + 1
        ).toISOString(),
      },
      source.projectionDocumentArtifactRef.createdAt
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === source ? wrongTime : document
          ),
        }),
      'DOCUMENT_TIME_MISMATCH'
    );
    const exportSource = fixture.input.projectionDocuments.find(
      (document) => document.projectionDocument.content.kind === 'valuation_export_row'
    );
    if (!exportSource || exportSource.projectionDocument.content.kind !== 'valuation_export_row')
      throw new Error('Missing export fixture.');
    const exportContent = structuredClone(exportSource.projectionDocument.content);
    if (!('clubValues' in exportContent.exportRow.valuation))
      throw new Error('Expected available export valuation fixture.');
    const exportedClub = exportContent.exportRow.valuation.clubValues[0];
    exportedClub.clubName = `${exportedClub.clubName} forged`;
    if (exportContent.exportRow.rowOrdinal === 0) {
      exportContent.exportRow.clubValue = structuredClone(exportedClub);
    }
    const wrongExport = documentArtifact(
      exportContent,
      exportSource.projectionDocumentArtifactRef.createdAt
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === exportSource ? wrongExport : document
          ),
        }),
      'EXPORT_ROW_MISMATCH'
    );
  });

  it('rejects substituted publication methodology references and re-addressed payloads', () => {
    const substitutedReferenceFixture = createFixtureInput({
      substituteMethodologyArtifact: true,
    });
    expectSetError(
      () => createAflTradeProjectionDocumentSet(substitutedReferenceFixture.input),
      'METHODOLOGY_PUBLICATION_ARTIFACT_MISMATCH'
    );

    const fixture = createFixture();
    const substitutedContent = structuredClone(
      fixture.methodologyDocument.projectionDocument.content
    );
    if (substitutedContent.kind !== 'methodology') throw new Error('Missing methodology fixture.');
    substitutedContent.methodology.modelVersion = 'fixture-model-2026.2-readdressed';
    const substitutedDocument = documentArtifact(substitutedContent, METHODOLOGY_AT);
    expect(substitutedDocument.projectionDocument.projectionDocumentId).not.toBe(
      fixture.methodologyDocument.projectionDocument.projectionDocumentId
    );
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        substitutedDocument.projectionDocumentArtifactRef,
        substitutedDocument.projectionDocument
      )
    ).toBe(true);
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === fixture.methodologyDocument ? substitutedDocument : document
          ),
        }),
      'METHODOLOGY_PUBLICATION_ARTIFACT_MISMATCH'
    );
  });

  it('preserves the exact 2,048-binding shard boundary analytically', () => {
    const documentCount = AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD + 5;
    const shardCount = Math.ceil(
      documentCount / AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD
    );
    const shardSizes = Array.from({ length: shardCount }, (_, ordinal) =>
      Math.min(
        AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD,
        documentCount - ordinal * AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD
      )
    );

    expect(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD).toBe(2_048);
    expect(shardCount).toBe(2);
    expect(shardSizes).toEqual([2_048, 5]);
    expect(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_SHARD_BYTES).toBeGreaterThan(0);
  });

  it('proves the configured maximum root shard count remains feasible analytically', () => {
    const maximumShardCount = Math.ceil(
      AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS /
        AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD
    );
    const { output } = createFixture();
    const root = structuredClone(output.projectionDocumentSet);
    const representative = root.content.shards[0];
    const fixedRootBytes = canonicalByteLength({
      ...root,
      content: { ...root.content, shards: [] },
    });
    const conservativeBindingBytes = canonicalByteLength(representative) + 64;

    expect(maximumShardCount).toBe(376);
    expect(
      fixedRootBytes + maximumShardCount * conservativeBindingBytes + maximumShardCount
    ).toBeLessThan(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES);
  });

  it('binds every public identity, time, count, digest, and detached reference', () => {
    const fixture = createFixture();
    const root = fixture.output.projectionDocumentSet.content;
    const publication = fixture.input.publicationManifest;
    const index = fixture.input.valuationOutputInventoryIndex;
    const materialization = materializationBindingFor(fixture.aggregate.rootOutput);

    expect(root).toMatchObject({
      publicationId: publication.publicationId,
      valuationBundleId: publication.content.valuationBundleId,
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
      calculationAsOf: materialization.calculationAsOf,
      knowledgeCutoffAt: materialization.knowledgeCutoffAt,
      materializedAt: SET_AT,
      projectionMaterialization: materialization,
      valuationOutputInventoryIndex: {
        valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
        artifactRef: fixture.input.valuationOutputInventoryIndexArtifactRef,
        entryCount: index.content.entryCount,
        inventorySetSha256: index.content.inventorySetSha256,
      },
    });
    expect(root.shardCount).toBe(root.shards.length);
    expect(root.documentCount).toBe(
      root.shards.reduce((sum, shard) => sum + shard.documentCount, 0)
    );
    expect(root.documentCount).toBe(materialization.documentCount + 1);
    for (const [ordinal, shard] of fixture.output.projectionDocumentShards.entries()) {
      expect(shard.projectionDocumentSetShard.content).toMatchObject({
        shardOrdinal: ordinal,
        publicationId: root.publicationId,
        valuationBundleId: root.valuationBundleId,
        valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
        scopeKey: root.scopeKey,
        valueUnitId: root.valueUnitId,
        calculationAsOf: root.calculationAsOf,
        knowledgeCutoffAt: root.knowledgeCutoffAt,
        materializedAt: root.materializedAt,
        projectionMaterialization: materialization,
      });
    }
  });

  it('declares no predecessor, latest alias, runtime fallback, fantasy ownership, or serving authority', () => {
    const { output } = createFixture();
    const root = output.projectionDocumentSet.content;
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        visit(child);
      }
    };
    visit(output);

    expect(root.predecessorPolicy).toEqual({
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_DOCUMENT_SET_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_DOCUMENT_SET_RUNTIME_FALLBACK,
      publicationAuthority: AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLICATION_AUTHORITY,
    });
    expect(root.publicAssetBoundary).toBe(AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY);
    for (const key of [
      'userId',
      'ownerId',
      'ownership',
      'fantasyLeagueId',
      'leagueId',
      'rosterId',
    ]) {
      expect(keys.has(key)).toBe(false);
    }
  });

  it('requires exact data-property envelopes without invoking accessors', () => {
    const fixture = createFixture();
    expectSetError(
      () => createAflTradeProjectionDocumentSet({ ...fixture.input, extra: true }),
      'INVALID_INPUT_ENVELOPE'
    );
    const reads = new Map<string, number>();
    const envelope = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(fixture.input)) {
      Object.defineProperty(envelope, key, {
        enumerable: true,
        get() {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }
    expectSetError(() => createAflTradeProjectionDocumentSet(envelope), 'INVALID_INPUT_ENVELOPE');
    expect([...reads.values()]).toEqual([]);
  });

  it('contains hostile getters, proxies, and revoked inputs behind stable trusted errors', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('hostile');
        },
      }
    );
    expectSetError(() => createAflTradeProjectionDocumentSet(hostile), 'INVALID_INPUT_ENVELOPE');
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectSetError(
      () => createAflTradeProjectionDocumentSet(revoked.proxy),
      'INVALID_INPUT_ENVELOPE'
    );
    const fixture = createFixture();
    const nested = new Proxy([], {
      get: () => {
        throw new Error('nested hostile');
      },
    });
    expectSetError(
      () => createAflTradeProjectionDocumentSet({ ...fixture.input, projectionDocuments: nested }),
      'INVALID_PROJECTION_DOCUMENT_BINDINGS'
    );
    const trusted = expectSetError(
      () => createAflTradeProjectionDocumentSet(null),
      'INVALID_INPUT_ENVELOPE'
    );
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(isAflTradeProjectionDocumentSetConstructionError({ ...trusted })).toBe(false);
  });

  it('rejects forged aggregate replay, count, and digest outputs before document-set trust', () => {
    const fixture = createFixture();
    const forgedReplay = structuredClone(fixture.input.projectionMaterializationVerification);
    forgedReplay.projectionMaterializationShardVerifications[0].output.projectionMaterializationShard.content.entries[0].documents[0].artifactRef.byteLength += 1;
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionMaterializationVerification: forgedReplay,
        }),
      'INVALID_PROJECTION_MATERIALIZATION'
    );

    const forgedCount = structuredClone(fixture.input.projectionMaterializationVerification);
    forgedCount.output.projectionMaterialization.content.documentCount += 1;
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionMaterializationVerification: forgedCount,
        }),
      'INVALID_PROJECTION_MATERIALIZATION'
    );

    const forgedDigest = structuredClone(fixture.input.projectionMaterializationVerification);
    forgedDigest.output.projectionMaterialization.content.entrySetSha256 = '0'.repeat(64);
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionMaterializationVerification: forgedDigest,
        }),
      'INVALID_PROJECTION_MATERIALIZATION'
    );
  });

  it('rejects extra and substituted documents against the verified aggregate membership', () => {
    const fixture = createFixture();
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: [
            ...fixture.input.projectionDocuments,
            fixture.input.projectionDocuments[0],
          ],
        }),
      'INVALID_PROJECTION_DOCUMENT_BINDINGS'
    );

    const source = fixture.input.projectionDocuments.find(
      (document) => document.projectionDocument.content.kind === 'trade_detail'
    );
    if (!source) throw new Error('Missing detail fixture.');
    const substituted = documentArtifact(
      source.projectionDocument.content,
      '2026-08-05T07:00:01.000Z'
    );
    expect(substituted.projectionDocument.projectionDocumentId).toBe(
      source.projectionDocument.projectionDocumentId
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === source ? substituted : document
          ),
        }),
      'PROJECTION_MATERIALIZATION_MISMATCH'
    );
  });

  it('rejects methodology binding drift and non-monotonic aggregate or document chronology', () => {
    const fixture = createFixture();
    const methodologyContent = structuredClone(
      fixture.methodologyDocument.projectionDocument.content
    );
    if (methodologyContent.kind !== 'methodology') throw new Error('Missing methodology fixture.');
    methodologyContent.projectionMaterialization.entrySetSha256 = '0'.repeat(64);
    const driftedMethodology = documentArtifact(methodologyContent, METHODOLOGY_AT);
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === fixture.methodologyDocument ? driftedMethodology : document
          ),
        }),
      'PROJECTION_MATERIALIZATION_MISMATCH'
    );

    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          materializedAt: MATERIALIZATION_SHARD_AT,
        }),
      'PROJECTION_MATERIALIZATION_MISMATCH'
    );

    const lateMethodology = documentArtifact(
      fixture.methodologyDocument.projectionDocument.content,
      '2026-08-05T08:00:01.000Z'
    );
    expectSetError(
      () =>
        createAflTradeProjectionDocumentSet({
          ...fixture.input,
          projectionDocuments: fixture.input.projectionDocuments.map((document) =>
            document === fixture.methodologyDocument ? lateMethodology : document
          ),
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
  });

  it('replays without side effects and rejects root, shard, membership, and reference tampering', () => {
    const fixture = createFixture();
    const verification = { ...fixture.input, output: fixture.output };
    expect(verifyAflTradeProjectionDocumentSet(verification)).toBe(true);

    const tamperedRoot = structuredClone(fixture.output);
    tamperedRoot.projectionDocumentSet.content.documentCount += 1;
    expect(verifyAflTradeProjectionDocumentSet({ ...verification, output: tamperedRoot })).toBe(
      false
    );
    const tamperedShard = structuredClone(fixture.output);
    tamperedShard.projectionDocumentShards[0].projectionDocumentSetShard.content.bindings[0].tradeId =
      'trade:tampered';
    expect(verifyAflTradeProjectionDocumentSet({ ...verification, output: tamperedShard })).toBe(
      false
    );
    const tamperedRef = structuredClone(fixture.output);
    tamperedRef.projectionDocumentSetArtifactRef.byteLength += 1;
    expect(verifyAflTradeProjectionDocumentSet({ ...verification, output: tamperedRef })).toBe(
      false
    );
    expect(verifyAflTradeProjectionDocumentSet({ ...verification, extra: true })).toBe(false);
  });
});
