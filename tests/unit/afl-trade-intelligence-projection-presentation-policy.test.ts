// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_DEFINITION,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION,
  createAflTradeProjectionEvidenceSourceVerification,
  verifyAflTradeProjectionEvidenceSourceVerification,
  type AflTradeProjectionEvidenceSourceArtifact,
  type AflTradeProjectionEvidenceSourceVerificationResult,
} from '@/server/aflTradeIntelligence/publication/projectionEvidenceSourceVerification';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  createAflTradeProjectionPublicEvidence,
  type AflTradeProjectionPublicEvidenceContent,
  type AflTradeProjectionPublicEvidenceResult,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidence';
import {
  AFL_TRADE_PROJECTION_PRESENTATION_DISTRIBUTION_SUBJECT_KINDS,
  AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_ASSESSMENT_DEFINITION,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_COMPARISON_BASIS,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_CONSTRUCTION_ERROR_CODES,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DEDUPLICATION,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_EVIDENCE,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DTO_SEMANTICS,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_ORDERING,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FIRST_FAILURE_PRECEDENCE,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MISSING_FACTOR_EVIDENCE,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_NUMERICAL_PUBLICATION,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PARTIAL_TREATMENT,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_ASSET_FACTOR_TREATMENT,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_CLUB_FACTOR_TREATMENT,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_UNAVAILABLE_TREATMENT,
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_WARNING_REASON_MAPPING,
  AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES,
  AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_DEFINITION,
  AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_ORDERING,
  AFL_TRADE_PROJECTION_PRESENTATION_UNIVERSAL_LAYERS,
  AflTradeProjectionPresentationPolicyConstructionError,
  aflTradeProjectionAssessmentEvaluationInputSchema,
  aflTradeProjectionFactorEvidenceInputSchema,
  aflTradeProjectionFailClosedInputSchema,
  aflTradeProjectionPublicationEligibilityInputSchema,
  aflTradeProjectionPublicationEligibilityResultSchema,
  aflTradeProjectionPublicFactorSelectionResultSchema,
  aflTradeProjectionPresentationPolicyContentSchema,
  aflTradeProjectionPresentationPolicyResultSchema,
  aflTradeProjectionUncertaintyComponentSelectionResultSchema,
  createAflTradeProjectionFailClosedValue,
  createAflTradeProjectionPresentationPolicy,
  evaluateAflTradeProjectionAssessment,
  evaluateAflTradeProjectionPublicationEligibility,
  isAflTradeProjectionPresentationPolicyConstructionError,
  selectAflTradeProjectionPublicFactors,
  selectAflTradeProjectionUncertaintyComponents,
  verifyAflTradeProjectionPresentationPolicyDerivation,
  type AflTradeProjectionPresentationPolicy,
  type AflTradeProjectionPresentationPolicyConstructionErrorCode,
  type AflTradeProjectionPresentationPolicyCreateInput,
  type AflTradeProjectionPresentationPolicyResult,
} from '@/server/aflTradeIntelligence/publication/projectionPresentationPolicy';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import type { AflTradeJointOutcomeProbabilities } from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparison';
import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_VALUATION_VIEWS,
  type AflTradeTemporalContext,
} from '@/types/aflTradeIntelligence';

const CREATED_AT = '2026-08-06T00:00:00.000Z';
const SOURCE_AT = '2026-08-05T00:00:00.000Z';
const VERIFIED_AT = '2026-08-07T00:00:00.000Z';
const METHODOLOGY_HREF = '/draft/trades/methodology';
const VALUE_UNIT = {
  id: 'statly-football-value-v1',
  label: 'Statly football value',
  description: 'A governed source-native AFL football-contribution value unit.',
  direction: 'higher_is_better' as const,
};

const TEMPORAL_CONTEXT: AflTradeTemporalContext = {
  effectiveAt: SOURCE_AT,
  knowledgeCutoffAt: SOURCE_AT,
  valuationAsOf: SOURCE_AT,
};

function fixtureId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function evidenceSourceBinding<
  const Role extends 'confidence' | 'coverage' | 'asset_identity' | 'lineage_frontier' | 'factor',
>(sourceRole: Role, label: string) {
  const source = evidenceSourceArtifact(label);
  return {
    sourceRole,
    sourceSchemaVersion: source.sourceSchemaVersion,
    semanticArtifactId: source.semanticArtifactId,
    artifactRef: source.artifactRef,
    recordLocator: `record:${label}`,
    fieldPath: '/claim',
    claimedValueSha256: sha256AflTradeCanonicalJson({ claim: label }),
    sourceEffectiveAt: SOURCE_AT,
    sourceKnownAt: SOURCE_AT,
  };
}

function evidenceSourceArtifact(label: string): AflTradeProjectionEvidenceSourceArtifact {
  const semanticArtifactId = fixtureId('source-fixture', label);
  const sourceArtifact = {
    sourceArtifactId: semanticArtifactId,
    content: {
      schemaVersion: 'afl-trade-source-fixture/v1',
      records: [{ locator: `record:${label}`, claim: { claim: label } }],
    },
  };
  return {
    sourceSchemaVersion: 'afl-trade-source-fixture/v1',
    semanticArtifactId,
    sourceArtifact,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(sourceArtifact, SOURCE_AT),
  };
}

