import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradePublicationManifestV3Schema,
  type AflTradePublicationManifest,
} from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
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
  type AflTradeProjectionDocumentSetResult,
} from '@/server/aflTradeIntelligence/publication/projectionDocumentSet';
import {
  createAflTradeFreshnessPolicy,
  type AflTradeFreshnessPolicyResult,
} from '@/server/aflTradeIntelligence/publication/freshnessPolicy';
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
import { type AflTradeProjectionManifestMaterializationCreateInput } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import {
  createAflTradeProjectionParityReport,
  type AflTradeProjectionParityCreateInput,
  type AflTradeProjectionParityVerifyInput,
} from '@/server/aflTradeIntelligence/publication/projectionParity';
import {
  createAflTradeProjectionPresentationPolicy,
  type AflTradeProjectionPresentationPolicyResult,
} from '@/server/aflTradeIntelligence/publication/projectionPresentationPolicy';
import { type AflTradeProjectionPublicEvidenceIndexResult } from '@/server/aflTradeIntelligence/publication/projectionPublicEvidenceIndex';
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
  createAflTradeProjectionSchemaBundleV2,
  type AflTradeAnyProjectionSchemaBundleResult,
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
import {
  createFabricatedAflTradeValuationFixture,
  type AflTradeValuationFixtureKind,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
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
import { persistAflTradeValuationOutputInventory } from '@/server/aflTradeIntelligence/valuation/valuationOutputCustody';
import {
  aflTradeValuationOutputCustodyIndexVerificationSchema,
  createAflTradeCustodiedPublicationManifest,
  createAflTradeValuationOutputCustodyIndex,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputCustodyIndex';
import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
  type AflTradePublishedMethodology,
} from '@/types/aflTradeIntelligence';

import { createAflTradeCompleteAssessmentVerificationFixture } from './aflTradeCompleteAssessmentFixture';

const CONTRACT_AT = '2026-08-05T00:30:00.000Z';
const SOURCE_AT = '2026-08-05T03:00:00.000Z';
const BUNDLE_REF_AT = '2026-08-05T03:10:00.000Z';
const ROOT_AT = '2026-08-05T04:00:00.000Z';
const INDEX_AT = '2026-08-05T05:00:00.000Z';
export const POLICY_AT = '2026-08-05T05:10:00.000Z';
const CUSTODY_AT = '2026-08-05T05:10:00.000Z';
const CUSTODY_INDEX_AT = '2026-08-05T05:15:00.000Z';
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
export const CHECKED_AT = '2026-08-05T10:00:00.000Z';
export const SCOPE_KEY = 'public-afl-trade-values';
export const VALUE_UNIT_ID = 'fixture-football-value-v1';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

function semanticId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function artifact(label: string, createdAt: string) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
}

