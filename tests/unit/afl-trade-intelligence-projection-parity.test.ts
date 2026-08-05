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
  type AflTradeProjectionDocumentArtifact,
} from '@/server/aflTradeIntelligence/publication/projectionDocumentContracts';
import {
  createAflTradeProjectionDocumentSet,
  type AflTradeProjectionDocumentSetBinding,
  type AflTradeProjectionDocumentSetResult,
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
import {
  AFL_TRADE_PROJECTION_PARITY_FAILURE_CODES,
  AFL_TRADE_PROJECTION_PARITY_MAX_AGGREGATE_DOCUMENT_BYTES,
  AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_ARTIFACT_BYTES,
  AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS,
  AflTradeProjectionParityConstructionError,
  aflTradeProjectionParityReportResultSchema,
  createAflTradeProjectionParityReport,
  isAflTradeProjectionParityConstructionError,
  verifyAflTradeProjectionParityReport,
  type AflTradeProjectionParityConstructionErrorCode,
  type AflTradeProjectionParityCreateInput,
} from '@/server/aflTradeIntelligence/publication/projectionParity';
import {
  createAflTradeProjectionPresentationPolicy,
  type AflTradeProjectionPresentationPolicyResult,
} from '@/server/aflTradeIntelligence/publication/projectionPresentationPolicy';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_POLICY_DEFINITION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_VERIFICATION_SCOPE,
  aflTradeProjectionPublicEvidenceIndexResultSchema,
  type AflTradeProjectionPublicEvidenceIndexResult,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidenceIndex';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  aflTradeProjectionPublicEvidenceContentSchema,
  createAflTradeProjectionPublicEvidence,
  type AflTradeProjectionPublicEvidenceContent,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidence';
import { createAflTradeProjectionPublicEvidenceIndex } from '@/server/aflTradeIntelligence/publication/projectionPublicEvidenceIndex';
import {
  createAflTradeProjectionSchemaBundle,
  type AflTradeProjectionSchemaBundleResult,
} from '@/server/aflTradeIntelligence/publication/projectionSchemaBundle';
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
import { createAflTradeValuationOutputInventory } from '@/server/aflTradeIntelligence/valuation/valuationOutputInventory';
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
const EVIDENCE_AT = '2026-08-05T06:10:00.000Z';
const EVIDENCE_INDEX_AT = '2026-08-05T06:20:00.000Z';
const SCHEMA_AT = '2026-08-05T06:30:00.000Z';
const VERIFIED_AT = '2026-08-05T06:40:00.000Z';
const DOCUMENT_AT = '2026-08-05T07:00:00.000Z';
const MATERIALIZATION_SHARD_AT = '2026-08-05T07:10:00.000Z';
const MATERIALIZATION_ROOT_AT = '2026-08-05T07:20:00.000Z';
const METHODOLOGY_AT = '2026-08-05T07:30:00.000Z';
const SET_AT = '2026-08-05T08:00:00.000Z';
const CHECKED_AT = '2026-08-05T10:00:00.000Z';
const SCOPE_KEY = 'public-afl-trade-values';
const VALUE_UNIT_ID = 'fixture-football-value-v1';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

function semanticId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function artifact(label: string, createdAt: string) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
}

function canonicalByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value)).byteLength;
}

const valueUnit = {
  id: VALUE_UNIT_ID,
  label: 'Fixture football value',
  description: 'A fabricated source-native AFL football contribution unit.',
  direction: 'higher_is_better' as const,
};

function methodology(
  valuationBundleId: string,
  boundValueUnit: typeof valueUnit,
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
    valueUnit: boundValueUnit,
    primaryOutcome: {
      code: 'fixture-club-contribution',
      label: 'Fixture club contribution',
      definition: 'Fabricated definition used only for projection parity tests.',
    },
    trainingPeriod: { firstSeason: 2001, lastSeason: 2024 },
    calculationAsOf,
    supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
    supportedDataCoverage: ['Fabricated resolved AFL trade assets'],
    knownLimitations: ['Fabricated limitation used only for contract testing.'],
    materialChangesFromPrevious: [],
  };
}

interface FixtureIdentity {
  publicationId: string;
  valuationBundleId: string;
  valuationOutputInventoryIndexId: string;
  scopeKey: string;
  valueUnitId: string;
}

interface InventoryIndexBinding {
  schemaVersion: 'afl-trade-valuation-output-inventory-index/v1';
  valuationOutputInventoryIndexId: string;
  artifactRef: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;
  entryCount: number;
  inventorySetSha256: string;
}

function inventoryIndexBinding(
  identity: FixtureIdentity,
  tradeCount: number
): InventoryIndexBinding {
  return {
    schemaVersion: 'afl-trade-valuation-output-inventory-index/v1',
    valuationOutputInventoryIndexId: identity.valuationOutputInventoryIndexId,
    artifactRef: artifact('inventory-index', INDEX_AT),
    entryCount: tradeCount,
    inventorySetSha256: sha256AflTradeCanonicalJson({ tradeCount }),
  };
}