function publicEvidenceContent(): AflTradeProjectionPublicEvidenceContent {
  const viewContexts = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXT,
  }));
  return {
    schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
    publicationId: fixtureId('publication', 'presentation-policy'),
    valuationBundleId: fixtureId('valuation-bundle', 'presentation-policy'),
    valuationOutputInventoryIndexId: fixtureId(
      'valuation-output-inventory-index',
      'presentation-policy'
    ),
    valuationOutputInventoryId: fixtureId('valuation-output-inventory', 'presentation-policy'),
    valuationCaseId: fixtureId('valuation-case', 'presentation-policy'),
    valuationCalculationId: fixtureId('valuation-calculation', 'presentation-policy'),
    tradeId: 'trade:presentation-policy',
    scopeKey: 'scope:presentation-policy',
    valueUnitId: 'football-value:v1',
    materializedAt: CREATED_AT,
    viewContexts,
    confidenceByView: AFL_TRADE_VALUATION_VIEWS.map((view) => ({
      view,
      temporalContext: TEMPORAL_CONTEXT,
      overallLevel: 'high' as const,
      dimensions: AFL_TRADE_CONFIDENCE_DIMENSIONS.map((dimension) => ({
        dimension,
        level: 'high' as const,
        reasonCode: `verified:${dimension}`,
        explanation: `Direct evidence supports ${dimension}.`,
        sourceBindings: [evidenceSourceBinding('confidence', `confidence:${view}:${dimension}`)],
      })),
    })),
    coverageByView: AFL_TRADE_VALUATION_VIEWS.map((view) => ({
      view,
      temporalContext: TEMPORAL_CONTEXT,
      status: 'complete' as const,
      totalAssetCount: 1,
      valuedAssetCount: 1,
      excludedAssetCount: 0 as const,
      excludedRoots: [],
      sourceBindings: [evidenceSourceBinding('coverage', `coverage:${view}`)],
    })),
    assets: [
      {
        assetId: 'asset:player',
        assetKind: 'player',
        label: 'AFL player',
        receivedByAflClubId: 'afl-club:alpha',
        identitySourceBindings: [evidenceSourceBinding('asset_identity', 'asset:player')],
        lineage: {
          status: 'resolved',
          rootAssetId: 'asset:player',
          creditedAssetIds: ['asset:player'],
          summary: 'The source-native AFL asset lineage is resolved.',
          edgeCount: 0,
          maximumDepth: 0,
          sourceBindings: [evidenceSourceBinding('lineage_frontier', 'asset:player')],
        },
      },
    ],
    factorsByView: AFL_TRADE_VALUATION_VIEWS.map((view) => ({
      view,
      temporalContext: TEMPORAL_CONTEXT,
      factors: [],
    })),
    predecessorPolicy: {
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
    },
    limitation: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  };
}

function publicEvidenceResult(materializedAt = CREATED_AT): AflTradeProjectionPublicEvidenceResult {
  const content = { ...publicEvidenceContent(), materializedAt };
  return createAflTradeProjectionPublicEvidence({ content, materializedAt });
}

type FixtureView = (typeof AFL_TRADE_VALUATION_VIEWS)[number];
type FixtureFactor =
  AflTradeProjectionPublicEvidenceContent['factorsByView'][number]['factors'][number];

function publicEvidenceResultWithFactors(
  factorsByView: Partial<Record<FixtureView, readonly FixtureFactor[]>>,
  materializedAt = CREATED_AT
): AflTradeProjectionPublicEvidenceResult {
  const content = publicEvidenceContent();
  content.materializedAt = materializedAt;
  content.factorsByView = content.factorsByView.map((factorView) => ({
    ...factorView,
    factors: [...(factorsByView[factorView.view] ?? [])],
  }));
  return createAflTradeProjectionPublicEvidence({ content, materializedAt });
}

function sourceArtifactsForEvidence(
  evidenceResult: AflTradeProjectionPublicEvidenceResult
): AflTradeProjectionEvidenceSourceArtifact[] {
  const content = evidenceResult.projectionPublicEvidence.content;
  const bindings = [
    ...content.confidenceByView.flatMap(({ dimensions }) =>
      dimensions.flatMap(({ sourceBindings }) => sourceBindings)
    ),
    ...content.coverageByView.flatMap(({ sourceBindings }) => sourceBindings),
    ...content.assets.flatMap(({ identitySourceBindings, lineage }) => [
      ...identitySourceBindings,
      ...lineage.sourceBindings,
    ]),
    ...content.factorsByView.flatMap(({ factors }) =>
      factors.flatMap(({ sourceBindings }) => sourceBindings)
    ),
  ];
  const sourceById = new Map<string, AflTradeProjectionEvidenceSourceArtifact>();
  for (const binding of bindings) {
    const label = binding.recordLocator.replace(/^record:/, '');
    sourceById.set(binding.semanticArtifactId, evidenceSourceArtifact(label));
  }
  return [...sourceById.values()];
}

function sourceVerificationReplay(
  evidenceResult: AflTradeProjectionPublicEvidenceResult,
  status: 'passed' | 'failed' = 'passed',
  verifiedAt = VERIFIED_AT
) {
  const completeSources = sourceArtifactsForEvidence(evidenceResult);
  const sourceArtifacts = status === 'passed' ? completeSources : completeSources.slice(1);
  const output = createAflTradeProjectionEvidenceSourceVerification({
    projectionPublicEvidenceResult: evidenceResult,
    sourceArtifacts,
    verifiedAt,
  });
  if (
    !verifyAflTradeProjectionEvidenceSourceVerification({
      projectionPublicEvidenceResult: evidenceResult,
      sourceArtifacts,
      verifiedAt,
      output,
    })
  ) {
    throw new Error('The source-verification fixture must replay exactly.');
  }
  return { sourceArtifacts, verifiedAt, output };
}

function syntheticSourceVerificationResult(
  evidenceResult: AflTradeProjectionPublicEvidenceResult,
  status: 'passed' | 'failed' = 'passed',
  verifiedAt = VERIFIED_AT
): AflTradeProjectionEvidenceSourceVerificationResult {
  const evidence = evidenceResult.projectionPublicEvidence;
  const observedFailureCount = status === 'passed' ? 0 : 1;
  const content = {
    schemaVersion: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
    projectionPublicEvidence: {
      schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
      projectionPublicEvidenceId: evidence.projectionPublicEvidenceId,
      artifactRef: evidenceResult.projectionPublicEvidenceArtifactRef,
    },
    verificationDefinition: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_DEFINITION,
    status,
    sourceArtifactCount: 1,
    totalSourceArtifactByteLength: 1,
    sourceArtifactSetDigestDefinition: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION,
    sourceArtifactSetSha256: sha256AflTradeCanonicalJson({ fixture: 'source-set' }),
    bindingCount: 1,
    roleBindingCounts: {
      confidence: 1,
      coverage: 0,
      asset_identity: 0,
      lineage_frontier: 0,
      factor: 0,
    },
    checkCount: 1,
    observedFailureCount,
    reportedFailureCount: observedFailureCount,
    failuresTruncated: false,
    failures:
      status === 'passed'
        ? []
        : [
            {
              code: 'SOURCE_MISSING' as const,
              sourceRole: 'confidence' as const,
              semanticArtifactId: fixtureId('source-fixture', 'missing'),
              message: 'A public-evidence source binding has no supplied source artifact.',
            },
          ],
    verifiedAt,
    limitation: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION,
  };
  const projectionEvidenceSourceVerification = {
    projectionEvidenceSourceVerificationId: createAflTradeContentAddress(
      'projection-evidence-source-verification',
      content
    ),
    content,
  };
  return {
    projectionEvidenceSourceVerification,
    projectionEvidenceSourceVerificationArtifactRef: createAflTradeCanonicalJsonArtifactRef(
      projectionEvidenceSourceVerification,
      verifiedAt
    ),
  };
}