function methodology(
  valuationBundleId: string,
  boundValueUnit: AflTradePublishedMethodology['valueUnit'],
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

export function createAflTradeValuationBundleManifestFixture(input: {
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
  environment?: 'test_fixture' | 'non_production';
  scopeKey?: string;
  components?: AflTradeValuationBundleManifestV2['content']['components'];
  createdAt?: string;
}): AflTradeValuationBundleManifestV2 {
  const createdAt = input.createdAt ?? SOURCE_AT;
  const executionFinishedAt = new Date(Date.parse(createdAt) - 1_000).toISOString();
  const executionStartedAt = new Date(Date.parse(createdAt) - 2_000).toISOString();
  const contractCreatedAt = input.createdAt === undefined ? CONTRACT_AT : executionStartedAt;
  const contract = inventoryContractPayload();
  const content = {
    schemaVersion: 'afl-trade-valuation-bundle/v2' as const,
    environment: input.environment ?? ('non_production' as const),
    scopeKey: input.scopeKey ?? SCOPE_KEY,
    valueUnitId: input.valuationCase.content.valueUnitId,
    createdAt,
    components:
      input.components ??
      ([
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
      ] satisfies AflTradeValuationBundleManifestV2['content']['components']),
    viewContexts: input.valuationCase.content.viewContexts,
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
      draws: input.calculation.content.draws.length,
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
      startedAt: executionStartedAt,
      finishedAt: executionFinishedAt,
      sourceCodeArtifact: artifact('source-code', createdAt),
      dependencyLockArtifact: artifact('dependency-lock', createdAt),
      runtimeArtifact: artifact('runtime', createdAt),
      configurationArtifact: artifact('configuration', createdAt),
    },
    outputs: {
      immutableSnapshotsArtifact: artifact('snapshots', createdAt),
      simulationDrawsArtifact: artifact('draws', createdAt),
      attributionInvariantReportArtifact: artifact('attribution', createdAt),
      deterministicReplayReportArtifact: artifact('replay', createdAt),
      explanationParityReportArtifact: artifact('explanation-parity', createdAt),
      coverageAndExclusionReportArtifact: artifact('coverage', createdAt),
      confidenceReportArtifact: artifact('confidence', createdAt),
      sensitivityReportArtifact: artifact('sensitivity', createdAt),
      validationReportArtifact: artifact('validation', createdAt),
      modelCardArtifact: artifact('model-card', createdAt),
    },
    outputInventoryContract: {
      ...contract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(contract, contractCreatedAt),
    },
    limitations: ['Focused projection-parity fixture.'],
  };
  return aflTradeValuationBundleManifestV2Schema.parse({
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', content),
    content,
  });
}

function createBundle(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation
): AflTradeValuationBundleManifestV2 {
  return createAflTradeValuationBundleManifestFixture({ valuationCase, calculation });
}

