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
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_DIGEST_DEFINITION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LEGACY_TREATMENT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_ORDERING,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_POLICY_DEFINITION,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PUBLICATION_AUTHORITY,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_RUNTIME_FALLBACK,
  AflTradeValuationOutputInventoryIndexConstructionError,
  aflTradeValuationOutputInventoryIndexContentSchema,
  aflTradeValuationOutputInventoryIndexResultSchema,
  createAflTradeValuationOutputInventoryIndex,
  isAflTradeValuationOutputInventoryIndexConstructionError,
  verifyAflTradeValuationOutputInventoryIndex,
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
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

const CONTRACT_CREATED_AT = '2026-08-05T00:30:00.000Z';
const SOURCE_CREATED_AT = '2026-08-05T03:00:00.000Z';
const BUNDLE_REFERENCE_CREATED_AT = '2026-08-05T03:10:00.000Z';
const ROOT_SOURCE_CREATED_AT = '2026-08-05T03:20:00.000Z';
const ROOT_MATERIALIZED_AT = '2026-08-05T04:00:00.000Z';
const INDEX_CREATED_AT = '2026-08-05T05:00:00.000Z';
const UNIVERSAL_LAYERS = ['gross', 'list_spot_adjusted', 'scarcity_adjusted'] as const;

function artifact(label: string, createdAt = SOURCE_CREATED_AT) {
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
  scopeKey = 'fixture-output-inventory-index',
  valueUnitId = 'fixture-football-value-v1'
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
    scopeKey,
    valueUnitId,
    createdAt: SOURCE_CREATED_AT,
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: semanticId('model-protocol', `${scopeKey}:player-protocol`),
        runId: semanticId('model-run', `${scopeKey}:player-run`),
        datasetId: semanticId('dataset', `${scopeKey}:player-dataset`),
        gate3DecisionId: semanticId('gate-decision', `${scopeKey}:player-gate`),
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: semanticId('model-protocol', `${scopeKey}:pick-protocol`),
        runId: semanticId('model-run', `${scopeKey}:pick-run`),
        datasetId: semanticId('dataset', `${scopeKey}:pick-dataset`),
        gate3DecisionId: semanticId('gate-decision', `${scopeKey}:pick-gate`),
      },
    ],
    viewContexts: [
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
      listSpotPolicyArtifact: artifact(`${scopeKey}:list-spot`),
      scarcityPolicyArtifact: artifact(`${scopeKey}:scarcity`),
      roleCongestionPolicyArtifact: artifact(`${scopeKey}:role-congestion`),
    },
    simulation: {
      draws: 2,
      seed: 20260805,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact(`${scopeKey}:low-return`),
      eliteOutcomeDefinitionArtifact: artifact(`${scopeKey}:elite-outcome`),
      practicalEquivalenceDefinitionArtifact: artifact(`${scopeKey}:equivalence`),
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
      jobId: `${scopeKey}:job`,
      attempt: 1,
      initiatedBy: 'fixture-operator',
      workerIdentity: 'fixture-worker',
      startedAt: '2026-08-05T01:00:00.000Z',
      finishedAt: '2026-08-05T02:00:00.000Z',
      sourceCodeArtifact: artifact(`${scopeKey}:source-code`),
      dependencyLockArtifact: artifact(`${scopeKey}:dependency-lock`),
      runtimeArtifact: artifact(`${scopeKey}:runtime`),
      configurationArtifact: artifact(`${scopeKey}:configuration`),
    },
    outputs: {
      immutableSnapshotsArtifact: artifact(`${scopeKey}:snapshots`),
      simulationDrawsArtifact: artifact(`${scopeKey}:draws`),
      attributionInvariantReportArtifact: artifact(`${scopeKey}:attribution`),
      deterministicReplayReportArtifact: artifact(`${scopeKey}:replay`),
      explanationParityReportArtifact: artifact(`${scopeKey}:explanation-parity`),
      coverageAndExclusionReportArtifact: artifact(`${scopeKey}:coverage`),
      confidenceReportArtifact: artifact(`${scopeKey}:confidence`),
      sensitivityReportArtifact: artifact(`${scopeKey}:sensitivity`),
      validationReportArtifact: artifact(`${scopeKey}:validation`),
      modelCardArtifact: artifact(`${scopeKey}:model-card`),
    },
    outputInventoryContract: {
      ...contract,
      contractArtifact: createAflTradeCanonicalJsonArtifactRef(contract, CONTRACT_CREATED_AT),
    },
    limitations: ['Focused source-independent inventory-index fixture.'],
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