function createEvidenceIndex(
  identity: FixtureIdentity,
  tradeIds: readonly string[],
  indexBinding: InventoryIndexBinding
): AflTradeProjectionPublicEvidenceIndexResult {
  const entries = [...tradeIds].sort().map((tradeId) => ({
    tradeId,
    valuationCaseId: semanticId('valuation-case', tradeId),
    valuationCalculationId: semanticId('valuation-calculation', tradeId),
    valuationOutputInventoryId: semanticId('valuation-output-inventory', tradeId),
    inventoryArtifactRef: artifact(`inventory:${tradeId}`, ROOT_AT),
    projectionPublicEvidenceId: semanticId('projection-public-evidence', tradeId),
    evidenceArtifactRef: artifact(`evidence:${tradeId}`, EVIDENCE_AT),
  }));
  const publicationRef = artifact('publication', PUBLICATION_AT);
  const content = {
    schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
    publication: {
      schemaVersion: 'afl-trade-publication/v3' as const,
      publicationId: identity.publicationId,
      artifactRef: publicationRef,
    },
    valuationOutputInventoryIndex: indexBinding,
    scopeKey: identity.scopeKey,
    valueUnitId: identity.valueUnitId,
    indexedEvidenceSchemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    ordering: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING,
    digestDefinition: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION,
    entryCount: entries.length,
    totalEvidenceArtifactByteLength: entries.reduce(
      (total, entry) => total + entry.evidenceArtifactRef.byteLength,
      0
    ),
    canonicalEntriesByteLength: canonicalByteLength(entries),
    evidenceBindingSetSha256: sha256AflTradeCanonicalJson(entries),
    entries,
    verificationScope: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_VERIFICATION_SCOPE,
    predecessorPolicy: {
      definitionVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_POLICY_DEFINITION,
      indexedEvidenceSchemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited' as const,
      runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK,
      bindingAuthority: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING,
    },
    materializedAt: EVIDENCE_INDEX_AT,
    limitation: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION,
  };
  const projectionPublicEvidenceIndex = {
    projectionPublicEvidenceIndexId: createAflTradeContentAddress(
      'projection-public-evidence-index',
      content
    ),
    content,
  };
  return aflTradeProjectionPublicEvidenceIndexResultSchema.parse({
    projectionPublicEvidenceIndex,
    projectionPublicEvidenceIndexArtifactRef: createAflTradeCanonicalJsonArtifactRef(
      projectionPublicEvidenceIndex,
      EVIDENCE_INDEX_AT
    ),
  });
}