function boundValuationFixture(
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap'
) {
  const source = createFabricatedAflTradeValuationFixture(fixtureKind);
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

function sourceArtifacts(
  createdAt: string = SOURCE_AT
): AflTradeProjectionEvidenceSourceArtifact[] {
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
      artifactRef: createAflTradeCanonicalJsonArtifactRef(sourceArtifact, createdAt),
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
  publication: AflTradePublicationManifest,
  inventoryIndexId: string,
  inventoryId: string,
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[],
  materializedAt: string,
  assessmentVerification?: ReturnType<typeof createAflTradeCompleteAssessmentVerificationFixture>
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
  const assessedAssetById = new Map(
    assessmentVerification?.output.content.partyAssessments.flatMap(({ receivedAssets }) =>
      receivedAssets.map((asset) => [asset.assetId, asset] as const)
    ) ?? []
  );
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
    scopeKey: publication.content.scopeKey,
    valueUnitId: fixture.valuationCase.content.valueUnitId,
    materializedAt,
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
      assetKind:
        assessedAssetById.get(rootAssetId)?.assetKind === 'pick'
          ? ('current_pick_entitlement' as const)
          : assessedAssetById.get(rootAssetId)?.assetKind === 'future_pick'
            ? ('future_pick_entitlement' as const)
            : ('player' as const),
      label: assessedAssetById.get(rootAssetId)?.displayLabel ?? `Fabricated player ${index + 1}`,
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

export interface AflTradeProjectionPipelineOverride {
  fixture: ReturnType<typeof boundValuationFixture>;
  assessmentVerification: ReturnType<typeof createAflTradeCompleteAssessmentVerificationFixture>;
  materializedAt: string;
  inventoryMaterializedAt?: string;
  freshnessDurationSeconds?: {
    current: number;
    stale: number;
  };
}

function buildVerifiedProjectionPipeline(
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap',
  custodyIndexVerification?: z.infer<typeof aflTradeValuationOutputCustodyIndexVerificationSchema>,
  override?: AflTradeProjectionPipelineOverride
) {
  const fixture = override?.fixture ?? boundValuationFixture(fixtureKind);
  const stageAt = override?.materializedAt;
  const sourceAt = override?.inventoryMaterializedAt ?? stageAt ?? SOURCE_AT;
  const bundleReferenceAt = override?.inventoryMaterializedAt ?? stageAt ?? BUNDLE_REF_AT;
  const inventoryAt = override?.inventoryMaterializedAt ?? stageAt ?? ROOT_AT;
  const indexAt = stageAt ?? INDEX_AT;
  const policyAt = stageAt ?? POLICY_AT;
  const publicationArtifactAt = stageAt ?? PUBLICATION_ARTIFACT_AT;
  const publicationAt = stageAt ?? PUBLICATION_AT;
  const evidenceAt = stageAt ?? EVIDENCE_AT;
  const evidenceIndexAt = stageAt ?? EVIDENCE_INDEX_AT;
  const verifiedAt = stageAt ?? VERIFIED_AT;
  const documentAt = stageAt ?? DOCUMENT_AT;
  const schemaAt = stageAt ?? SCHEMA_AT;
  const materializationShardAt = stageAt ?? MATERIALIZATION_SHARD_AT;
  const materializationRootAt = stageAt ?? MATERIALIZATION_ROOT_AT;
  const numeric = numericArtifacts(fixture);
  const explanation = createAflTradeStructuredExplanationV2({
    valuationBundleManifest: fixture.bundle,
    valuationCase: fixture.valuationCase,
    valuationCalculation: fixture.calculation,
    valuationDistributions: numeric.distributions,
    valuationComparisons: numeric.comparisons,
  });
  const bundleArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    fixture.bundle,
    bundleReferenceAt
  );
  const caseArtifactRef = createAflTradeCanonicalJsonArtifactRef(fixture.valuationCase, sourceAt);
  const valuationOutputInventoryInput = {
    valuationBundle: {
      valuationBundleManifest: fixture.bundle,
      artifactRef: bundleArtifactRef,
    },
    valuationCase: { valuationCase: fixture.valuationCase, artifactRef: caseArtifactRef },
    valuationCalculation: {
      valuationCalculation: fixture.calculation,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(fixture.calculation, sourceAt),
    },
    valuationDistributions: numeric.distributions.map((valuationDistribution) => ({
      valuationDistribution,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationDistribution, sourceAt),
    })),
    valuationComparisons: numeric.comparisons.map((valuationComparison) => ({
      valuationComparison,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationComparison, sourceAt),
    })),
    structuredExplanation: {
      structuredExplanation: explanation,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(explanation, sourceAt),
    },
    materializedAt: inventoryAt,
  };
  const inventory = createAflTradeValuationOutputInventory(valuationOutputInventoryInput);
  const valuationOutputInventoryVerification = {
    ...valuationOutputInventoryInput,
    output: inventory,
  };
  const completeTradeAssessmentVerification =
    override?.assessmentVerification ??
    createAflTradeCompleteAssessmentVerificationFixture(
      valuationOutputInventoryVerification,
      fixtureKind
    );
  const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
    valuationBundleManifest: fixture.bundle,
    valuationBundleArtifactRef: bundleArtifactRef,
    valuationOutputInventories: [
      {
        valuationOutputInventory: inventory.valuationOutputInventory,
        artifactRef: inventory.valuationOutputInventoryArtifactRef,
      },
    ],
    createdAt: indexAt,
  });
  const freshness = createAflTradeFreshnessPolicy({
    scopeKey: fixture.bundle.content.scopeKey,
    valueUnitId: fixture.bundle.content.valueUnitId,
    currentDurationSeconds: override?.freshnessDurationSeconds?.current ?? 86_400,
    staleServeDurationSeconds: override?.freshnessDurationSeconds?.stale ?? 86_400,
    createdAt: policyAt,
  });
  const projectionPresentationPolicy = createAflTradeProjectionPresentationPolicy({
    valueUnit: {
      id: fixture.bundle.content.valueUnitId,
      label: 'Fabricated football contribution',
      description: 'A fabricated cross-club football-contribution unit for parity tests.',
      direction: 'higher_is_better',
    },
    universalLayer: 'scarcity_adjusted',
    balancedMaximumLeaderMargin: fixtureKind === 'future_pick_resolution' ? 0.06 : 0.05,
    balancedMinimumPracticalEquivalenceProbability: 0.4,
    strongMinimumLeaderMargin: 0.2,
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
    createdAt: policyAt,
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
    environment: fixture.bundle.content.environment,
    scopeKey: fixture.bundle.content.scopeKey,
    createdAt: publicationAt,
    valuationBundleId: fixture.bundle.valuationBundleId,
    gate3DecisionId: fixture.bundle.content.components[0].gate3DecisionId,
    sourceRegisterIds: ['fixture-source-register'],
    supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
    supportedCohorts: ['fixture-supported-cohort'],
    excludedCohorts: [],
    valueUnitId: fixture.bundle.content.valueUnitId,
    entryCount: 1,
    publicationBundleArtifact: artifact('publication-bundle', publicationArtifactAt),
    methodologyArtifact: createAflTradeCanonicalJsonArtifactRef(
      methodologyPayload,
      publicationArtifactAt
    ),
    validationReportArtifact: artifact('publication-validation', publicationArtifactAt),
    modelCardArtifact: artifact('publication-model-card', publicationArtifactAt),
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
  const publicationCandidate = aflTradePublicationManifestV3Schema.parse({
    publicationId: createAflTradeContentAddress('publication', publicationContent),
    content: publicationContent,
  });
  const publication = custodyIndexVerification
    ? createAflTradeCustodiedPublicationManifest({
        publicationCandidate,
        custodyIndexVerification,
      })
    : {
        publicationManifest: publicationCandidate,
        artifactRef: createAflTradeCanonicalJsonArtifactRef(publicationCandidate, publicationAt),
      };
  const publicationManifest = publication.publicationManifest;
  const sources = sourceArtifacts(sourceAt);
  const evidence = createAflTradeProjectionPublicEvidence({
    content: realEvidenceContent(
      fixture,
      publicationManifest,
      inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      inventory.valuationOutputInventory.valuationOutputInventoryId,
      sources,
      evidenceAt,
      completeTradeAssessmentVerification
    ),
    materializedAt: evidenceAt,
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
    materializedAt: evidenceIndexAt,
  });
  const evidenceVerificationInput = {
    projectionPublicEvidenceResult: evidence,
    sourceArtifacts: sources,
    verifiedAt,
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
        artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationDistribution, sourceAt),
      })),
    selectedComparisons: numeric.comparisons
      .filter(({ content }) => content.measure.layer === 'scarcity_adjusted')
      .map((valuationComparison) => ({
        valuationComparison,
        artifactRef: createAflTradeCanonicalJsonArtifactRef(valuationComparison, sourceAt),
      })),
    projectionPublicEvidence: evidence,
    evidenceSourceVerification: {
      ...evidenceVerificationInput,
      output: createAflTradeProjectionEvidenceSourceVerification(evidenceVerificationInput),
    },
    ...(custodyIndexVerification
      ? {
          valuationOutputCustodyIndexVerification: custodyIndexVerification,
          completeTradeAssessmentVerification,
        }
      : {}),
    materializedAt: documentAt,
  };
  const tradeOutput = createAflTradeProjectionTradeMaterialization(tradeInput);
  const tradeVerification = { ...tradeInput, output: tradeOutput };
  const schemaCreatedAt =
    stageAt === undefined && fixtureKind === 'future_pick_resolution'
      ? '2026-08-05T06:30:01.000Z'
      : schemaAt;
  const projectionSchemaBundle = custodyIndexVerification
    ? createAflTradeProjectionSchemaBundleV2({ createdAt: schemaCreatedAt })
    : createAflTradeProjectionSchemaBundle({ createdAt: schemaCreatedAt });
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
    materializedAt: materializationShardAt,
  };
  const shardOutput = createAflTradeProjectionMaterializationShard(shardInput);
  const rootInput = {
    ...commonParents,
    projectionMaterializationShardVerifications: [{ ...shardInput, output: shardOutput }],
    materializedAt: materializationRootAt,
  };
  const rootOutput = createAflTradeProjectionMaterialization(rootInput);
  const projectionMaterializationVerification = { ...rootInput, output: rootOutput };
  return {
    fixture,
    valuationOutputInventoryVerification,
    publicationManifest,
    inventoryIndex,
    freshness,
    projectionPresentationPolicy,
    projectionPublicEvidenceIndex,
    projectionSchemaBundle,
    methodologyPayload,
    tradeOutput,
    rootOutput,
    projectionMaterializationVerification,
    methodologyAt: stageAt ?? METHODOLOGY_AT,
    documentSetAt: stageAt ?? SET_AT,
    checkedAt: stageAt ?? CHECKED_AT,
  };
}