function createInventoryBinding(
  bundle: AflTradeValuationBundleManifestV2,
  bundleArtifactRef: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>,
  suffix: string,
  tradeId: string,
  overrides: { valuationCaseSuffix?: string; valueUnitId?: string } = {}
) {
  const valuationCaseSuffix = overrides.valuationCaseSuffix ?? suffix;
  const valuationCalculation = {
    valuationCalculationId: semanticId('valuation-calculation', suffix),
    artifactRef: artifact(`${suffix}:calculation`, ROOT_SOURCE_CREATED_AT),
  };
  const distributionShards = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    UNIVERSAL_LAYERS.map((layer) => {
      const label = `${suffix}:${view}:${layer}`;
      return {
        valuationOutputInventoryShardId: semanticId('valuation-output-inventory-shard', label),
        artifactRef: artifact(`${label}:shard`, ROOT_MATERIALIZED_AT),
        coordinate: {
          view,
          measure: { kind: 'universal_football_value' as const, layer },
        },
        distributionCount: 4,
        distributionSetSha256: sha256AflTradeCanonicalJson({ label, distributions: 4 }),
      };
    })
  );
  const valuationComparisons = AFL_TRADE_VALUATION_VIEWS.flatMap((view) =>
    UNIVERSAL_LAYERS.map((layer) => {
      const label = `${suffix}:${view}:${layer}`;
      return {
        view,
        measure: { kind: 'universal_football_value' as const, layer },
        valuationComparisonId: semanticId('valuation-comparison', label),
        artifactRef: artifact(`${label}:comparison`, ROOT_SOURCE_CREATED_AT),
      };
    })
  );
  const structuredExplanation = {
    structuredExplanationId: semanticId('structured-explanation', suffix),
    artifactRef: artifact(`${suffix}:explanation`, ROOT_SOURCE_CREATED_AT),
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
      valuationCaseId: semanticId('valuation-case', valuationCaseSuffix),
      artifactRef: artifact(`${valuationCaseSuffix}:case`, ROOT_SOURCE_CREATED_AT),
    },
    valuationCalculation,
    lineageGraphId: semanticId('lineage-graph', suffix),
    componentDrawSetId: semanticId('component-draw-set', suffix),
    realizedContributionLedgerId: semanticId('realized-contribution-ledger', suffix),
    packagePolicyId: semanticId('package-policy', suffix),
    tradeId,
    valueUnitId: overrides.valueUnitId ?? bundle.content.valueUnitId,
    distributionCoverage: {
      required: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_REQUIRED_DISTRIBUTION_COVERAGE,
      optionalClubUtility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_OPTIONAL_CLUB_UTILITY_COVERAGE,
    },
    distributionCount: 48,
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
    materializedAt: ROOT_MATERIALIZED_AT,
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
      ROOT_MATERIALIZED_AT
    ),
  };
}

function fixture() {
  const bundle = createBundle();
  const valuationBundleArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    bundle,
    BUNDLE_REFERENCE_CREATED_AT
  );
  const alpha = createInventoryBinding(bundle, valuationBundleArtifactRef, 'alpha', 'trade:zeta');
  const beta = createInventoryBinding(bundle, valuationBundleArtifactRef, 'beta', 'trade:alpha');
  return { bundle, valuationBundleArtifactRef, alpha, beta };
}

function inputFor(value = fixture()) {
  return {
    valuationBundleManifest: value.bundle,
    valuationBundleArtifactRef: value.valuationBundleArtifactRef,
    valuationOutputInventories: [value.alpha, value.beta],
    createdAt: INDEX_CREATED_AT,
  };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeValuationOutputInventoryIndexConstructionError['code']
): AflTradeValuationOutputInventoryIndexConstructionError {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isAflTradeValuationOutputInventoryIndexConstructionError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    expect(Object.isFrozen(error)).toBe(true);
    return error as AflTradeValuationOutputInventoryIndexConstructionError;
  }
}