function eligibilityFacts(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    assetCoverageComplete: true,
    identityEvidenceResolved: true,
    lineageAttributionResolved: true,
    packageDistributionComplete: true,
    rootDistributionComplete: true,
    selectedComparisonAvailable: true,
    ...overrides,
  };
}

function factorSourceBinding(label: string) {
  return evidenceSourceBinding('factor', label);
}

function createInput(
  overrides: Partial<AflTradeProjectionPresentationPolicyCreateInput> = {}
): AflTradeProjectionPresentationPolicyCreateInput {
  return {
    valueUnit: VALUE_UNIT,
    universalLayer: 'scarcity_adjusted',
    balancedMaximumLeaderMargin: 0.05,
    balancedMinimumPracticalEquivalenceProbability: 0.4,
    strongMinimumLeaderMargin: 0.2,
    methodologyHref: METHODOLOGY_HREF,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function createPolicy(
  overrides: Partial<AflTradeProjectionPresentationPolicyCreateInput> = {}
): AflTradeProjectionPresentationPolicyResult {
  return createAflTradeProjectionPresentationPolicy(createInput(overrides));
}

function comparison(
  first: number,
  second: number,
  practicalEquivalence: number,
  firstClub = 'club:a',
  secondClub = 'club:b'
): AflTradeJointOutcomeProbabilities {
  return {
    clubClearLeaderProbabilities: [
      { aflClubId: firstClub, probability: first },
      { aflClubId: secondClub, probability: second },
    ].sort((left, right) => (left.aflClubId < right.aflClubId ? -1 : 1)),
    noClearLeaderProbability: practicalEquivalence,
  };
}

function assess(
  probabilities: AflTradeJointOutcomeProbabilities,
  policy: AflTradeProjectionPresentationPolicy = createPolicy().projectionPresentationPolicy
) {
  return evaluateAflTradeProjectionAssessment({ policy, comparisonProbabilities: probabilities });
}

function expectPolicyError(
  action: () => unknown,
  code: AflTradeProjectionPresentationPolicyConstructionErrorCode
): AflTradeProjectionPresentationPolicyConstructionError {
  try {
    action();
  } catch (error) {
    expect(isAflTradeProjectionPresentationPolicyConstructionError(error)).toBe(true);
    expect(error).toBeInstanceOf(AflTradeProjectionPresentationPolicyConstructionError);
    expect(error).toMatchObject({ code });
    return error as AflTradeProjectionPresentationPolicyConstructionError;
  }
  throw new Error(`Expected projection presentation-policy error ${code}.`);
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested, seen);
}

function collectKeys(value: unknown, keys = new Set<string>(), seen = new WeakSet<object>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key);
    collectKeys(nested, keys, seen);
  }
  return keys;
}