/** Fabricated Stage-5 verification envelope for immutable-custody tests only. */
export function createAflTradeValuationOutputInventoryVerificationFixture(
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap'
) {
  return buildVerifiedProjectionPipeline(fixtureKind).valuationOutputInventoryVerification;
}

export function createAflTradeValuationProjectionPipelineFixture(
  override: AflTradeProjectionPipelineOverride,
  custodyIndexVerification?: z.infer<typeof aflTradeValuationOutputCustodyIndexVerificationSchema>
) {
  return buildVerifiedProjectionPipeline(
    'two_party_player_swap',
    custodyIndexVerification,
    override
  );
}

function durableCustodyFixtureRepository() {
  const delegate = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  return {
    ...delegate,
    assurance: 'durable_object_storage' as const,
    custodyProfile: createAflTradeArtifactCustodyProfile({
      schemaVersion: 'afl-trade-artifact-custody-profile/v1',
      subject: 'afl-trade-intelligence',
      contractRole: 'requirements_only_not_readiness_or_authorization',
      repositoryId: 'projection-custody-fixture',
      environment: 'non_production',
      artifactClass: 'derived_private',
      maximumObjectBytes: 128 * 1024 * 1024,
      keyDerivation: 'profile_sha256_two_level_fanout_v1',
      conditionalCreate: 'if_none_match_star_required',
      encryption: {
        inTransit: 'tls_required',
        atRest: { mode: 'customer_managed', keyReferenceSha256: 'a'.repeat(64) },
      },
      retention: {
        deletion: {
          kind: 'no_scheduled_deletion',
          maximumDays: null,
          enforcement: 'not_applicable',
        },
        deleteOnWithdrawal: false,
        worm: { mode: 'compliance', minimumDays: 365 },
      },
      residency: {
        allowedJurisdictions: ['Australia'],
        crossJurisdictionTransfer: 'prohibited',
      },
      infrastructureEvidenceIds: [`storage-policy:${'b'.repeat(64)}`],
    }),
  };
}

