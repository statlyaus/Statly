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
import {
  createAflTradeValuationOutputInventoryIndex,
  type AflTradeValuationOutputInventoryIndexResult,
} from '@/server/aflTradeIntelligence/artifacts/valuationOutputInventoryIndex';
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
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  aflTradeProjectionPublicEvidenceContentSchema,
  createAflTradeProjectionPublicEvidence,
  type AflTradeProjectionPublicEvidenceContent,
  type AflTradeProjectionPublicEvidenceResult,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidence';
import { createAflTradeProjectionPresentationPolicy } from '@/server/aflTradeIntelligence/publication/projectionPresentationPolicy';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ARTIFACT_BYTES,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_CANONICAL_ENTRIES_BYTES,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_TOTAL_EVIDENCE_BYTES,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION,
  AflTradeProjectionPublicEvidenceIndexConstructionError,
  aflTradeProjectionPublicEvidenceIndexContentSchema,
  aflTradeProjectionPublicEvidenceIndexEntrySchema,
  aflTradeProjectionPublicEvidenceIndexResultSchema,
  createAflTradeProjectionPublicEvidenceIndex,
  isAflTradeProjectionPublicEvidenceIndexConstructionError,
  verifyAflTradeProjectionPublicEvidenceIndex,
  type AflTradeProjectionPublicEvidenceIndexConstructionErrorCode,
  type AflTradeProjectionPublicEvidenceIndexContent,
  type AflTradeProjectionPublicEvidenceIndexResult,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidenceIndex';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LIMITATION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_CLUB_UTILITY_COVERAGE,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_DISTRIBUTION_COVERAGE,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_VERIFICATION_SCOPE,
  aflTradeValuationOutputInventorySchema,
  type AflTradeValuationOutputInventory,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputInventory';
import {
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_VALUATION_VIEWS,
  type AflTradeTemporalContext,
} from '@/types/aflTradeIntelligence';

const BUNDLE_CREATED_AT = '2026-08-05T01:00:00.000Z';
const BUNDLE_REF_CREATED_AT = '2026-08-05T01:10:00.000Z';
const INVENTORY_SOURCE_CREATED_AT = '2026-08-05T01:20:00.000Z';
const INVENTORY_MATERIALIZED_AT = '2026-08-05T02:00:00.000Z';
const INVENTORY_INDEX_CREATED_AT = '2026-08-05T03:00:00.000Z';
const PUBLICATION_BUNDLE_CREATED_AT = '2026-08-05T03:30:00.000Z';
const PUBLICATION_CREATED_AT = '2026-08-05T04:00:00.000Z';
const EVIDENCE_MATERIALIZED_AT = '2026-08-05T05:00:00.000Z';
const EVIDENCE_INDEX_MATERIALIZED_AT = '2026-08-05T06:00:00.000Z';
const HISTORICAL_EFFECTIVE_AT = '2020-11-12T00:00:00.000Z';
const HISTORICAL_KNOWLEDGE_AT = '2020-11-11T23:59:59.000Z';
const HISTORICAL_SOURCE_AT = '2020-11-10T00:00:00.000Z';
const CURRENT_AS_OF = '2026-01-01T00:00:00.000Z';
const TRADE_ID = 'trade:fixture-public-evidence-index';
const VALUE_UNIT_ID = 'fixture-football-value-v1';
const SCOPE_KEY = 'fixture-public-evidence-index';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

type SourceRole = 'confidence' | 'coverage' | 'asset_identity' | 'lineage_frontier' | 'factor';

function semanticId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function artifact(label: string, createdAt: string) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
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