function rebindInventory(
  source: ReturnType<typeof createInventoryBinding>,
  mutate: (content: AflTradeValuationOutputInventory['content']) => void
) {
  const content = structuredClone(source.valuationOutputInventory.content);
  mutate(content);
  const valuationOutputInventory = aflTradeValuationOutputInventorySchema.parse({
    valuationOutputInventoryId: createAflTradeContentAddress('valuation-output-inventory', content),
    content,
  });
  return {
    valuationOutputInventory,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(
      valuationOutputInventory,
      content.materializedAt
    ),
  };
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((child) => isDeeplyFrozen(child, seen))
  );
}

describe('AFL trade valuation output inventory index', () => {
  it('indexes two detached inventories under one V2 bundle in canonical trade order', () => {
    const source = fixture();
    const input = inputFor(source);
    const output = createAflTradeValuationOutputInventoryIndex(input);
    const content = output.valuationOutputInventoryIndex.content;

    expect(content.scopeKey).toBe(source.bundle.content.scopeKey);
    expect(content.valueUnitId).toBe(source.bundle.content.valueUnitId);
    expect(content.entries.map((entry) => entry.tradeId)).toEqual(['trade:alpha', 'trade:zeta']);
    expect(content.entryCount).toBe(2);
    expect(content.aggregateOutputCounts).toEqual({
      valuationCalculationCount: 2,
      valuationDistributionCount: 96,
      valuationDistributionShardCount: 24,
      valuationComparisonCount: 24,
      structuredExplanationCount: 2,
      publicationOutputBindingCount: 52,
    });
    expect(content.ordering).toBe(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_ORDERING);
    expect(content.digestDefinition).toBe(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_DIGEST_DEFINITION
    );
    expect(content.inventorySetSha256).toBe(sha256AflTradeCanonicalJson(content.entries));
    expect(content.totalInventoryArtifactByteLength).toBe(
      source.alpha.artifactRef.byteLength + source.beta.artifactRef.byteLength
    );
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        output.valuationOutputInventoryIndexArtifactRef,
        output.valuationOutputInventoryIndex
      )
    ).toBe(true);
    expect(aflTradeValuationOutputInventoryIndexResultSchema.safeParse(output).success).toBe(true);
    expect(
      verifyAflTradeValuationOutputInventoryIndex({
        valuationBundleManifest: input.valuationBundleManifest,
        valuationBundleArtifactRef: input.valuationBundleArtifactRef,
        valuationOutputInventories: input.valuationOutputInventories,
        output,
      })
    ).toBe(true);
  });

  it('canonicalizes inventory input order without changing the index identity or bytes', () => {
    const input = inputFor();
    const forward = createAflTradeValuationOutputInventoryIndex(input);
    const reversed = createAflTradeValuationOutputInventoryIndex({
      ...input,
      valuationOutputInventories: [...input.valuationOutputInventories].reverse(),
    });

    expect(reversed).toEqual(forward);
    expect(canonicalizeAflTradeJson(reversed)).toBe(canonicalizeAflTradeJson(forward));
  });

  it('authenticates the complete bundle and inventory-root bytes', () => {
    const input = inputFor();
    const wrongBundleReference = createAflTradeCanonicalJsonArtifactRef(
      { not: 'the bundle' },
      BUNDLE_REFERENCE_CREATED_AT
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...input,
          valuationBundleArtifactRef: wrongBundleReference,
        }),
      'INVALID_VALUATION_BUNDLE_ARTIFACT_REFERENCE'
    );

    const wrongInventoryReference = createAflTradeCanonicalJsonArtifactRef(
      { not: 'the inventory' },
      ROOT_MATERIALIZED_AT
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...input,
          valuationOutputInventories: [
            { ...input.valuationOutputInventories[0], artifactRef: wrongInventoryReference },
            input.valuationOutputInventories[1],
          ],
        }),
      'INVENTORY_ARTIFACT_REFERENCE_MISMATCH'
    );
  });

  it('rejects bundle, inventory-root, and index chronology inversions', () => {
    const input = inputFor();
    const earlyBundleReference = createAflTradeCanonicalJsonArtifactRef(
      input.valuationBundleManifest,
      '2026-08-05T02:59:59.999Z'
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...input,
          valuationBundleArtifactRef: earlyBundleReference,
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...input,
          createdAt: '2026-08-05T03:59:59.999Z',
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...input,
          createdAt: '2026-08-05T02:59:59.999Z',
        }),
      'NON_MONOTONIC_ARTIFACT_TIME'
    );
  });

  it('rejects duplicate trade and valuation-case memberships before publication', () => {
    const source = fixture();
    const duplicateTrade = rebindInventory(source.beta, (content) => {
      content.tradeId = source.alpha.valuationOutputInventory.content.tradeId;
    });
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...inputFor(source),
          valuationOutputInventories: [source.alpha, duplicateTrade],
        }),
      'DUPLICATE_TRADE_ID'
    );

    const duplicateCase = rebindInventory(source.beta, (content) => {
      content.valuationCase = structuredClone(
        source.alpha.valuationOutputInventory.content.valuationCase
      );
    });
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...inputFor(source),
          valuationOutputInventories: [source.alpha, duplicateCase],
        }),
      'DUPLICATE_VALUATION_CASE_ID'
    );
  });

  it('rejects inventories from another bundle, value unit, or asset boundary', () => {
    const source = fixture();
    const otherBundle = createBundle('fixture-other-scope');
    const otherBundleReference = createAflTradeCanonicalJsonArtifactRef(
      otherBundle,
      BUNDLE_REFERENCE_CREATED_AT
    );
    const crossBundle = createInventoryBinding(
      otherBundle,
      otherBundleReference,
      'other',
      'trade:other'
    );
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...inputFor(source),
          valuationOutputInventories: [source.alpha, crossBundle],
        }),
      'BUNDLE_BINDING_MISMATCH'
    );

    const wrongUnit = rebindInventory(source.beta, (content) => {
      content.valueUnitId = 'fixture-other-unit';
    });
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...inputFor(source),
          valuationOutputInventories: [source.alpha, wrongUnit],
        }),
      'VALUE_UNIT_MISMATCH'
    );

    const wrongBoundary = structuredClone(source.beta);
    (
      wrongBoundary.valuationOutputInventory.content as { publicAssetBoundary: string }
    ).publicAssetBoundary = 'fantasy_user_owned_assets';
    expectConstructionError(
      () =>
        createAflTradeValuationOutputInventoryIndex({
          ...inputFor(source),
          valuationOutputInventories: [source.alpha, wrongBoundary],
        }),
      'INVALID_INVENTORY_BINDINGS'
    );
  });

  it('rejects schema tampering and keeps legacy predecessors outside index membership', () => {
    const input = inputFor();
    const output = createAflTradeValuationOutputInventoryIndex(input);
    const content = structuredClone(output.valuationOutputInventoryIndex.content);

    expect(content.predecessorPolicy).toEqual({
      definitionVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_POLICY_DEFINITION,
      indexedInventorySchemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_COMPATIBILITY,
      legacyTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LEGACY_TREATMENT,
      runtimeFallback: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_RUNTIME_FALLBACK,
      publicationAuthority: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PUBLICATION_AUTHORITY,
    });

    const reordered = structuredClone(content);
    reordered.entries.reverse();
    expect(aflTradeValuationOutputInventoryIndexContentSchema.safeParse(reordered).success).toBe(
      false
    );
    const legacy = {
      ...content,
      predecessorPolicy: {
        ...content.predecessorPolicy,
        predecessorSchemaVersion: 'afl-trade-valuation-snapshot-set/v1',
      },
      legacySnapshotIds: [semanticId('valuation-snapshot-set', 'legacy')],
    };
    expect(aflTradeValuationOutputInventoryIndexContentSchema.safeParse(legacy).success).toBe(
      false
    );
  });

  it('rejects hidden user or fantasy ownership fields at every strict index boundary', () => {
    const input = inputFor();
    const inventory = structuredClone(input.valuationOutputInventories[0]);
    const candidates = [
      { ...input, userId: 'fixture-user' },
      {
        ...input,
        valuationOutputInventories: [
          { ...inventory, fantasyTeamId: 'fixture-team' },
          input.valuationOutputInventories[1],
        ],
      },
      {
        ...input,
        valuationOutputInventories: [
          {
            ...inventory,
            valuationOutputInventory: {
              ...inventory.valuationOutputInventory,
              ownerId: 'fixture-owner',
            },
          },
          input.valuationOutputInventories[1],
        ],
      },
    ];

    expectConstructionError(
      () => createAflTradeValuationOutputInventoryIndex(candidates[0]),
      'INVALID_INPUT_ENVELOPE'
    );
    for (const candidate of candidates.slice(1)) {
      expectConstructionError(
        () => createAflTradeValuationOutputInventoryIndex(candidate),
        'INVALID_INVENTORY_BINDINGS'
      );
    }
  });

  it('contains hostile inputs and does not trust structurally spoofed errors', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile');
        },
      }
    );
    expectConstructionError(
      () => createAflTradeValuationOutputInventoryIndex(hostile),
      'INVALID_INPUT_ENVELOPE'
    );
    expect(
      isAflTradeValuationOutputInventoryIndexConstructionError({
        name: 'AflTradeValuationOutputInventoryIndexConstructionError',
        code: 'INVALID_INPUT_ENVELOPE',
      })
    ).toBe(false);
    expect(verifyAflTradeValuationOutputInventoryIndex(hostile)).toBe(false);

    const input = inputFor();
    const reads = new Map<string, number>();
    const getterEnvelope = Object.fromEntries(
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
    );
    const exact = Object.defineProperties({}, getterEnvelope);
    createAflTradeValuationOutputInventoryIndex(exact);
    expect([...reads.values()]).toEqual([1, 1, 1, 1]);
  });

  it('deep-freezes output and does not alias mutable caller inputs', () => {
    const input = inputFor();
    const firstTradeId =
      input.valuationOutputInventories[0].valuationOutputInventory.content.tradeId;
    const output = createAflTradeValuationOutputInventoryIndex(input);
    const snapshot = canonicalizeAflTradeJson(output);

    input.valuationOutputInventories.reverse();
    input.valuationOutputInventories[0].valuationOutputInventory.content.tradeId = 'trade:mutated';

    expect(isDeeplyFrozen(output)).toBe(true);
    expect(canonicalizeAflTradeJson(output)).toBe(snapshot);
    expect(
      output.valuationOutputInventoryIndex.content.entries.some(
        (entry) => entry.tradeId === firstTradeId
      )
    ).toBe(true);
  });

  it('fails verification for tampered output, source bindings, or non-exact envelopes', () => {
    const input = inputFor();
    const output = createAflTradeValuationOutputInventoryIndex(input);
    const verifyInput = {
      valuationBundleManifest: input.valuationBundleManifest,
      valuationBundleArtifactRef: input.valuationBundleArtifactRef,
      valuationOutputInventories: input.valuationOutputInventories,
      output,
    };
    expect(verifyAflTradeValuationOutputInventoryIndex(verifyInput)).toBe(true);
    expect(
      verifyAflTradeValuationOutputInventoryIndex({
        ...verifyInput,
        valuationOutputInventories: [...verifyInput.valuationOutputInventories].reverse(),
      })
    ).toBe(true);

    const tampered = structuredClone(output);
    tampered.valuationOutputInventoryIndex.content.entries[0].tradeId = 'trade:tampered';
    expect(verifyAflTradeValuationOutputInventoryIndex({ ...verifyInput, output: tampered })).toBe(
      false
    );
    expect(
      verifyAflTradeValuationOutputInventoryIndex({ ...verifyInput, extra: 'not-exact' })
    ).toBe(false);
    expect(
      verifyAflTradeValuationOutputInventoryIndex({
        ...verifyInput,
        valuationBundleManifest: createBundle('fixture-wrong-verifier-bundle'),
      })
    ).toBe(false);
  });
});