describe('AFL trade-intelligence projection presentation policy', () => {
  it('creates one deterministic frozen content-addressed canonical artifact', () => {
    const first = createPolicy();
    const second = createPolicy();
    const policy = first.projectionPresentationPolicy;
    const reference = first.projectionPresentationPolicyArtifactRef;

    expect(first).toEqual(second);
    expect(aflTradeProjectionPresentationPolicyResultSchema.safeParse(first).success).toBe(true);
    expect(policy.projectionPresentationPolicyId).toBe(
      createAflTradeContentAddress('projection-presentation-policy', policy.content)
    );
    expect(policy.projectionPresentationPolicyId).toBe(
      'projection-presentation-policy:184904e2bbcf939b6f66c79bb395e4076339996b24e9fa71f39b0236fc9820d9'
    );
    expect(reference.artifactId).toBe(
      'artifact:2732f04029ed3ef90eb2ffde72aa9b72d38a5fed6d71c2a406709fc8601b910f'
    );
    expect(doesAflTradeArtifactRefMatchCanonicalJson(reference, policy)).toBe(true);
    expect(reference).toMatchObject({ mediaType: 'application/json', createdAt: CREATED_AT });
    expect(reference.byteLength).toBeGreaterThan(0);
    expect(reference.byteLength).toBeLessThanOrEqual(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES
    );
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES).toBe(64 * 1024);
    expectDeepFrozen(first);
  });

  it('pins package and root distributions and comparisons to one selected layer for every view', () => {
    for (const universalLayer of AFL_TRADE_PROJECTION_PRESENTATION_UNIVERSAL_LAYERS) {
      const content = createPolicy({ universalLayer }).projectionPresentationPolicy.content;
      expect(content.selectedCoordinates).toEqual({
        distributions: {
          views: ['at_trade', 'realized', 'remaining', 'current'],
          subjectKinds: AFL_TRADE_PROJECTION_PRESENTATION_DISTRIBUTION_SUBJECT_KINDS,
          measure: { kind: 'universal_football_value', layer: universalLayer },
        },
        comparisons: {
          views: ['at_trade', 'realized', 'remaining', 'current'],
          measure: { kind: 'universal_football_value', layer: universalLayer },
        },
      });
    }

    const drift = structuredClone(createPolicy().projectionPresentationPolicy.content);
    drift.selectedCoordinates.comparisons.measure.layer = 'gross';
    expect(aflTradeProjectionPresentationPolicyContentSchema.safeParse(drift).success).toBe(false);
  });

  it('binds mean, P10, median, P90, interval and event values to complete structural statistics', () => {
    const summary = createPolicy().projectionPresentationPolicy.content.distributionSummary;
    expect(summary).toEqual({
      estimateStatistic: 'mean',
      downsideQuantile: 0.1,
      medianQuantile: 0.5,
      upsideQuantile: 0.9,
      centralIntervalLevel: 0.8,
      completeStatisticsSource: {
        structuralDistributionSchemaVersion:
          AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
        requiredStatus: 'complete',
        quantileDefinitionVersion:
          AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
        estimatePath: 'content.distribution.statistics.mean',
        medianPath: 'content.distribution.statistics.median',
        centralIntervalPath: 'content.distribution.statistics.centralInterval',
        downsidePath: 'content.distribution.statistics.downside',
        upsidePath: 'content.distribution.statistics.upside',
        lowReturnProbabilityPath: 'content.distribution.eventProbabilities.lowReturnProbability',
        eliteOutcomeProbabilityPath:
          'content.distribution.eventProbabilities.eliteOutcomeProbability',
      },
    });
  });

  it('pins complete-only predicates, closed causes, methodology and non-fallback semantics', () => {
    const content = createPolicy().projectionPresentationPolicy.content;
    expect(content).toMatchObject({
      schemaVersion: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PUBLIC_ASSET_BOUNDARY,
      valueUnit: VALUE_UNIT,
      supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
      warningReasonMappingDefinition:
        AFL_TRADE_PROJECTION_PRESENTATION_POLICY_WARNING_REASON_MAPPING,
      methodologyHref: METHODOLOGY_HREF,
      numericalPublication: {
        requirement: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_NUMERICAL_PUBLICATION,
        partialTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PARTIAL_TREATMENT,
        unavailableTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_UNAVAILABLE_TREATMENT,
        comparisonBasis: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_COMPARISON_BASIS,
        firstFailurePrecedence: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FIRST_FAILURE_PRECEDENCE,
      },
      predecessorPolicy: {
        predecessorSchemaVersion: null,
        compatibility: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PREDECESSOR_COMPATIBILITY,
        runtimeFallback: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_RUNTIME_FALLBACK,
      },
      limitation: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION,
    });
    expect(content.numericalPublication.requiredPredicates).toEqual(
      AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.map((predicate) => ({
        ...predicate,
        appliesToViews: ['at_trade', 'realized', 'remaining', 'current'],
      }))
    );
    expect(content.numericalPublication.failClosedMappings.map(({ cause }) => cause)).toEqual(
      AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES
    );
    expect(content.numericalPublication.failClosedMappings).toHaveLength(7);
    expect(content.numericalPublication.failClosedMappings.length).toBeLessThanOrEqual(20);
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_RUNTIME_FALLBACK).toBe('prohibited');
  });

  it('enforces threshold domains, ordering, fixed methodology route and strict creator fields', () => {
    expectPolicyError(
      () => createPolicy({ balancedMaximumLeaderMargin: -0.001 }),
      'INVALID_BALANCED_MAXIMUM_LEADER_MARGIN'
    );
    expectPolicyError(
      () => createPolicy({ balancedMaximumLeaderMargin: 1.001 }),
      'INVALID_BALANCED_MAXIMUM_LEADER_MARGIN'
    );
    for (const threshold of [0, 1]) {
      expectPolicyError(
        () => createPolicy({ balancedMinimumPracticalEquivalenceProbability: threshold }),
        'INVALID_BALANCED_MINIMUM_PRACTICAL_EQUIVALENCE_PROBABILITY'
      );
    }
    expectPolicyError(
      () => createPolicy({ strongMinimumLeaderMargin: 1.001 }),
      'INVALID_STRONG_MINIMUM_LEADER_MARGIN'
    );
    for (const strongMinimumLeaderMargin of [0.05, 0.049]) {
      expectPolicyError(
        () => createPolicy({ strongMinimumLeaderMargin }),
        'INVALID_ASSESSMENT_THRESHOLDS'
      );
    }
    expectPolicyError(
      () => createPolicy({ methodologyHref: '/draft/trades/methodology/other' as never }),
      'INVALID_METHODOLOGY_HREF'
    );
    expectPolicyError(
      () => createPolicy({ universalLayer: 'club_utility' as never }),
      'INVALID_UNIVERSAL_LAYER'
    );
    expectPolicyError(() => createPolicy({ createdAt: 'not-a-date' }), 'INVALID_CREATED_AT');
  });

  it('enforces exact creator and verifier envelopes and rejects artifact tampering', () => {
    const valid = createInput();
    const { createdAt: _createdAt, ...missing } = valid;
    for (const candidate of [
      null,
      [],
      missing,
      { ...valid, unexpected: true },
      { ...valid, [Symbol('unexpected')]: true },
    ]) {
      expectPolicyError(
        () => createAflTradeProjectionPresentationPolicy(candidate),
        'INVALID_INPUT_ENVELOPE'
      );
    }

    const output = createPolicy();
    expect(verifyAflTradeProjectionPresentationPolicyDerivation({ ...valid, output })).toBe(true);
    expect(
      verifyAflTradeProjectionPresentationPolicyDerivation({ ...valid, output, unexpected: true })
    ).toBe(false);
    expect(
      verifyAflTradeProjectionPresentationPolicyDerivation({
        ...valid,
        balancedMaximumLeaderMargin: 0.04,
        output,
      })
    ).toBe(false);

    const contentDrift = structuredClone(output);
    contentDrift.projectionPresentationPolicy.content.universalLayer = 'gross';
    expect(aflTradeProjectionPresentationPolicyResultSchema.safeParse(contentDrift).success).toBe(
      false
    );
    expect(
      verifyAflTradeProjectionPresentationPolicyDerivation({ ...valid, output: contentDrift })
    ).toBe(false);

    const sizeDrift = structuredClone(output);
    sizeDrift.projectionPresentationPolicyArtifactRef.byteLength =
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_BYTES + 1;
    expect(aflTradeProjectionPresentationPolicyResultSchema.safeParse(sizeDrift).success).toBe(
      false
    );
  });

  it('contains hostile creator inputs, reads getters once, and trusts only issued errors', () => {
    const throwingGetter = Object.defineProperty(createInput(), 'createdAt', {
      enumerable: true,
      get() {
        throw new Error('private getter detail');
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private proxy detail');
        },
      }
    );
    const revoked = Proxy.revocable(createInput(), {});
    revoked.revoke();
    for (const candidate of [throwingGetter, throwingProxy, revoked.proxy]) {
      expectPolicyError(
        () => createAflTradeProjectionPresentationPolicy(candidate),
        'INVALID_INPUT_ENVELOPE'
      );
    }

    let reads = 0;
    const singleRead = Object.defineProperty(createInput(), 'createdAt', {
      enumerable: true,
      get() {
        reads += 1;
        return CREATED_AT;
      },
    });
    expect(createAflTradeProjectionPresentationPolicy(singleRead)).toEqual(createPolicy());
    expect(reads).toBe(1);

    const issued = expectPolicyError(
      () => createPolicy({ universalLayer: 'invalid' as never }),
      'INVALID_UNIVERSAL_LAYER'
    );
    expect(Object.isFrozen(issued)).toBe(true);
    expect(Object.isFrozen(issued.toJSON())).toBe(true);
    expect(isAflTradeProjectionPresentationPolicyConstructionError(issued.toJSON())).toBe(false);
    expect(
      isAflTradeProjectionPresentationPolicyConstructionError({
        name: issued.name,
        code: issued.code,
        message: issued.message,
      })
    ).toBe(false);
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_CONSTRUCTION_ERROR_CODES).toContain(
      issued.code
    );
  });

  it('classifies exact practical-equivalence and leader-margin boundaries as balanced', () => {
    const atEquivalenceThreshold = assess(comparison(0.35, 0.25, 0.4));
    const atMarginThreshold = assess(comparison(0.5, 0.45, 0.05));

    for (const assessment of [atEquivalenceThreshold, atMarginThreshold]) {
      expect(assessment).toEqual({
        interpretation: 'balanced_within_uncertainty',
        favouredAflClubId: null,
        scope: 'complete_trade',
      });
      expectDeepFrozen(assessment);
    }
  });

  it('uses ordered strong and ordinary lean rules at their exact boundaries', () => {
    const strong = assess(
      comparison(0.625, 0.375, 0),
      createPolicy({ strongMinimumLeaderMargin: 0.25 }).projectionPresentationPolicy
    );
    const lean = assess(comparison(0.575, 0.425, 0));

    expect(strong).toEqual({
      interpretation: 'strongly_leans_to_club',
      favouredAflClubId: 'club:a',
      scope: 'complete_trade',
    });
    expect(lean).toEqual({
      interpretation: 'leans_to_club',
      favouredAflClubId: 'club:a',
      scope: 'complete_trade',
    });
    expect(createPolicy().projectionPresentationPolicy.content.assessment.definitionVersion).toBe(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_ASSESSMENT_DEFINITION
    );
  });

  it('treats tied leaders as balanced and selects the unique highest-probability club', () => {
    expect(assess(comparison(0.45, 0.45, 0.1))).toEqual({
      interpretation: 'balanced_within_uncertainty',
      favouredAflClubId: null,
      scope: 'complete_trade',
    });

    const uniqueLeader = assess({
      clubClearLeaderProbabilities: [
        { aflClubId: 'club:a', probability: 0.6 },
        { aflClubId: 'club:z', probability: 0.3 },
      ],
      noClearLeaderProbability: 0.1,
    });
    expect(uniqueLeader.favouredAflClubId).toBe('club:a');
  });

  it('rejects malformed, non-exact and hostile assessment inputs with stable errors', () => {
    const policy = createPolicy().projectionPresentationPolicy;
    const validComparison = comparison(0.6, 0.3, 0.1);
    expect(
      aflTradeProjectionAssessmentEvaluationInputSchema.safeParse({
        policy,
        comparisonProbabilities: validComparison,
      }).success
    ).toBe(true);
    expectPolicyError(
      () =>
        evaluateAflTradeProjectionAssessment({
          policy,
          comparisonProbabilities: validComparison,
          unexpected: true,
        }),
      'INVALID_ASSESSMENT_INPUT_ENVELOPE'
    );
    expectPolicyError(
      () =>
        evaluateAflTradeProjectionAssessment({
          policy,
          comparisonProbabilities: comparison(0.6, 0.3, 0.2),
        }),
      'INVALID_COMPARISON_PROBABILITIES'
    );
    const revoked = Proxy.revocable({ policy, comparisonProbabilities: validComparison }, {});
    revoked.revoke();
    expectPolicyError(
      () => evaluateAflTradeProjectionAssessment(revoked.proxy),
      'INVALID_ASSESSMENT_INPUT_ENVELOPE'
    );
  });

  it('maps every closed cause to one valid non-value result and rejects unknown causes internally', () => {
    const policy = createPolicy().projectionPresentationPolicy;
    const expected = {
      asset_coverage_not_complete: ['insufficient_data', 'asset-coverage-incomplete'],
      confidence_evidence_not_approved: ['model_not_approved', 'confidence-evidence-not-approved'],
      identity_evidence_unresolved: ['identity_unresolved', 'trade-asset-identity-unresolved'],
      lineage_evidence_unresolved: ['lineage_unresolved', 'trade-asset-lineage-unresolved'],
      package_distribution_not_complete: ['insufficient_data', 'package-distribution-incomplete'],
      root_distribution_not_complete: ['insufficient_data', 'asset-distribution-incomplete'],
      selected_comparison_not_available: ['insufficient_data', 'trade-comparison-incomplete'],
    } as const;

    for (const cause of AFL_TRADE_PROJECTION_PRESENTATION_FAIL_CLOSED_CAUSES) {
      expect(
        aflTradeProjectionFailClosedInputSchema.safeParse({ policy, cause, view: 'current' })
          .success
      ).toBe(true);
      const value = createAflTradeProjectionFailClosedValue({ policy, cause, view: 'current' });
      expect([value.availability, value.reasonCode]).toEqual(expected[cause]);
      expect(value).toMatchObject({
        view: 'current',
        modelVintage: null,
        temporalContext: null,
        methodologyHref: METHODOLOGY_HREF,
      });
      expect(value.warnings).toHaveLength(1);
      expect(value.warnings[0]).toMatchObject({ severity: 'warning' });
      expect(value.nextAction?.href).toBe(METHODOLOGY_HREF);
      expectDeepFrozen(value);
    }

    expectPolicyError(
      () =>
        createAflTradeProjectionFailClosedValue({
          policy,
          cause: 'runtime-invented-cause',
          view: 'current',
        }),
      'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
    );
    expectPolicyError(
      () =>
        createAflTradeProjectionFailClosedValue({
          policy,
          cause: 'asset_coverage_not_complete',
          view: 'current',
          extra: true,
        }),
      'INVALID_FAIL_CLOSED_INPUT_ENVELOPE'
    );
  });

  it('evaluates every required predicate and applies canonical first-false precedence', () => {
    const policy = createPolicy().projectionPresentationPolicy;
    const evidence = publicEvidenceResult();
    const factByPredicate = {
      asset_coverage_complete_every_view: 'assetCoverageComplete',
      identity_evidence_resolved_every_view: 'identityEvidenceResolved',
      lineage_attribution_resolved_every_view: 'lineageAttributionResolved',
      package_distribution_complete_every_view: 'packageDistributionComplete',
      root_distribution_complete_every_view: 'rootDistributionComplete',
      selected_comparison_available_every_view: 'selectedComparisonAvailable',
    } as const;

    function evaluateWithFailures(failedPredicates: readonly string[]) {
      const predicateFacts = eligibilityFacts();
      for (const predicate of failedPredicates) {
        if (predicate === 'confidence_evidence_approved_every_view') continue;
        predicateFacts[factByPredicate[predicate as keyof typeof factByPredicate]] = false;
      }
      return evaluateAflTradeProjectionPublicationEligibility({
        policy,
        view: 'current',
        projectionPublicEvidence: evidence,
        evidenceSourceVerification: sourceVerificationReplay(
          evidence,
          failedPredicates.includes('confidence_evidence_approved_every_view') ? 'failed' : 'passed'
        ),
        predicateFacts,
      });
    }

    const eligible = evaluateWithFailures([]);
    expect(eligible).toEqual({
      view: 'current',
      status: 'eligible',
      failedPredicate: null,
      failureCause: null,
    });
    expect(aflTradeProjectionPublicationEligibilityResultSchema.safeParse(eligible).success).toBe(
      true
    );
    expect(
      aflTradeProjectionPublicationEligibilityResultSchema.safeParse({
        view: 'current',
        status: 'ineligible',
        failedPredicate: 'asset_coverage_complete_every_view',
        failureCause: 'identity_evidence_unresolved',
      }).success
    ).toBe(false);
    expectDeepFrozen(eligible);

    for (const requiredPredicate of AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES) {
      expect(evaluateWithFailures([requiredPredicate.predicate])).toEqual({
        view: 'current',
        status: 'ineligible',
        failedPredicate: requiredPredicate.predicate,
        failureCause: requiredPredicate.failureCause,
      });
    }

    for (
      let earlierIndex = 0;
      earlierIndex < AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.length;
      earlierIndex += 1
    ) {
      for (
        let laterIndex = earlierIndex + 1;
        laterIndex < AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES.length;
        laterIndex += 1
      ) {
        const earlier = AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES[earlierIndex];
        const later = AFL_TRADE_PROJECTION_PRESENTATION_REQUIRED_PREDICATES[laterIndex];
        expect(evaluateWithFailures([later.predicate, earlier.predicate])).toMatchObject({
          status: 'ineligible',
          failedPredicate: earlier.predicate,
          failureCause: earlier.failureCause,
        });
      }
    }
  });

  it('requires exact valid and chronological public-evidence source verification bindings', () => {
    const policy = createPolicy().projectionPresentationPolicy;
    const evidence = publicEvidenceResult();
    const base = {
      policy,
      view: 'current' as const,
      projectionPublicEvidence: evidence,
      evidenceSourceVerification: sourceVerificationReplay(evidence),
      predicateFacts: eligibilityFacts(),
    };
    expect(aflTradeProjectionPublicationEligibilityInputSchema.safeParse(base).success).toBe(true);
    expect(evaluateAflTradeProjectionPublicationEligibility(base).status).toBe('eligible');

    const failed = evaluateAflTradeProjectionPublicationEligibility({
      ...base,
      evidenceSourceVerification: sourceVerificationReplay(evidence, 'failed'),
    });
    expect(failed).toMatchObject({
      status: 'ineligible',
      failedPredicate: 'confidence_evidence_approved_every_view',
      failureCause: 'confidence_evidence_not_approved',
    });

    expectPolicyError(
      () =>
        evaluateAflTradeProjectionPublicationEligibility({
          ...base,
          evidenceSourceVerification: {
            sourceArtifacts: sourceArtifactsForEvidence(evidence),
            verifiedAt: VERIFIED_AT,
            output: syntheticSourceVerificationResult(evidence),
          },
        }),
      'ELIGIBILITY_SOURCE_VERIFICATION_REPLAY_FAILED'
    );

    const otherEvidence = createAflTradeProjectionPublicEvidence({
      content: { ...publicEvidenceContent(), tradeId: 'trade:other-presentation-policy' },
      materializedAt: CREATED_AT,
    });
    expectPolicyError(
      () =>
        evaluateAflTradeProjectionPublicationEligibility({
          ...base,
          projectionPublicEvidence: otherEvidence,
        }),
      'EVIDENCE_SOURCE_VERIFICATION_MISMATCH'
    );

    const futureEvidence = publicEvidenceResult('2026-08-08T00:00:00.000Z');
    expectPolicyError(
      () =>
        evaluateAflTradeProjectionPublicationEligibility({
          ...base,
          projectionPublicEvidence: futureEvidence,
          evidenceSourceVerification: sourceVerificationReplay(
            futureEvidence,
            'passed',
            VERIFIED_AT
          ),
        }),
      'EVIDENCE_SOURCE_VERIFICATION_MISMATCH'
    );

    expectPolicyError(
      () =>
        evaluateAflTradeProjectionPublicationEligibility({
          ...base,
          projectionPublicEvidence: {},
        }),
      'INVALID_ELIGIBILITY_EVIDENCE'
    );
    expectPolicyError(
      () =>
        evaluateAflTradeProjectionPublicationEligibility({
          ...base,
          evidenceSourceVerification: {},
        }),
      'INVALID_ELIGIBILITY_SOURCE_VERIFICATION'
    );
    expectPolicyError(
      () =>
        evaluateAflTradeProjectionPublicationEligibility({
          ...base,
          predicateFacts: { ...eligibilityFacts(), confidenceEvidenceApproved: true },
        }),
      'INVALID_ELIGIBILITY_PREDICATE_FACTS'
    );
    const revoked = Proxy.revocable(base, {});
    revoked.revoke();
    expectPolicyError(
      () => evaluateAflTradeProjectionPublicationEligibility(revoked.proxy),
      'INVALID_ELIGIBILITY_INPUT_ENVELOPE'
    );
  });

  it('selects the exact governed six-component uncertainty vocabulary and rejects drift', () => {
    const policy = createPolicy().projectionPresentationPolicy;
    expect(policy.content.uncertaintyComponents).toMatchObject({
      definitionVersion: AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_DEFINITION,
      ordering: AFL_TRADE_PROJECTION_PRESENTATION_UNCERTAINTY_COMPONENT_ORDERING,
    });
    expect(
      policy.content.uncertaintyComponents.mappings.map(
        ({ confidenceDimension }) => confidenceDimension
      )
    ).toEqual([null, ...AFL_TRADE_CONFIDENCE_DIMENSIONS]);
    const components = selectAflTradeProjectionUncertaintyComponents({ policy });
    expect(components).toEqual([
      {
        kind: 'outcome',
        label: 'Outcome variability',
        description: 'Variation across the governed complete outcome distribution.',
      },
      {
        kind: 'model',
        label: 'Model calibration',
        description: 'Uncertainty represented by the model-calibration evidence.',
      },
      {
        kind: 'data_quality',
        label: 'Data coverage',
        description: 'Uncertainty represented by the data-coverage evidence.',
      },
      {
        kind: 'identity',
        label: 'Asset identity',
        description: 'Uncertainty represented by the asset-identity evidence.',
      },
      {
        kind: 'lineage',
        label: 'Asset lineage',
        description: 'Uncertainty represented by the lineage-attribution evidence.',
      },
      {
        kind: 'source_freshness',
        label: 'Source freshness',
        description: 'Uncertainty represented by the source-freshness evidence.',
      },
    ]);
    expect(
      aflTradeProjectionUncertaintyComponentSelectionResultSchema.safeParse(components).success
    ).toBe(true);
    expectDeepFrozen(components);

    const drift = structuredClone(policy.content);
    drift.uncertaintyComponents.mappings[1].component.label = 'Runtime model label';
    expect(aflTradeProjectionPresentationPolicyContentSchema.safeParse(drift).success).toBe(false);
    expectPolicyError(
      () => selectAflTradeProjectionUncertaintyComponents({ policy, extra: true }),
      'INVALID_UNCERTAINTY_INPUT_ENVELOPE'
    );
    const revoked = Proxy.revocable({ policy }, {});
    revoked.revoke();
    expectPolicyError(
      () => selectAflTradeProjectionUncertaintyComponents(revoked.proxy),
      'INVALID_UNCERTAINTY_INPUT_ENVELOPE'
    );
  });

  it('returns absent factors empty and emits canonical direct evidence only for its view', () => {
    const absentEvidence = publicEvidenceResult();
    const absentInput = {
      view: 'current' as const,
      projectionPublicEvidence: absentEvidence,
      evidenceSourceVerification: sourceVerificationReplay(absentEvidence),
    };
    expect(aflTradeProjectionFactorEvidenceInputSchema.safeParse(absentInput).success).toBe(true);
    const absent = selectAflTradeProjectionPublicFactors(absentInput);
    expect(absent).toEqual({
      scope: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE,
      viewGlobalFactors: [],
      canRepeatIntoPerSubjectFactors: false,
      perSubjectRepetition: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION,
      perClubFactors: [],
      perAssetFactors: [],
    });
    expect(aflTradeProjectionPublicFactorSelectionResultSchema.safeParse(absent).success).toBe(
      true
    );
    expectDeepFrozen(absent);

    const directFactors = [
      {
        kind: 'positive' as const,
        code: 'a-factor',
        label: 'A factor',
        explanation: 'A direct positive factor.',
        sourceBindings: [factorSourceBinding('positive-a-primary')],
      },
      {
        kind: 'positive' as const,
        code: 'b-factor',
        label: 'B factor',
        explanation: 'A direct positive factor.',
        sourceBindings: [factorSourceBinding('positive-b')],
      },
      {
        kind: 'negative' as const,
        code: 'a-factor',
        label: 'A factor',
        explanation: 'A direct negative factor.',
        sourceBindings: [factorSourceBinding('negative-a')],
      },
      {
        kind: 'uncertainty' as const,
        code: 'z-factor',
        label: 'Z factor',
        explanation: 'A direct uncertainty factor.',
        sourceBindings: [factorSourceBinding('uncertainty-z')],
      },
    ];
    const evidence = publicEvidenceResultWithFactors({ current: directFactors });
    const replay = sourceVerificationReplay(evidence);
    const factors = selectAflTradeProjectionPublicFactors({
      view: 'current',
      projectionPublicEvidence: evidence,
      evidenceSourceVerification: replay,
    });
    expect(factors.viewGlobalFactors.map(({ kind, code }) => [kind, code])).toEqual([
      ['positive', 'a-factor'],
      ['positive', 'b-factor'],
      ['negative', 'a-factor'],
      ['uncertainty', 'z-factor'],
    ]);
    expect(collectKeys(factors.viewGlobalFactors)).not.toContain('sourceBindings');
    expect(factors).toMatchObject({
      scope: 'view_global_context',
      canRepeatIntoPerSubjectFactors: false,
      perSubjectRepetition: 'prohibited',
      perClubFactors: [],
      perAssetFactors: [],
    });
    expect(
      aflTradeProjectionPublicFactorSelectionResultSchema.safeParse({
        ...factors,
        perClubFactors: factors.viewGlobalFactors,
      }).success
    ).toBe(false);
    expectDeepFrozen(factors);
    expect(
      selectAflTradeProjectionPublicFactors({
        view: 'at_trade',
        projectionPublicEvidence: evidence,
        evidenceSourceVerification: replay,
      }).viewGlobalFactors
    ).toEqual([]);

    const policy = createPolicy().projectionPresentationPolicy.content.factors;
    expect(policy).toEqual({
      polarityEvidenceRequirement: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_EVIDENCE,
      missingEvidenceTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MISSING_FACTOR_EVIDENCE,
      ordering: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_ORDERING,
      deduplication: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DEDUPLICATION,
      scope: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_SCOPE,
      dtoSemantics: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_DTO_SEMANTICS,
      perSubjectRepetition: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_FACTOR_REPETITION,
      perClubTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_CLUB_FACTOR_TREATMENT,
      perAssetTreatment: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PER_ASSET_FACTOR_TREATMENT,
      kindOrder: ['positive', 'negative', 'uncertainty'],
      maximumCount: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS,
    });
  });

  it('enforces the factor cap and rejects unknown factors, keys, symbols and hostile inputs', () => {
    const factors = Array.from(
      { length: AFL_TRADE_PROJECTION_PRESENTATION_POLICY_MAX_FACTORS },
      (_, index) => ({
        kind: 'positive' as const,
        code: `factor-${String(index).padStart(2, '0')}`,
        label: `Factor ${index}`,
        explanation: `Direct factor ${index}.`,
        sourceBindings: [factorSourceBinding(`factor-${String(index).padStart(2, '0')}`)],
      })
    );
    const evidence = publicEvidenceResultWithFactors({ current: factors });
    const input = {
      view: 'current' as const,
      projectionPublicEvidence: evidence,
      evidenceSourceVerification: sourceVerificationReplay(evidence),
    };
    expect(selectAflTradeProjectionPublicFactors(input).viewGlobalFactors).toHaveLength(20);
    expectPolicyError(
      () => selectAflTradeProjectionPublicFactors({ factors }),
      'INVALID_FACTOR_INPUT_ENVELOPE'
    );
    const invalidEvidence = structuredClone(evidence);
    invalidEvidence.projectionPublicEvidence.content.factorsByView[3].factors[0].kind =
      'invented' as never;
    expectPolicyError(
      () =>
        selectAflTradeProjectionPublicFactors({
          ...input,
          projectionPublicEvidence: invalidEvidence,
        }),
      'INVALID_FACTOR_PUBLIC_EVIDENCE'
    );
    expectPolicyError(
      () => selectAflTradeProjectionPublicFactors({ ...input, unknown: true }),
      'INVALID_FACTOR_INPUT_ENVELOPE'
    );
    expectPolicyError(
      () => selectAflTradeProjectionPublicFactors({ ...input, [Symbol('unknown')]: true }),
      'INVALID_FACTOR_INPUT_ENVELOPE'
    );
    expectPolicyError(
      () => selectAflTradeProjectionPublicFactors({ ...input, view: 'future' }),
      'INVALID_FACTOR_VIEW'
    );
    expectPolicyError(
      () =>
        selectAflTradeProjectionPublicFactors({
          ...input,
          projectionPublicEvidence: publicEvidenceResult(),
        }),
      'FACTOR_EVIDENCE_SOURCE_VERIFICATION_MISMATCH'
    );
    const futureEvidence = publicEvidenceResultWithFactors(
      { current: factors },
      '2026-08-08T00:00:00.000Z'
    );
    expectPolicyError(
      () =>
        selectAflTradeProjectionPublicFactors({
          view: 'current',
          projectionPublicEvidence: futureEvidence,
          evidenceSourceVerification: sourceVerificationReplay(
            futureEvidence,
            'passed',
            VERIFIED_AT
          ),
        }),
      'FACTOR_EVIDENCE_SOURCE_VERIFICATION_MISMATCH'
    );
    expectPolicyError(
      () =>
        selectAflTradeProjectionPublicFactors({
          ...input,
          evidenceSourceVerification: sourceVerificationReplay(evidence, 'failed'),
        }),
      'FACTOR_SOURCE_VERIFICATION_NOT_PASSED'
    );
    const revoked = Proxy.revocable(input, {});
    revoked.revoke();
    expectPolicyError(
      () => selectAflTradeProjectionPublicFactors(revoked.proxy),
      'INVALID_FACTOR_INPUT_ENVELOPE'
    );
  });

  it('preserves the source-native public boundary and contains no ownership or latest aliases', () => {
    const output = createPolicy();
    const keys = collectKeys(output);
    expect(output.projectionPresentationPolicy.content.publicAssetBoundary).toBe(
      AFL_TRADE_PROJECTION_PRESENTATION_POLICY_PUBLIC_ASSET_BOUNDARY
    );
    expect(keys).not.toContain('userId');
    expect(keys).not.toContain('leagueId');
    expect(keys).not.toContain('membershipId');
    expect(keys).not.toContain('rosterId');
    expect(keys).not.toContain('ownerId');
    expect(keys).not.toContain('ownership');
    expect(keys).not.toContain('latest');
    expect(keys).not.toContain('fallbackValue');
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION).toContain(
      'does not establish empirical threshold validity'
    );
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION).toContain('source approval');
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION).toContain('Gate approval');
    expect(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_LIMITATION).toContain('publication approval');
  });
});