function createBundle(): AflTradeValuationBundleManifestV2 {
  const contract = inventoryContractPayload();
  const currentContext = {
    modelVintage: 'current' as const,
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  };
  const sourceArtifact = (label: string) => artifact(label, BUNDLE_CREATED_AT);
  const content = {
    schemaVersion: 'afl-trade-valuation-bundle/v2' as const,
    environment: 'non_production' as const,
    scopeKey: SCOPE_KEY,
    valueUnitId: VALUE_UNIT_ID,
    createdAt: BUNDLE_CREATED_AT,
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
    viewContexts: [
      {
        view: 'at_trade' as const,
        modelVintage: 'historical_restatement' as const,
        effectiveAt: HISTORICAL_EFFECTIVE_AT,
        knowledgeCutoffAt: HISTORICAL_KNOWLEDGE_AT,
        valuationAsOf: HISTORICAL_EFFECTIVE_AT,
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
      listSpotPolicyArtifact: sourceArtifact('list-spot'),
      scarcityPolicyArtifact: sourceArtifact('scarcity'),
      roleCongestionPolicyArtifact: sourceArtifact('role-congestion'),
    },
    simulation: {
      draws: 2,
      seed: 20260805,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: sourceArtifact('low-return'),
      eliteOutcomeDefinitionArtifact: sourceArtifact('elite-outcome'),
      practicalEquivalenceDefinitionArtifact: sourceArtifact('practical-equivalence'),
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
      jobId: 'fixture-evidence-index-job',
      attempt: 1,
      initiatedBy: 'fixture-operator',
      workerIdentity: 'fixture-worker',
      startedAt: BUNDLE_CREATED_AT,
      finishedAt: BUNDLE_CREATED_AT,
      sourceCodeArtifact: sourceArtifact('source-code'),
      dependencyLockArtifact: sourceArtifact('dependency-lock'),
      runtimeArtifact: sourceArtifact('runtime'),
      configurationArtifact: sourceArtifact('configuration'),
    },
    outputs: {
      immutableSnapshotsArtifact: sourceArtifact('snapshots'),
      simulationDrawsArtifact: sourceArtifact('draws'),
      attributionInvariantReportArtifact: sourceArtifact('attribution'),
      deterministicReplayReportArtifact: sourceArtifact('replay'),
      explanationParityReportArtifact: sourceArtifact('explanation-parity'),
      coverageAndExclusionReportArtifact: sourceArtifact('coverage'),
      confidenceReportArtifact: sourceArtifact('confidence'),
      sensitivityReportArtifact: sourceArtifact('sensitivity'),
      validationReportArtifact: sourceArtifact('validation'),
      modelCardArtifact: sourceArtifact('model-card'),
    },
    outputInventoryContract: {
      ...contract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(contract, BUNDLE_CREATED_AT),
    },
    limitations: ['Focused source-independent public-evidence-index fixture.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

function outputSetPayload(content: AflTradeValuationOutputInventory['content']) {
  return {
    valuationCalculation: content.valuationCalculation,
    distributionShards: content.distributionShards,
    valuationComparisons: content.valuationComparisons,
    structuredExplanation: content.structuredExplanation,
  };
}

function createInventory(
  bundle: AflTradeValuationBundleManifestV2,
  bundleArtifactRef: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>
) {
  const valuationCalculation = {
    valuationCalculationId: semanticId('valuation-calculation', 'fixture-calculation'),
    artifactRef: artifact('calculation', INVENTORY_SOURCE_CREATED_AT),
  };
  const distributionShards = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    UNIVERSAL_LAYERS.map((layer) => {
      const label = `${view}:${layer}`;
      return {
        valuationOutputInventoryShardId: semanticId('valuation-output-inventory-shard', label),
        artifactRef: artifact(`${label}:shard`, INVENTORY_MATERIALIZED_AT),
        coordinate: { view, measure: { kind: 'universal_football_value' as const, layer } },
        distributionCount: 2,
        distributionSetSha256: sha256AflTradeCanonicalJson({ label, count: 2 }),
      };
    })
  );
  const valuationComparisons = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    UNIVERSAL_LAYERS.map((layer) => {
      const label = `${view}:${layer}`;
      return {
        view,
        measure: { kind: 'universal_football_value' as const, layer },
        valuationComparisonId: semanticId('valuation-comparison', label),
        artifactRef: artifact(`${label}:comparison`, INVENTORY_SOURCE_CREATED_AT),
      };
    })
  );
  const structuredExplanation = {
    structuredExplanationId: semanticId('structured-explanation', 'fixture-explanation'),
    artifactRef: artifact('explanation', INVENTORY_SOURCE_CREATED_AT),
  };
  const partialContent = {
    schemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
    inventoryContract: bundle.content.outputInventoryContract,
    bindingDirection: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_BINDING_DIRECTION,
    granularity: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_GRANULARITY,
    distributionPartitioning: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DISTRIBUTION_PARTITIONING,
    semanticBinding: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SEMANTIC_BINDING,
    publicationRequirement: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_REQUIREMENT,
    valuationBundle: {
      valuationBundleId: bundle.valuationBundleId,
      artifactRef: bundleArtifactRef,
    },
    valuationCase: {
      valuationCaseId: semanticId('valuation-case', 'fixture-case'),
      artifactRef: artifact('case', INVENTORY_SOURCE_CREATED_AT),
    },
    valuationCalculation,
    lineageGraphId: semanticId('lineage-graph', 'fixture-lineage'),
    componentDrawSetId: semanticId('component-draw-set', 'fixture-draws'),
    realizedContributionLedgerId: semanticId('realized-contribution-ledger', 'fixture-ledger'),
    packagePolicyId: semanticId('package-policy', 'fixture-package-policy'),
    tradeId: TRADE_ID,
    valueUnitId: VALUE_UNIT_ID,
    distributionCoverage: {
      required: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_DISTRIBUTION_COVERAGE,
      optionalClubUtility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_CLUB_UTILITY_COVERAGE,
    },
    distributionCount: 24,
    distributionShardCount: 12,
    distributionShardSetSha256: sha256AflTradeCanonicalJson(distributionShards),
    distributionShards,
    valuationComparisonCount: 12 as const,
    valuationComparisonSetSha256: sha256AflTradeCanonicalJson(valuationComparisons),
    valuationComparisons,
    structuredExplanation,
    verificationScope: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_VERIFICATION_SCOPE,
    predecessorPolicy: {
      definitionVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_POLICY_DEFINITION,
      valuationBundlePredecessorSchemaVersion: 'afl-trade-valuation-bundle/v1' as const,
      valuationSnapshotSetSchemaVersion: 'afl-trade-valuation-snapshot-set/v1' as const,
      structuredExplanationSchemaVersion: 'afl-trade-structured-explanation/v1' as const,
      compatibility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PREDECESSOR_COMPATIBILITY,
      upcastTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_UPCAST_TREATMENT,
      downcastTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_DOWNCAST_TREATMENT,
      runtimeFallback: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_RUNTIME_FALLBACK,
      publicationAuthority: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLICATION_AUTHORITY,
      legacyTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LEGACY_TREATMENT,
    },
    materializedAt: INVENTORY_MATERIALIZED_AT,
    limitation: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_LIMITATION,
  };
  const content = {
    ...partialContent,
    outputSetSha256: sha256AflTradeCanonicalJson(
      outputSetPayload(partialContent as AflTradeValuationOutputInventory['content'])
    ),
  };
  const valuationOutputInventory = aflTradeValuationOutputInventorySchema.parse({
    valuationOutputInventoryId: createAflTradeContentAddress('valuation-output-inventory', content),
    content,
  });
  return {
    valuationOutputInventory,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(
      valuationOutputInventory,
      INVENTORY_MATERIALIZED_AT
    ),
  };
}

function createPublication(
  bundle: AflTradeValuationBundleManifestV2,
  inventoryIndex: AflTradeValuationOutputInventoryIndexResult
) {
  const presentationPolicy = createAflTradeProjectionPresentationPolicy({
    valueUnit: {
      id: VALUE_UNIT_ID,
      label: 'Fixture football value',
      description: 'A governed source-native AFL football-contribution value unit.',
      direction: 'higher_is_better',
    },
    universalLayer: 'scarcity_adjusted',
    balancedMaximumLeaderMargin: 0.05,
    balancedMinimumPracticalEquivalenceProbability: 0.4,
    strongMinimumLeaderMargin: 0.2,
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
    createdAt: INVENTORY_INDEX_CREATED_AT,
  });
  const content = {
    schemaVersion: 'afl-trade-publication/v3' as const,
    environment: bundle.content.environment,
    scopeKey: SCOPE_KEY,
    createdAt: PUBLICATION_CREATED_AT,
    valuationBundleId: bundle.valuationBundleId,
    gate3DecisionId: bundle.content.components[0].gate3DecisionId,
    sourceRegisterIds: ['source-register:fixture'],
    supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
    supportedCohorts: ['cohort:fixture'],
    excludedCohorts: [],
    valueUnitId: VALUE_UNIT_ID,
    entryCount: 1,
    publicationBundleArtifact: artifact('publication-bundle', PUBLICATION_BUNDLE_CREATED_AT),
    methodologyArtifact: artifact('methodology', INVENTORY_SOURCE_CREATED_AT),
    validationReportArtifact: artifact('publication-validation', INVENTORY_INDEX_CREATED_AT),
    modelCardArtifact: artifact('publication-model-card', INVENTORY_INDEX_CREATED_AT),
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
      freshnessPolicyId: semanticId('freshness-policy', 'fixture-freshness'),
      artifactRef: artifact('freshness-policy', INVENTORY_INDEX_CREATED_AT),
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
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
  return {
    publicationManifest,
    publicationManifestArtifactRef: createAflTradeCanonicalJsonArtifactRef(
      publicationManifest,
      PUBLICATION_CREATED_AT
    ),
  };
}

const TEMPORAL_CONTEXTS: Readonly<Record<string, AflTradeTemporalContext>> = {
  at_trade: {
    effectiveAt: HISTORICAL_EFFECTIVE_AT,
    knowledgeCutoffAt: HISTORICAL_KNOWLEDGE_AT,
    valuationAsOf: HISTORICAL_EFFECTIVE_AT,
  },
  realized: {
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  },
  remaining: {
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  },
  current: {
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  },
};

function sourceBinding(sourceRole: SourceRole, label: string) {
  return {
    sourceRole,
    sourceSchemaVersion: 'afl-trade-source-fixture/v1',
    semanticArtifactId: semanticId('source-fixture', label),
    artifactRef: artifact(`source:${label}`, EVIDENCE_MATERIALIZED_AT),
    recordLocator: `records:${label}`,
    fieldPath: `/claims/${label}`,
    claimedValueSha256: sha256AflTradeCanonicalJson({ claim: label }),
    sourceEffectiveAt: HISTORICAL_SOURCE_AT,
    sourceKnownAt: HISTORICAL_SOURCE_AT,
  };
}

function createEvidenceContent(
  publication: AflTradePublicationManifestV3,
  inventoryIndex: AflTradeValuationOutputInventoryIndexResult,
  inventory: AflTradeValuationOutputInventory
): AflTradeProjectionPublicEvidenceContent {
  const viewContexts = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXTS[view],
  }));
  return aflTradeProjectionPublicEvidenceContentSchema.parse({
    schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
    publicationId: publication.publicationId,
    valuationBundleId: publication.content.valuationBundleId,
    valuationOutputInventoryIndexId:
      inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    valuationOutputInventoryId: inventory.valuationOutputInventoryId,
    valuationCaseId: inventory.content.valuationCase.valuationCaseId,
    valuationCalculationId: inventory.content.valuationCalculation.valuationCalculationId,
    tradeId: TRADE_ID,
    scopeKey: SCOPE_KEY,
    valueUnitId: VALUE_UNIT_ID,
    materializedAt: EVIDENCE_MATERIALIZED_AT,
    viewContexts,
    confidenceByView: AFL_TRADE_VALUATION_VIEWS.map((view) => ({
      view,
      temporalContext: TEMPORAL_CONTEXTS[view],
      overallLevel: 'moderate' as const,
      dimensions: AFL_TRADE_CONFIDENCE_DIMENSIONS.map((dimension, index) => ({
        dimension,
        level: index === 0 ? ('moderate' as const) : ('high' as const),
        reasonCode: `supported:${dimension}`,
        explanation: `The ${dimension} dimension has explicit immutable evidence.`,
        sourceBindings: [sourceBinding('confidence', `${view}:${dimension}`)],
      })),
    })),
    coverageByView: AFL_TRADE_VALUATION_VIEWS.map((view) => ({
      view,
      temporalContext: TEMPORAL_CONTEXTS[view],
      status: 'complete' as const,
      totalAssetCount: 1,
      valuedAssetCount: 1,
      excludedAssetCount: 0 as const,
      excludedRoots: [],
      sourceBindings: [sourceBinding('coverage', `${view}:coverage`)],
    })),
    assets: [
      {
        assetId: 'asset:fixture-player',
        assetKind: 'player',
        label: 'Fixture AFL player',
        receivedByAflClubId: 'afl-club:fixture',
        identitySourceBindings: [sourceBinding('asset_identity', 'fixture-player')],
        lineage: {
          status: 'resolved',
          rootAssetId: 'asset:fixture-player',
          creditedAssetIds: ['asset:fixture-player'],
          summary: 'The fixture player is credited once to its traded root.',
          edgeCount: 0,
          maximumDepth: 0,
          sourceBindings: [sourceBinding('lineage_frontier', 'fixture-player')],
        },
      },
    ],
    factorsByView: AFL_TRADE_VALUATION_VIEWS.map((view) => ({
      view,
      temporalContext: TEMPORAL_CONTEXTS[view],
      factors: [],
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

function createChain() {
  const bundle = createBundle();
  const valuationBundleArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    bundle,
    BUNDLE_REF_CREATED_AT
  );
  const inventory = createInventory(bundle, valuationBundleArtifactRef);
  const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
    valuationBundleManifest: bundle,
    valuationBundleArtifactRef,
    valuationOutputInventories: [inventory],
    createdAt: INVENTORY_INDEX_CREATED_AT,
  });
  const publication = createPublication(bundle, inventoryIndex);
  const evidence = createAflTradeProjectionPublicEvidence({
    content: createEvidenceContent(
      publication.publicationManifest,
      inventoryIndex,
      inventory.valuationOutputInventory
    ),
    materializedAt: EVIDENCE_MATERIALIZED_AT,
  });
  return { bundle, valuationBundleArtifactRef, inventory, inventoryIndex, publication, evidence };
}

function inputFor(chain = createChain()) {
  return {
    publicationManifest: chain.publication.publicationManifest,
    publicationManifestArtifactRef: chain.publication.publicationManifestArtifactRef,
    valuationOutputInventoryIndex: chain.inventoryIndex.valuationOutputInventoryIndex,
    valuationOutputInventoryIndexArtifactRef:
      chain.inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    valuationOutputInventories: [chain.inventory],
    projectionPublicEvidences: [
      {
        projectionPublicEvidence: chain.evidence.projectionPublicEvidence,
        projectionPublicEvidenceArtifactRef: chain.evidence.projectionPublicEvidenceArtifactRef,
      },
    ],
    materializedAt: EVIDENCE_INDEX_MATERIALIZED_AT,
  };
}

function verifyInput(
  input: ReturnType<typeof inputFor>,
  output: AflTradeProjectionPublicEvidenceIndexResult
) {
  const { materializedAt: _materializedAt, ...sources } = input;
  return { ...sources, output };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode
): AflTradeProjectionPublicEvidenceIndexConstructionError {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isAflTradeProjectionPublicEvidenceIndexConstructionError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return error as AflTradeProjectionPublicEvidenceIndexConstructionError;
  }
}

function readdressPublication(
  publication: AflTradePublicationManifestV3,
  mutate: (content: AflTradePublicationManifestV3['content']) => void
) {
  const content = structuredClone(publication.content);
  mutate(content);
  const publicationManifest = aflTradePublicationManifestV3Schema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
  return {
    publicationManifest,
    publicationManifestArtifactRef: createAflTradeCanonicalJsonArtifactRef(
      publicationManifest,
      PUBLICATION_CREATED_AT
    ),
  };
}

function readdressEvidence(
  evidence: AflTradeProjectionPublicEvidenceResult,
  mutate: (content: AflTradeProjectionPublicEvidenceContent) => void
) {
  const content = structuredClone(evidence.projectionPublicEvidence.content);
  mutate(content);
  return createAflTradeProjectionPublicEvidence({
    content,
    materializedAt: content.materializedAt,
  });
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((child) => isDeeplyFrozen(child, seen))
  );
}

function recalculateContent(content: AflTradeProjectionPublicEvidenceIndexContent): void {
  content.entryCount = content.entries.length;
  content.valuationOutputInventoryIndex.entryCount = content.entries.length;
  content.totalEvidenceArtifactByteLength = content.entries.reduce(
    (sum, entry) => sum + entry.evidenceArtifactRef.byteLength,
    0
  );
  content.canonicalEntriesByteLength = new TextEncoder().encode(
    canonicalizeAflTradeJson(content.entries)
  ).byteLength;
  content.evidenceBindingSetSha256 = sha256AflTradeCanonicalJson(content.entries);
}

describe('AFL trade projection public-evidence index', () => {
  it('constructs a real one-trade chain and authenticates exact parent and evidence membership', () => {
    const chain = createChain();
    const input = inputFor(chain);
    const output = createAflTradeProjectionPublicEvidenceIndex(input);
    const content = output.projectionPublicEvidenceIndex.content;

    expect(content.publication.publicationId).toBe(
      chain.publication.publicationManifest.publicationId
    );
    expect(content.valuationOutputInventoryIndex).toEqual(
      chain.publication.publicationManifest.content.valuationOutputInventoryIndex
    );
    expect(content.entries).toHaveLength(1);
    expect(content.entries[0]).toMatchObject({
      tradeId: TRADE_ID,
      valuationCaseId:
        chain.inventory.valuationOutputInventory.content.valuationCase.valuationCaseId,
      valuationCalculationId:
        chain.inventory.valuationOutputInventory.content.valuationCalculation
          .valuationCalculationId,
      valuationOutputInventoryId:
        chain.inventory.valuationOutputInventory.valuationOutputInventoryId,
      projectionPublicEvidenceId:
        chain.evidence.projectionPublicEvidence.projectionPublicEvidenceId,
    });
    expect(content.evidenceBindingSetSha256).toBe(sha256AflTradeCanonicalJson(content.entries));
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        output.projectionPublicEvidenceIndexArtifactRef,
        output.projectionPublicEvidenceIndex
      )
    ).toBe(true);
    expect(verifyAflTradeProjectionPublicEvidenceIndex(verifyInput(input, output))).toBe(true);
  });

  it('uses the approved schema, ordering, predecessor, cycle-safe binding, and limitation literals', () => {
    const content =
      createAflTradeProjectionPublicEvidenceIndex(inputFor()).projectionPublicEvidenceIndex.content;

    expect(content.schemaVersion).toBe(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION);
    expect(content.ordering).toBe(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING);
    expect(content.digestDefinition).toBe(
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION
    );
    expect(content.predecessorPolicy).toMatchObject({
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK,
      bindingAuthority: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING,
    });
    expect(content.limitation).toBe(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION);
    expect(content.limitation).toContain('user ownership');
    expect(content.publication).not.toHaveProperty('projectionPublicEvidenceIndexId');
  });

  it('canonicalizes caller array order and enforces canonical trade ordering analytically', () => {
    const output = createAflTradeProjectionPublicEvidenceIndex(inputFor());
    const content = structuredClone(output.projectionPublicEvidenceIndex.content);
    const second = structuredClone(content.entries[0]);
    second.tradeId = 'trade:zzzz';
    second.valuationCaseId = semanticId('valuation-case', 'second');
    second.valuationCalculationId = semanticId('valuation-calculation', 'second');
    second.valuationOutputInventoryId = semanticId('valuation-output-inventory', 'second');
    second.inventoryArtifactRef = artifact('second-inventory', INVENTORY_MATERIALIZED_AT);
    second.projectionPublicEvidenceId = semanticId('projection-public-evidence', 'second');
    second.evidenceArtifactRef = artifact('second-evidence', EVIDENCE_MATERIALIZED_AT);
    content.entries.push(second);
    recalculateContent(content);
    expect(aflTradeProjectionPublicEvidenceIndexContentSchema.safeParse(content).success).toBe(
      true
    );

    content.entries.reverse();
    recalculateContent(content);
    expect(aflTradeProjectionPublicEvidenceIndexContentSchema.safeParse(content).success).toBe(
      false
    );
  });

  it('rejects unauthenticated publication bytes and a re-addressed publication/index mismatch', () => {
    const input = inputFor();
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          publicationManifestArtifactRef: artifact('not-publication', PUBLICATION_CREATED_AT),
        }),
      'INVALID_PUBLICATION_ARTIFACT_REFERENCE'
    );

    const drifted = readdressPublication(input.publicationManifest, (content) => {
      content.valuationOutputInventoryIndex.inventorySetSha256 = 'f'.repeat(64);
    });
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidenceIndex({ ...input, ...drifted }),
      'PUBLICATION_INDEX_BINDING_MISMATCH'
    );
  });

  it('rejects inventory-index bytes, missing roots, and inventory-root byte substitution', () => {
    const input = inputFor();
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          valuationOutputInventoryIndexArtifactRef: artifact(
            'not-inventory-index',
            INVENTORY_INDEX_CREATED_AT
          ),
        }),
      'INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          valuationOutputInventories: [],
        }),
      'INVALID_INVENTORY_BINDINGS'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          valuationOutputInventories: [
            {
              ...input.valuationOutputInventories[0],
              artifactRef: artifact('wrong-root', INVENTORY_MATERIALIZED_AT),
            },
          ],
        }),
      'ARTIFACT_REFERENCE_MISMATCH'
    );
  });

  it('rejects missing, duplicated, or byte-substituted evidence membership', () => {
    const input = inputFor();
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          projectionPublicEvidences: [],
        }),
      'INVALID_EVIDENCE_BINDINGS'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          projectionPublicEvidences: [
            ...input.projectionPublicEvidences,
            ...input.projectionPublicEvidences,
          ],
        }),
      'EVIDENCE_MEMBERSHIP_MISMATCH'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          projectionPublicEvidences: [
            {
              ...input.projectionPublicEvidences[0],
              projectionPublicEvidenceArtifactRef: artifact(
                'wrong-evidence',
                EVIDENCE_MATERIALIZED_AT
              ),
            },
          ],
        }),
      'INVALID_EVIDENCE_BINDINGS'
    );
  });

  it('rejects publication, bundle, index, inventory, case, calculation, and trade identity drift', () => {
    const chain = createChain();
    for (const mutate of [
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.publicationId = semanticId('publication', 'wrong');
      },
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.valuationBundleId = semanticId('valuation-bundle', 'wrong');
      },
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.valuationOutputInventoryIndexId = semanticId(
          'valuation-output-inventory-index',
          'wrong'
        );
      },
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.valuationOutputInventoryId = semanticId('valuation-output-inventory', 'wrong');
      },
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.valuationCaseId = semanticId('valuation-case', 'wrong');
      },
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.valuationCalculationId = semanticId('valuation-calculation', 'wrong');
      },
      (content: AflTradeProjectionPublicEvidenceContent) => {
        content.tradeId = 'trade:wrong';
      },
    ]) {
      const evidence = readdressEvidence(chain.evidence, mutate);
      const input = inputFor({ ...chain, evidence });
      expectConstructionError(
        () => createAflTradeProjectionPublicEvidenceIndex(input),
        contentTradeId(evidence) === TRADE_ID ? 'IDENTITY_MISMATCH' : 'EVIDENCE_MEMBERSHIP_MISMATCH'
      );
    }
  });

  it('rejects public-boundary, scope, and value-unit drift', () => {
    const chain = createChain();
    const cases: Array<{
      mutate: (content: AflTradeProjectionPublicEvidenceContent) => void;
      code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode;
    }> = [
      {
        mutate: (content) => {
          content.publicAssetBoundary = 'wrong-boundary' as never;
        },
        code: 'INVALID_EVIDENCE_BINDINGS',
      },
      {
        mutate: (content) => {
          content.scopeKey = 'scope:wrong';
        },
        code: 'SCOPE_MISMATCH',
      },
      {
        mutate: (content) => {
          content.valueUnitId = 'value-unit:wrong';
        },
        code: 'VALUE_UNIT_MISMATCH',
      },
    ];
    for (const { mutate, code } of cases) {
      if (code === 'INVALID_EVIDENCE_BINDINGS') {
        const raw = structuredClone(chain.evidence.projectionPublicEvidence);
        mutate(raw.content);
        expectConstructionError(
          () =>
            createAflTradeProjectionPublicEvidenceIndex({
              ...inputFor(chain),
              projectionPublicEvidences: [
                {
                  projectionPublicEvidence: raw,
                  projectionPublicEvidenceArtifactRef: createAflTradeCanonicalJsonArtifactRef(
                    raw,
                    EVIDENCE_MATERIALIZED_AT
                  ),
                },
              ],
            }),
          code
        );
      } else {
        const evidence = readdressEvidence(chain.evidence, mutate);
        expectConstructionError(
          () => createAflTradeProjectionPublicEvidenceIndex(inputFor({ ...chain, evidence })),
          code
        );
      }
    }
  });

  it('enforces publication/index/root before evidence and evidence before index chronology', () => {
    const input = inputFor();
    const latePublicationRef = createAflTradeCanonicalJsonArtifactRef(
      input.publicationManifest,
      '2026-08-05T05:00:00.001Z'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          publicationManifestArtifactRef: latePublicationRef,
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          materializedAt: '2026-08-05T04:59:59.999Z',
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );

    const content = structuredClone(
      createAflTradeProjectionPublicEvidenceIndex(input).projectionPublicEvidenceIndex.content
    );
    content.entries[0].inventoryArtifactRef.createdAt = '2026-08-05T05:00:00.001Z';
    recalculateContent(content);
    expect(aflTradeProjectionPublicEvidenceIndexContentSchema.safeParse(content).success).toBe(
      false
    );
  });

  it('rejects count, byte-total, canonical-byte, digest, and duplicate-identity drift', () => {
    const base =
      createAflTradeProjectionPublicEvidenceIndex(inputFor()).projectionPublicEvidenceIndex.content;
    const mutations: Array<(content: AflTradeProjectionPublicEvidenceIndexContent) => void> = [
      (content) => {
        content.entryCount += 1;
      },
      (content) => {
        content.totalEvidenceArtifactByteLength += 1;
      },
      (content) => {
        content.canonicalEntriesByteLength += 1;
      },
      (content) => {
        content.evidenceBindingSetSha256 = 'f'.repeat(64);
      },
      (content) => {
        content.entries.push(structuredClone(content.entries[0]));
        recalculateContent(content);
      },
    ];
    for (const mutate of mutations) {
      const content = structuredClone(base);
      mutate(content);
      expect(aflTradeProjectionPublicEvidenceIndexContentSchema.safeParse(content).success).toBe(
        false
      );
    }
  });

  it('enforces bounded unsharded maxima without allocating aggregate evidence bodies', () => {
    expect(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES).toBe(10_000);
    expect(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_CANONICAL_ENTRIES_BYTES).toBe(
      16 * 1024 * 1024
    );
    expect(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ARTIFACT_BYTES).toBe(20 * 1024 * 1024);
    expect(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_TOTAL_EVIDENCE_BYTES).toBe(
      10_000 * 1024 * 1024
    );
    expect(
      Number.isSafeInteger(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_TOTAL_EVIDENCE_BYTES)
    ).toBe(true);

    const entry = structuredClone(
      createAflTradeProjectionPublicEvidenceIndex(inputFor()).projectionPublicEvidenceIndex.content
        .entries[0]
    );
    entry.evidenceArtifactRef.byteLength = 1024 * 1024 + 1;
    expect(aflTradeProjectionPublicEvidenceIndexEntrySchema.safeParse(entry).success).toBe(false);

    const content = structuredClone(
      createAflTradeProjectionPublicEvidenceIndex(inputFor()).projectionPublicEvidenceIndex.content
    );
    content.canonicalEntriesByteLength =
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_CANONICAL_ENTRIES_BYTES + 1;
    expect(aflTradeProjectionPublicEvidenceIndexContentSchema.safeParse(content).success).toBe(
      false
    );
  });

  it('deep-freezes cloned output and does not alias caller arrays', () => {
    const input = inputFor();
    const output = createAflTradeProjectionPublicEvidenceIndex(input);
    const snapshot = canonicalizeAflTradeJson(output);

    input.valuationOutputInventories.reverse();
    input.projectionPublicEvidences.reverse();
    input.publicationManifest.content.sourceRegisterIds.push('source-register:caller-mutation');

    expect(isDeeplyFrozen(output)).toBe(true);
    expect(canonicalizeAflTradeJson(output)).toBe(snapshot);
  });

  it('uses exact hostile-safe creator fields and trusts only branded construction errors', () => {
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex(
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('hostile-own-keys');
              },
            }
          )
        ),
      'INVALID_INPUT_ENVELOPE'
    );

    const input = inputFor();
    const reads = new Map<string, number>();
    const exact = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          {
            enumerable: true,
            get() {
              reads.set(key, (reads.get(key) ?? 0) + 1);
              return value;
            },
          },
        ])
      )
    );
    createAflTradeProjectionPublicEvidenceIndex(exact);
    expect([...reads.values()]).toEqual(Array.from({ length: 7 }, () => 1));

    const trusted = new AflTradeProjectionPublicEvidenceIndexConstructionError(
      'INVALID_INPUT_ENVELOPE'
    );
    expect(isAflTradeProjectionPublicEvidenceIndexConstructionError(trusted)).toBe(true);
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
    expect(
      isAflTradeProjectionPublicEvidenceIndexConstructionError({
        name: trusted.name,
        code: trusted.code,
        message: trusted.message,
      })
    ).toBe(false);
  });

  it('makes replay verification total and fail closed for tampering, extras, and hostile inputs', () => {
    const input = inputFor();
    const output = createAflTradeProjectionPublicEvidenceIndex(input);
    const tampered = structuredClone(output);
    tampered.projectionPublicEvidenceIndex.content.scopeKey = 'scope:tampered';

    expect(verifyAflTradeProjectionPublicEvidenceIndex(verifyInput(input, output))).toBe(true);
    expect(verifyAflTradeProjectionPublicEvidenceIndex(verifyInput(input, tampered))).toBe(false);
    expect(
      verifyAflTradeProjectionPublicEvidenceIndex({ ...verifyInput(input, output), extra: true })
    ).toBe(false);
    expect(verifyAflTradeProjectionPublicEvidenceIndex(null)).toBe(false);
    expect(
      verifyAflTradeProjectionPublicEvidenceIndex(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('hostile-verifier');
            },
          }
        )
      )
    ).toBe(false);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(verifyAflTradeProjectionPublicEvidenceIndex(revoked.proxy)).toBe(false);
  });

  it('rejects tampered result references and ownership fields at strict boundaries', () => {
    const input = inputFor();
    const output = createAflTradeProjectionPublicEvidenceIndex(input);
    const tamperedRef = structuredClone(output);
    tamperedRef.projectionPublicEvidenceIndexArtifactRef.byteLength += 1;
    expect(aflTradeProjectionPublicEvidenceIndexResultSchema.safeParse(tamperedRef).success).toBe(
      false
    );

    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidenceIndex({
          ...input,
          userId: 'user:forbidden',
        }),
      'INVALID_INPUT_ENVELOPE'
    );
    const content = structuredClone(output.projectionPublicEvidenceIndex.content);
    Object.assign(content.entries[0], { fantasyTeamId: 'fantasy-team:forbidden' });
    expect(aflTradeProjectionPublicEvidenceIndexContentSchema.safeParse(content).success).toBe(
      false
    );
  });
});

function contentTradeId(evidence: AflTradeProjectionPublicEvidenceResult): string {
  return evidence.projectionPublicEvidence.content.tradeId;
}