export async function createAflTradeValuationOutputCustodyIndexVerificationFixture(
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap'
) {
  const verification = createAflTradeValuationOutputInventoryVerificationFixture(fixtureKind);
  const assessmentVerification = createAflTradeCompleteAssessmentVerificationFixture(
    verification,
    fixtureKind
  );
  const inventory = {
    valuationOutputInventory: verification.output.valuationOutputInventory,
    artifactRef: verification.output.valuationOutputInventoryArtifactRef,
  };
  const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
    valuationBundleManifest: verification.valuationBundle.valuationBundleManifest,
    valuationBundleArtifactRef: verification.valuationBundle.artifactRef,
    valuationOutputInventories: [inventory],
    createdAt: INDEX_AT,
  });
  const custody = await persistAflTradeValuationOutputInventory(
    { verification, assessmentVerification },
    {
      repository: durableCustodyFixtureRepository(),
      operationAuthority: {
        async acquire(scope) {
          const content = {
            schemaVersion: 'afl-trade-valuation-output-custody-operation/v1' as const,
            ...scope,
            verifiedAt: CUSTODY_AT,
          };
          return {
            operationId: createAflTradeContentAddress(
              'valuation-output-custody-operation',
              content
            ),
            content,
          };
        },
        async complete() {},
      },
    }
  );
  const request = {
    inventoryIndexVerification: {
      valuationBundleManifest: verification.valuationBundle.valuationBundleManifest,
      valuationBundleArtifactRef: verification.valuationBundle.artifactRef,
      valuationOutputInventories: [inventory],
      output: inventoryIndex,
    },
    custodyReceipts: [custody],
    createdAt: CUSTODY_INDEX_AT,
  };
  return { ...request, output: createAflTradeValuationOutputCustodyIndex(request) };
}