function createPolicy(unit = valueUnit): AflTradeProjectionPresentationPolicyResult {
  return createAflTradeProjectionPresentationPolicy({
    valueUnit: unit,
    universalLayer: 'scarcity_adjusted',
    balancedMaximumLeaderMargin: 0.05,
    balancedMinimumPracticalEquivalenceProbability: 0.4,
    strongMinimumLeaderMargin: 0.2,
    methodologyHref: '/draft/trades/methodology',
    createdAt: POLICY_AT,
  });
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
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation
): AflTradeValuationBundleManifestV2 {
  const contract = inventoryContractPayload();
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
    viewContexts: valuationCase.content.viewContexts,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
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
      listSpotPolicyArtifact: artifact('list-spot', SOURCE_AT),
      scarcityPolicyArtifact: artifact('scarcity', SOURCE_AT),
      roleCongestionPolicyArtifact: artifact('role-congestion', SOURCE_AT),
    },
    simulation: {
      draws: calculation.content.draws.length,
      seed: 20260805,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('low-return', SOURCE_AT),
      eliteOutcomeDefinitionArtifact: artifact('elite-outcome', SOURCE_AT),
      practicalEquivalenceDefinitionArtifact: artifact('equivalence', SOURCE_AT),
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
      sourceCodeArtifact: artifact('source-code', SOURCE_AT),
      dependencyLockArtifact: artifact('dependency-lock', SOURCE_AT),
      runtimeArtifact: artifact('runtime', SOURCE_AT),
      configurationArtifact: artifact('configuration', SOURCE_AT),
    },
    outputs: {
      immutableSnapshotsArtifact: artifact('snapshots', SOURCE_AT),
      simulationDrawsArtifact: artifact('draws', SOURCE_AT),
      attributionInvariantReportArtifact: artifact('attribution', SOURCE_AT),
      deterministicReplayReportArtifact: artifact('replay', SOURCE_AT),
      explanationParityReportArtifact: artifact('explanation-parity', SOURCE_AT),
      coverageAndExclusionReportArtifact: artifact('coverage', SOURCE_AT),
      confidenceReportArtifact: artifact('confidence', SOURCE_AT),
      sensitivityReportArtifact: artifact('sensitivity', SOURCE_AT),
      validationReportArtifact: artifact('validation', SOURCE_AT),
      modelCardArtifact: artifact('model-card', SOURCE_AT),
    },
    outputInventoryContract: {
      ...contract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(contract, CONTRACT_AT),
    },
    limitations: ['Focused projection-parity fixture.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

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

type SourceRole = 'confidence' | 'coverage' | 'asset_identity' | 'lineage_frontier' | 'factor';

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
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
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

function buildVerifiedProjectionPipeline() {
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
  const projectionPresentationPolicy = createAflTradeProjectionPresentationPolicy({
    valueUnit: {
      id: fixture.bundle.content.valueUnitId,
      label: 'Fabricated football contribution',
      description: 'A fabricated cross-club football-contribution unit for parity tests.',
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
    {
      id: fixture.bundle.content.valueUnitId,
      label: 'Fixture football value',
      description: 'A fabricated source-native AFL football contribution unit.',
      direction: 'higher_is_better',
    },
    currentContext.valuationAsOf
  );
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
    methodologyArtifact: createAflTradeCanonicalJsonArtifactRef(
      methodologyPayload,
      PUBLICATION_ARTIFACT_AT
    ),
    validationReportArtifact: artifact('publication-validation', PUBLICATION_ARTIFACT_AT),
    modelCardArtifact: artifact('publication-model-card', PUBLICATION_ARTIFACT_AT),
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
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
      schemaVersion:
        projectionPresentationPolicy.projectionPresentationPolicy.content.schemaVersion,
      projectionPresentationPolicyId:
        projectionPresentationPolicy.projectionPresentationPolicy.projectionPresentationPolicyId,
      artifactRef: projectionPresentationPolicy.projectionPresentationPolicyArtifactRef,
      valueUnitId: projectionPresentationPolicy.projectionPresentationPolicy.content.valueUnit.id,
      universalLayer:
        projectionPresentationPolicy.projectionPresentationPolicy.content.universalLayer,
      supportedViews:
        projectionPresentationPolicy.projectionPresentationPolicy.content.supportedViews,
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
  const projectionPublicEvidenceIndex = createAflTradeProjectionPublicEvidenceIndex({
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
    projectionPublicEvidenceIndex,
    projectionPresentationPolicy,
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
  const projectionSchemaBundle = createAflTradeProjectionSchemaBundle({ createdAt: SCHEMA_AT });
  const commonParents = {
    publication,
    valuationOutputInventoryIndex: inventoryIndex,
    projectionPublicEvidenceIndex,
    projectionPresentationPolicy,
    projectionSchemaBundle,
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
  const projectionMaterializationVerification = { ...rootInput, output: rootOutput };
  return {
    fixture,
    publicationManifest,
    inventoryIndex,
    projectionPresentationPolicy,
    projectionPublicEvidenceIndex,
    projectionSchemaBundle,
    methodologyPayload,
    tradeOutput,
    rootOutput,
    projectionMaterializationVerification,
  };
}

interface Fixture {
  identity: FixtureIdentity;
  tradeIds: string[];
  projectionPresentationPolicy: AflTradeProjectionPresentationPolicyResult;
  projectionPublicEvidenceIndex: AflTradeProjectionPublicEvidenceIndexResult;
  projectionSchemaBundle: AflTradeProjectionSchemaBundleResult;
  projectionDocumentSet: AflTradeProjectionDocumentSetResult;
  projectionDocumentSetVerification: AflTradeProjectionParityCreateInput['projectionDocumentSetVerification'];
  documents: AflTradeProjectionDocumentArtifact[];
  input: AflTradeProjectionParityCreateInput;
}

function createFixture(): Fixture {
  const pipeline = buildVerifiedProjectionPipeline();
  const binding = materializationBindingFor(pipeline.rootOutput);
  if (
    pipeline.methodologyPayload.calculationAsOf !== binding.calculationAsOf ||
    pipeline.methodologyPayload.valueUnit.id !== binding.valueUnitId
  ) {
    throw new Error('Published methodology does not match materialization time and value unit.');
  }
  const methodologyDocument = createAflTradeProjectionDocumentArtifact({
    content: {
      schemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
      publicationId: pipeline.publicationManifest.publicationId,
      valuationBundleId: pipeline.publicationManifest.content.valuationBundleId,
      valuationOutputInventoryIndexId:
        pipeline.inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      scopeKey: binding.scopeKey,
      valueUnitId: binding.valueUnitId,
      calculationAsOf: binding.calculationAsOf,
      knowledgeCutoffAt: binding.knowledgeCutoffAt,
      kind: 'methodology',
      methodology: pipeline.methodologyPayload,
      projectionMaterialization: binding,
    },
    materializedAt: METHODOLOGY_AT,
  });
  const documents = [...pipeline.tradeOutput.projectionDocuments, methodologyDocument];
  const documentSetInput = {
    publicationManifest: pipeline.publicationManifest,
    valuationOutputInventoryIndex: pipeline.inventoryIndex.valuationOutputInventoryIndex,
    valuationOutputInventoryIndexArtifactRef:
      pipeline.inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    projectionMaterializationVerification: pipeline.projectionMaterializationVerification,
    projectionDocuments: documents,
    materializedAt: SET_AT,
  };
  const projectionDocumentSet = createAflTradeProjectionDocumentSet(documentSetInput);
  const projectionDocumentSetVerification = {
    ...documentSetInput,
    output: projectionDocumentSet,
  };
  const sourceById = new Map(
    documents.map((document) => [document.projectionDocument.projectionDocumentId, document])
  );
  const orderedDocuments = projectionDocumentSet.projectionDocumentShards
    .flatMap((shard) => shard.projectionDocumentSetShard.content.bindings)
    .map((documentBinding) => {
      const document = sourceById.get(documentBinding.projectionDocumentId);
      if (!document) throw new Error('Missing verified projection document.');
      return document;
    });
  const tradeIds = [pipeline.fixture.valuationCase.content.tradeId];
  const identity: FixtureIdentity = {
    publicationId: pipeline.publicationManifest.publicationId,
    valuationBundleId: pipeline.publicationManifest.content.valuationBundleId,
    valuationOutputInventoryIndexId:
      pipeline.inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    scopeKey: pipeline.publicationManifest.content.scopeKey,
    valueUnitId: pipeline.publicationManifest.content.valueUnitId,
  };
  const input = {
    projectionPresentationPolicy: pipeline.projectionPresentationPolicy,
    projectionPublicEvidenceIndex: pipeline.projectionPublicEvidenceIndex,
    projectionSchemaBundle: pipeline.projectionSchemaBundle,
    projectionDocumentSetVerification,
    storedDocuments: JSON.parse(
      canonicalizeAflTradeJson(orderedDocuments)
    ) as AflTradeProjectionDocumentArtifact[],
    checkedAt: CHECKED_AT,
  };
  return {
    identity,
    tradeIds,
    projectionPresentationPolicy: pipeline.projectionPresentationPolicy,
    projectionPublicEvidenceIndex: pipeline.projectionPublicEvidenceIndex,
    projectionSchemaBundle: pipeline.projectionSchemaBundle,
    projectionDocumentSet,
    projectionDocumentSetVerification,
    documents: orderedDocuments,
    input,
  };
}

function failureCodes(input: AflTradeProjectionParityCreateInput): string[] {
  return createAflTradeProjectionParityReport(
    input
  ).projectionParityReport.content.failureDetails.map(({ code }) => code);
}

function documentSetBindings(fixture: Fixture): AflTradeProjectionDocumentSetBinding[] {
  return fixture.projectionDocumentSet.projectionDocumentShards.flatMap(
    (shard) => shard.projectionDocumentSetShard.content.bindings
  );
}

function unexpectedStoredDocument(fixture: Fixture): AflTradeProjectionDocumentArtifact {
  const source = fixture.documents.find(
    (document) => document.projectionDocument.content.kind === 'trade_summary'
  );
  if (!source || source.projectionDocument.content.kind !== 'trade_summary') {
    throw new Error('Missing stored summary fixture.');
  }
  return createAflTradeProjectionDocumentArtifact({
    content: { ...source.projectionDocument.content, tradeId: 'trade:unexpected-stored' },
    materializedAt: source.projectionDocumentArtifactRef.createdAt,
  });
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeProjectionParityConstructionErrorCode
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isAflTradeProjectionParityConstructionError(error)).toBe(true);
    if (isAflTradeProjectionParityConstructionError(error)) expect(error.code).toBe(code);
  }
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((entry) => isDeeplyFrozen(entry, seen))
  );
}

describe('AFL trade projection parity', () => {
  it('passes exact verified-set and stored parity with explicit 18 + 7/document accounting', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport(fixture.input);
    const content = output.projectionParityReport.content;

    expect(content).toMatchObject({
      status: 'passed',
      checkedDocumentCount: 14,
      expectedDocumentCount: 14,
      storedDocumentCount: 14,
      failureCount: 0,
      failureDetails: [],
      failureDetailsTruncated: false,
    });
    expect(content.checkCount).toBe(18 + 7 * content.checkedDocumentCount);
    expect(content.materialization).toEqual(
      fixture.projectionDocumentSet.projectionDocumentSet.content.projectionMaterialization
    );
    expect(content.materialization).toEqual(
      materializationBindingFor(
        fixture.projectionDocumentSetVerification.projectionMaterializationVerification.output
      )
    );
    expect(fixture.input.storedDocuments).toEqual(fixture.documents);
    expect(fixture.input.storedDocuments).not.toBe(fixture.documents);
    expect(fixture.input.storedDocuments[0]).not.toBe(fixture.documents[0]);
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        output.projectionParityReportArtifactRef,
        output.projectionParityReport
      )
    ).toBe(true);
    expect(verifyAflTradeProjectionParityReport({ ...fixture.input, output })).toBe(true);
  });

  it('content-addresses the report and keeps its exact one-MiB result contract', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport(fixture.input);

    expect(output.projectionParityReport.projectionParityReportId).toBe(
      createAflTradeContentAddress(
        'projection-parity-report',
        output.projectionParityReport.content
      )
    );
    expect(output.projectionParityReportArtifactRef.createdAt).toBe(CHECKED_AT);
    expect(output.projectionParityReportArtifactRef.byteLength).toBeGreaterThan(0);
    expect(output.projectionParityReportArtifactRef.byteLength).toBeLessThanOrEqual(
      AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_ARTIFACT_BYTES
    );
  });

  it('reports exact parent publication, inventory, count, trade-universe, scope, and unit mismatches', () => {
    const fixture = createFixture();
    const variants = [
      createEvidenceIndex(
        { ...fixture.identity, publicationId: semanticId('publication', 'different') },
        fixture.tradeIds,
        inventoryIndexBinding(fixture.identity, 1)
      ),
      createEvidenceIndex(
        {
          ...fixture.identity,
          valuationOutputInventoryIndexId: semanticId(
            'valuation-output-inventory-index',
            'different'
          ),
        },
        fixture.tradeIds,
        inventoryIndexBinding(
          {
            ...fixture.identity,
            valuationOutputInventoryIndexId: semanticId(
              'valuation-output-inventory-index',
              'different'
            ),
          },
          1
        )
      ),
      createEvidenceIndex(
        { ...fixture.identity, scopeKey: 'scope:different' },
        fixture.tradeIds,
        inventoryIndexBinding(fixture.identity, 1)
      ),
    ];
    const expectedCodes = [
      'parent_publication_mismatch',
      'parent_inventory_index_mismatch',
      'parent_scope_mismatch',
    ];
    for (const [index, projectionPublicEvidenceIndex] of variants.entries()) {
      const output = createAflTradeProjectionParityReport({
        ...fixture.input,
        projectionPublicEvidenceIndex,
      });
      expect(output.projectionParityReport.content.status).toBe('failed');
      expect(
        output.projectionParityReport.content.failureDetails.map(({ code }) => code)
      ).toContain(expectedCodes[index]);
    }

    const differentPolicy = createPolicy({ ...valueUnit, id: 'football-value:different' });
    const output = createAflTradeProjectionParityReport({
      ...fixture.input,
      projectionPresentationPolicy: differentPolicy,
    });
    expect(output.projectionParityReport.content.failureDetails.map(({ code }) => code)).toContain(
      'parent_value_unit_mismatch'
    );

    const exactIndexBinding = inventoryIndexBinding(fixture.identity, 1);
    const divergentArtifactBinding = {
      ...exactIndexBinding,
      artifactRef: artifact('different-inventory-index-bytes', INDEX_AT),
    };
    expect(
      failureCodes({
        ...fixture.input,
        projectionPublicEvidenceIndex: createEvidenceIndex(
          fixture.identity,
          fixture.tradeIds,
          divergentArtifactBinding
        ),
      })
    ).toEqual(['parent_inventory_index_mismatch', 'parent_materialization_mismatch']);

    const differentTradeIds = [...fixture.tradeIds, 'trade:different-count'];
    expect(
      failureCodes({
        ...fixture.input,
        projectionPublicEvidenceIndex: createEvidenceIndex(
          fixture.identity,
          differentTradeIds,
          inventoryIndexBinding(fixture.identity, differentTradeIds.length)
        ),
      })
    ).toEqual([
      'parent_inventory_index_mismatch',
      'parent_materialization_mismatch',
      'parent_trade_count_mismatch',
      'parent_trade_universe_mismatch',
    ]);

    expect(
      failureCodes({
        ...fixture.input,
        projectionPublicEvidenceIndex: createEvidenceIndex(
          fixture.identity,
          ['trade:different-universe'],
          exactIndexBinding
        ),
      })
    ).toEqual([
      'parent_inventory_index_mismatch',
      'parent_materialization_mismatch',
      'parent_trade_universe_mismatch',
    ]);
  });

  it('reports parent and document chronology failures without throwing', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport({
      ...fixture.input,
      checkedAt: '2026-08-05T06:30:00.000Z',
    });
    const codes = output.projectionParityReport.content.failureDetails.map(({ code }) => code);

    expect(output.projectionParityReport.content.status).toBe('failed');
    expect(codes).toContain('parent_chronology_invalid');
    expect(codes).toContain('expected_document_chronology_invalid');
    expect(codes).toContain('stored_document_chronology_invalid');
  });

  it('rejects missing, reordered, substituted, or replay-forged upstream document-set proofs', () => {
    const fixture = createFixture();
    const variants: Array<{
      verification: Fixture['projectionDocumentSetVerification'];
      code: AflTradeProjectionParityConstructionErrorCode;
    }> = [
      {
        verification: (() => {
          const verification = structuredClone(fixture.projectionDocumentSetVerification);
          verification.projectionDocuments.pop();
          return verification;
        })(),
        code: 'INVALID_DOCUMENT_SET_VERIFICATION',
      },
      {
        verification: (() => {
          const verification = structuredClone(fixture.projectionDocumentSetVerification);
          verification.output.projectionDocumentSet.content.documentCount += 1;
          return verification;
        })(),
        code: 'INVALID_DOCUMENT_SET_RESULT',
      },
      {
        verification: (() => {
          const verification = structuredClone(fixture.projectionDocumentSetVerification);
          verification.projectionMaterializationVerification.output.projectionMaterialization.content.entrySetSha256 =
            '0'.repeat(64);
          return verification;
        })(),
        code: 'INVALID_DOCUMENT_SET_VERIFICATION',
      },
      {
        verification: (() => {
          const verification = structuredClone(fixture.projectionDocumentSetVerification);
          verification.output.projectionDocumentShards[0].projectionDocumentSetShard.content.bindings.reverse();
          return verification;
        })(),
        code: 'INVALID_DOCUMENT_SET_RESULT',
      },
      {
        verification: (() => {
          const verification = structuredClone(fixture.projectionDocumentSetVerification);
          verification.publicationManifest.content.methodologyArtifact = artifact(
            'substituted-upstream-methodology',
            PUBLICATION_ARTIFACT_AT
          );
          return verification;
        })(),
        code: 'INVALID_DOCUMENT_SET_VERIFICATION',
      },
    ];
    for (const { verification: projectionDocumentSetVerification, code } of variants) {
      expectConstructionError(
        () =>
          createAflTradeProjectionParityReport({
            ...fixture.input,
            projectionDocumentSetVerification,
          }),
        code
      );
    }
  });

  it('reports stored missing, unexpected, duplicate, artifact-reference, and ordering classes', () => {
    const fixture = createFixture();
    const missing = createAflTradeProjectionParityReport({
      ...fixture.input,
      storedDocuments: fixture.documents.slice(1),
    });
    const missingCodes = missing.projectionParityReport.content.failureDetails.map(
      ({ code }) => code
    );
    expect(missingCodes).toContain('stored_document_count_mismatch');
    expect(missingCodes).toContain('stored_document_missing');
    expect(missingCodes).toContain('stored_document_order_mismatch');

    const duplicate = createAflTradeProjectionParityReport({
      ...fixture.input,
      storedDocuments: [...fixture.documents, fixture.documents[0]],
    });
    const duplicateCodes = duplicate.projectionParityReport.content.failureDetails.map(
      ({ code }) => code
    );
    expect(duplicateCodes).toContain('stored_document_id_duplicate');
    expect(duplicateCodes).toContain('stored_document_artifact_duplicate');

    const independentlyMaterialized = createAflTradeProjectionDocumentArtifact({
      content: fixture.documents[0].projectionDocument.content,
      materializedAt: '2026-08-05T07:30:00.000Z',
    });
    const artifactMismatch = createAflTradeProjectionParityReport({
      ...fixture.input,
      storedDocuments: [independentlyMaterialized, ...fixture.documents.slice(1)],
    });
    expect(
      artifactMismatch.projectionParityReport.content.failureDetails.map(({ code }) => code)
    ).toContain('stored_document_artifact_mismatch');

    const unexpected = unexpectedStoredDocument(fixture);
    const unexpectedOutput = createAflTradeProjectionParityReport({
      ...fixture.input,
      storedDocuments: [...fixture.documents.slice(1), unexpected],
    });
    const unexpectedCodes = unexpectedOutput.projectionParityReport.content.failureDetails.map(
      ({ code }) => code
    );
    expect(unexpectedCodes).toContain('stored_document_missing');
    expect(unexpectedCodes).toContain('stored_document_unexpected');
  });

  it('exercises reachable parent and stored drift classes through exact verified inputs', () => {
    const fixture = createFixture();
    const unexpected = unexpectedStoredDocument(fixture);
    const observed = new Set<string>();
    const observe = (input: AflTradeProjectionParityCreateInput) => {
      for (const code of failureCodes(input)) observed.add(code);
    };
    const exactIndexBinding = inventoryIndexBinding(fixture.identity, 1);

    observe({
      ...fixture.input,
      projectionPublicEvidenceIndex: createEvidenceIndex(
        { ...fixture.identity, publicationId: semanticId('publication', 'coverage-different') },
        fixture.tradeIds,
        exactIndexBinding
      ),
    });
    observe({
      ...fixture.input,
      projectionPublicEvidenceIndex: createEvidenceIndex(fixture.identity, fixture.tradeIds, {
        ...exactIndexBinding,
        artifactRef: artifact('coverage-index-different', INDEX_AT),
      }),
    });
    const twoTradeIds = [...fixture.tradeIds, 'trade:coverage-extra'];
    observe({
      ...fixture.input,
      projectionPublicEvidenceIndex: createEvidenceIndex(
        fixture.identity,
        twoTradeIds,
        inventoryIndexBinding(fixture.identity, twoTradeIds.length)
      ),
    });
    observe({
      ...fixture.input,
      projectionPublicEvidenceIndex: createEvidenceIndex(
        { ...fixture.identity, scopeKey: 'scope:coverage-different' },
        fixture.tradeIds,
        exactIndexBinding
      ),
    });
    observe({
      ...fixture.input,
      projectionPresentationPolicy: createPolicy({
        ...valueUnit,
        id: 'football-value:coverage-different',
      }),
    });
    observe({ ...fixture.input, checkedAt: '2026-08-05T06:30:00.000Z' });

    observe({ ...fixture.input, storedDocuments: fixture.documents.slice(1) });
    observe({
      ...fixture.input,
      storedDocuments: [...fixture.documents, fixture.documents[0]],
    });
    observe({ ...fixture.input, storedDocuments: [...fixture.documents].reverse() });
    observe({
      ...fixture.input,
      storedDocuments: [unexpected, ...fixture.documents.slice(1)],
    });
    observe({
      ...fixture.input,
      storedDocuments: [
        createAflTradeProjectionDocumentArtifact({
          content: fixture.documents[0].projectionDocument.content,
          materializedAt: '2026-08-05T07:30:00.000Z',
        }),
        ...fixture.documents.slice(1),
      ],
    });

    for (const code of [
      'parent_publication_mismatch',
      'parent_inventory_index_mismatch',
      'parent_trade_count_mismatch',
      'parent_trade_universe_mismatch',
      'parent_scope_mismatch',
      'parent_value_unit_mismatch',
      'parent_materialization_mismatch',
      'parent_chronology_invalid',
      'expected_document_chronology_invalid',
      'stored_document_count_mismatch',
      'stored_document_id_duplicate',
      'stored_document_artifact_duplicate',
      'stored_document_order_mismatch',
      'stored_document_missing',
      'stored_document_unexpected',
      'stored_document_artifact_mismatch',
      'stored_document_chronology_invalid',
    ]) {
      expect(observed.has(code)).toBe(true);
    }
    expect(
      [...observed].every((code) =>
        AFL_TRADE_PROJECTION_PARITY_FAILURE_CODES.includes(code as never)
      )
    ).toBe(true);
  });

  it('emits deterministic failure ordering, exact counts, and a bounded prefix', () => {
    const fixture = createFixture();
    const input = { ...fixture.input, storedDocuments: [] };
    const first = createAflTradeProjectionParityReport(input);
    const second = createAflTradeProjectionParityReport(input);
    const content = first.projectionParityReport.content;

    expect(first).toEqual(second);
    expect(content.status).toBe('failed');
    expect(content.failureCount).toBe(content.failureDetails.length);
    expect(content.failureDetailsTruncated).toBe(false);
    expect(content.failureDetails.map(({ ordinal }) => ordinal)).toEqual(
      content.failureDetails.map((_, index) => index + 1)
    );
    expect(content.failureDetails.map(({ code }) => code)).toEqual(
      [...content.failureDetails.map(({ code }) => code)].sort()
    );
  });

  it('retains the complete deterministic failure prefix below the 1,000-detail cap', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport({
      ...fixture.input,
      storedDocuments: [],
    });
    const content = output.projectionParityReport.content;
    const canonicalMissingIds = documentSetBindings(fixture)
      .map(({ projectionDocumentId }) => projectionDocumentId)
      .sort();

    expect(content.failureCount).toBe(16);
    expect(content.failureDetails).toHaveLength(16);
    expect(content.failureDetailsTruncated).toBe(false);
    expect(
      content.failureDetails
        .filter(({ code }) => code === 'stored_document_missing')
        .map(({ projectionDocumentId }) => projectionDocumentId)
    ).toEqual(canonicalMissingIds);
    expect(content.failureDetails.length).toBeLessThan(
      AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS
    );
  });

  it('fails closed before comparison when aggregate canonical document bytes exceed 64 MiB', () => {
    const fixture = createFixture();
    const content = structuredClone(fixture.documents[0].projectionDocument.content);
    if (content.kind !== 'trade_summary') throw new Error('Expected the first fixture document.');
    content.valuation.warnings = Array.from({ length: 20 }, (_, index) => ({
      code: `fixture-heavy-warning-${index}`,
      severity: 'warning' as const,
      message: 'x'.repeat(500),
    }));
    const heavyDocument = createAflTradeProjectionDocumentArtifact({
      content,
      materializedAt: DOCUMENT_AT,
    });
    const requiredCount =
      Math.floor(
        AFL_TRADE_PROJECTION_PARITY_MAX_AGGREGATE_DOCUMENT_BYTES /
          heavyDocument.projectionDocumentArtifactRef.byteLength
      ) + 1;

    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          storedDocuments: Array.from({ length: requiredCount }, () => heavyDocument),
        }),
      'AGGREGATE_INPUT_SIZE_LIMIT_EXCEEDED'
    );
  });

  it('rejects malformed exact parents, checked time, and projection-document result envelopes', () => {
    const fixture = createFixture();
    const badPolicy = structuredClone(fixture.projectionPresentationPolicy);
    badPolicy.projectionPresentationPolicyArtifactRef.byteLength = 0;
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          projectionPresentationPolicy: badPolicy,
        }),
      'INVALID_PRESENTATION_POLICY_RESULT'
    );

    const badEvidenceIndex = structuredClone(fixture.projectionPublicEvidenceIndex);
    badEvidenceIndex.projectionPublicEvidenceIndexArtifactRef.byteLength = 0;
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          projectionPublicEvidenceIndex: badEvidenceIndex,
        }),
      'INVALID_PUBLIC_EVIDENCE_INDEX_RESULT'
    );

    const badSchemaBundle = structuredClone(fixture.projectionSchemaBundle);
    badSchemaBundle.projectionSchemaBundleArtifactRef.byteLength = 0;
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          projectionSchemaBundle: badSchemaBundle,
        }),
      'INVALID_SCHEMA_BUNDLE_RESULT'
    );

    const badDocumentSetVerification = structuredClone(fixture.projectionDocumentSetVerification);
    badDocumentSetVerification.output.projectionDocumentSetArtifactRef.byteLength = 0;
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          projectionDocumentSetVerification: badDocumentSetVerification,
        }),
      'INVALID_DOCUMENT_SET_RESULT'
    );

    expectConstructionError(
      () => createAflTradeProjectionParityReport({ ...fixture.input, checkedAt: 'not-a-time' }),
      'INVALID_CHECKED_AT'
    );

    const badDocuments = structuredClone(fixture.documents);
    badDocuments[0].projectionDocumentArtifactRef.contentSha256 = '0'.repeat(64);
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          storedDocuments: badDocuments,
        }),
      'INVALID_STORED_DOCUMENTS'
    );
  });

  it('rejects oversized references, raw tampering, and a rehashed schema-valid forged pass', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport(fixture.input);
    const oversized = structuredClone(output);
    oversized.projectionParityReportArtifactRef.byteLength =
      AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_ARTIFACT_BYTES + 1;
    expect(aflTradeProjectionParityReportResultSchema.safeParse(oversized).success).toBe(false);
    expect(verifyAflTradeProjectionParityReport({ ...fixture.input, output: oversized })).toBe(
      false
    );

    const tampered = structuredClone(output);
    tampered.projectionParityReport.content.failureCount = 1;
    expect(verifyAflTradeProjectionParityReport({ ...fixture.input, output: tampered })).toBe(
      false
    );

    const forgedContent = structuredClone(output.projectionParityReport.content);
    forgedContent.checkedAt = '2026-08-05T10:00:01.000Z';
    const forgedReport = {
      projectionParityReportId: createAflTradeContentAddress(
        'projection-parity-report',
        forgedContent
      ),
      content: forgedContent,
    };
    const forgedOutput = {
      projectionParityReport: forgedReport,
      projectionParityReportArtifactRef: createAflTradeCanonicalJsonArtifactRef(
        forgedReport,
        forgedContent.checkedAt
      ),
    };
    expect(aflTradeProjectionParityReportResultSchema.safeParse(forgedOutput).success).toBe(true);
    expect(verifyAflTradeProjectionParityReport({ ...fixture.input, output: forgedOutput })).toBe(
      false
    );
  });

  it('deep-freezes cloned output and does not alias mutable caller arrays', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport(fixture.input);
    const snapshot = canonicalizeAflTradeJson(output);

    fixture.projectionDocumentSetVerification.projectionDocuments.reverse();
    fixture.input.storedDocuments.pop();

    expect(isDeeplyFrozen(output)).toBe(true);
    expect(canonicalizeAflTradeJson(output)).toBe(snapshot);
  });

  it('rejects user and fantasy ownership fields at strict envelope and nested boundaries', () => {
    const fixture = createFixture();
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          userId: 'user:forbidden',
        }),
      'INVALID_INPUT_ENVELOPE'
    );

    const nested = structuredClone(fixture.documents);
    Object.assign(nested[0].projectionDocument.content, {
      fantasyTeamId: 'fantasy-team:forbidden',
    });
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          storedDocuments: nested,
        }),
      'INVALID_STORED_DOCUMENTS'
    );
    expect(outputKeys(createAflTradeProjectionParityReport(fixture.input))).not.toContain(
      'ownerId'
    );
  });

  it('contains hostile proxies and accessors without invoking them, and trusts only branded errors', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile-own-keys');
        },
      }
    );
    expectConstructionError(
      () => createAflTradeProjectionParityReport(hostile),
      'INVALID_INPUT_ENVELOPE'
    );
    expect(verifyAflTradeProjectionParityReport(hostile)).toBe(false);

    const fixture = createFixture();
    const reads = new Map<string, number>();
    const exact = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(fixture.input).map(([key, value]) => [
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
    expectConstructionError(
      () => createAflTradeProjectionParityReport(exact),
      'INVALID_INPUT_ENVELOPE'
    );
    expect([...reads.values()]).toEqual([]);

    const storedProxy = new Proxy([], {
      get() {
        throw new Error('hostile-stored-get');
      },
    });
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          storedDocuments: storedProxy,
        }),
      'INVALID_STORED_DOCUMENTS'
    );
    const verificationProxy = new Proxy(fixture.projectionDocumentSetVerification, {});
    expectConstructionError(
      () =>
        createAflTradeProjectionParityReport({
          ...fixture.input,
          projectionDocumentSetVerification: verificationProxy,
        }),
      'INVALID_DOCUMENT_SET_VERIFICATION'
    );

    const trusted = new AflTradeProjectionParityConstructionError('INVALID_INPUT_ENVELOPE');
    expect(isAflTradeProjectionParityConstructionError(trusted)).toBe(true);
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
    expect(
      isAflTradeProjectionParityConstructionError({
        name: trusted.name,
        code: trusted.code,
        message: trusted.message,
      })
    ).toBe(false);
  });

  it('makes replay verification total for exact, extra, malformed, revoked, and hostile envelopes', () => {
    const fixture = createFixture();
    const output = createAflTradeProjectionParityReport(fixture.input);
    expect(verifyAflTradeProjectionParityReport({ ...fixture.input, output })).toBe(true);
    expect(verifyAflTradeProjectionParityReport({ ...fixture.input, output, extra: true })).toBe(
      false
    );
    expect(verifyAflTradeProjectionParityReport(null)).toBe(false);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(verifyAflTradeProjectionParityReport(revoked.proxy)).toBe(false);
  });
});

function outputKeys(value: unknown, keys = new Set<string>(), seen = new WeakSet<object>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    outputKeys(child, keys, seen);
  }
  return keys;
}