/**
 * Fabricated test evidence only. This fixture proves deterministic contract wiring and does not
 * claim source approval, real-AFL provenance, publication activation, or serving authority.
 */
export interface AflTradeProjectionManifestFixture {
  identity: FixtureIdentity;
  tradeIds: string[];
  projectionPresentationPolicy: AflTradeProjectionPresentationPolicyResult;
  projectionPublicEvidenceIndex: AflTradeProjectionPublicEvidenceIndexResult;
  projectionSchemaBundle: AflTradeAnyProjectionSchemaBundleResult;
  projectionDocumentSet: AflTradeProjectionDocumentSetResult;
  projectionDocumentSetVerification: AflTradeProjectionParityCreateInput['projectionDocumentSetVerification'];
  documents: AflTradeProjectionDocumentArtifact[];
  input: AflTradeProjectionParityCreateInput;
  freshnessPolicyResult: AflTradeFreshnessPolicyResult;
  projectionParityVerification: AflTradeProjectionParityVerifyInput;
}

function createProjectionManifestFixtureFromPipeline(
  pipeline: ReturnType<typeof buildVerifiedProjectionPipeline>
): AflTradeProjectionManifestFixture {
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
    materializedAt: pipeline.methodologyAt,
  });
  const documents = [...pipeline.tradeOutput.projectionDocuments, methodologyDocument];
  const documentSetInput = {
    publicationManifest: pipeline.publicationManifest,
    valuationOutputInventoryIndex: pipeline.inventoryIndex.valuationOutputInventoryIndex,
    valuationOutputInventoryIndexArtifactRef:
      pipeline.inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    projectionMaterializationVerification: pipeline.projectionMaterializationVerification,
    projectionDocuments: documents,
    materializedAt: pipeline.documentSetAt,
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
    checkedAt: pipeline.checkedAt,
  };
  const parityOutput = createAflTradeProjectionParityReport(input);
  const projectionParityVerification = { ...input, output: parityOutput };
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
    freshnessPolicyResult: pipeline.freshness,
    projectionParityVerification,
  };
}

export function createAflTradeProjectionManifestFixture(
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap'
): AflTradeProjectionManifestFixture {
  return createProjectionManifestFixtureFromPipeline(buildVerifiedProjectionPipeline(fixtureKind));
}

export function createAflTradeCustodiedProjectionManifestFixture(
  custodyIndexVerification: z.infer<typeof aflTradeValuationOutputCustodyIndexVerificationSchema>,
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap'
): AflTradeProjectionManifestFixture {
  const pipeline = buildVerifiedProjectionPipeline(fixtureKind, custodyIndexVerification);
  return createProjectionManifestFixtureFromPipeline(pipeline);
}

export function createAflTradeCustodiedProjectionManifestFixtureFromValuation(
  override: AflTradeProjectionPipelineOverride,
  custodyIndexVerification: z.infer<typeof aflTradeValuationOutputCustodyIndexVerificationSchema>
): AflTradeProjectionManifestFixture {
  return createProjectionManifestFixtureFromPipeline(
    buildVerifiedProjectionPipeline('two_party_player_swap', custodyIndexVerification, override)
  );
}
export function createAflTradeProjectionManifestMaterializationInput(
  fixture: AflTradeProjectionManifestFixture
): AflTradeProjectionManifestMaterializationCreateInput {
  return {
    buildJobId: 'projection-manifest-build:fixture',
    freshnessPolicyResult: fixture.freshnessPolicyResult,
    projectionParityVerification: fixture.projectionParityVerification,
  };
}
import { z } from 'zod';
