import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeValuationBundleManifestSchema,
  aflTradeValuationBundleManifestV2Schema,
} from '@/server/aflTradeIntelligence/artifacts/valuationBundleManifest';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-05T02:00:00.000Z',
  };
}

function outputInventoryContractPayload() {
  return {
    inventorySchemaVersion: 'afl-trade-valuation-output-inventory/v1' as const,
    bindingDirection: 'detached_inventory_references_bundle_and_descendants' as const,
    granularity: 'one_root_inventory_per_valuation_case' as const,
    distributionPartitioning: 'bounded_view_measure_shards' as const,
    semanticBinding: 'semantic_content_id_paired_with_immutable_byte_reference' as const,
    publicationRequirement: 'required_before_publication' as const,
  };
}

function outputInventoryContractArtifact(createdAt = '2026-08-05T01:30:00.000Z') {
  return createAflTradeCanonicalJsonArtifactRef(outputInventoryContractPayload(), createdAt);
}

function content() {
  const currentContext = {
    modelVintage: 'current' as const,
    effectiveAt: '2025-12-31T00:00:00.000Z',
    knowledgeCutoffAt: '2025-12-31T23:59:59.000Z',
    valuationAsOf: '2026-01-01T00:00:00.000Z',
  };
  return {
    schemaVersion: 'afl-trade-valuation-bundle/v1' as const,
    environment: 'non_production' as const,
    scopeKey: 'afl-public-trade-value',
    valueUnitId: 'contribution-above-replacement-v1',
    createdAt: '2026-08-05T03:00:00.000Z',
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: `model-protocol:${digest('1')}`,
        runId: `model-run:${digest('2')}`,
        datasetId: `dataset:${digest('3')}`,
        gate3DecisionId: `gate-decision:${digest('4')}`,
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: `model-protocol:${digest('5')}`,
        runId: `model-run:${digest('6')}`,
        datasetId: `dataset:${digest('7')}`,
        gate3DecisionId: `gate-decision:${digest('8')}`,
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
    publicAssetBoundary: 'source_native_afl_assets_no_fantasy_ownership' as const,
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
      listSpotPolicyArtifact: artifact('9'),
      scarcityPolicyArtifact: artifact('a'),
      roleCongestionPolicyArtifact: artifact('b'),
    },
    simulation: {
      draws: 10_000,
      seed: 20260805,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('c'),
      eliteOutcomeDefinitionArtifact: artifact('d'),
      practicalEquivalenceDefinitionArtifact: artifact('e'),
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
      jobId: 'fixture-valuation-job',
      attempt: 1,
      initiatedBy: 'fixture-operator',
      workerIdentity: 'fixture-worker',
      startedAt: '2026-08-05T02:00:00.000Z',
      finishedAt: '2026-08-05T02:30:00.000Z',
      sourceCodeArtifact: artifact('f'),
      dependencyLockArtifact: artifact('0'),
      runtimeArtifact: artifact('1'),
      configurationArtifact: artifact('2'),
    },
    outputs: {
      immutableSnapshotsArtifact: artifact('3'),
      simulationDrawsArtifact: artifact('4'),
      attributionInvariantReportArtifact: artifact('5'),
      deterministicReplayReportArtifact: artifact('6'),
      explanationParityReportArtifact: artifact('7'),
      coverageAndExclusionReportArtifact: artifact('8'),
      confidenceReportArtifact: artifact('9'),
      sensitivityReportArtifact: artifact('a'),
      validationReportArtifact: artifact('b'),
      modelCardArtifact: artifact('c'),
    },
    limitations: ['Fabricated bundle for contract tests; no real model evidence is claimed.'],
  };
}

function manifest(bundleContent = content()) {
  return {
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', bundleContent),
    content: bundleContent,
  };
}

function v2Content() {
  return {
    ...content(),
    schemaVersion: 'afl-trade-valuation-bundle/v2' as const,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    outputInventoryContract: {
      ...outputInventoryContractPayload(),
      contractArtifact: outputInventoryContractArtifact(),
    },
  };
}

function v2Manifest(bundleContent: ReturnType<typeof v2Content> = v2Content()) {
  return {
    valuationBundleId: createAflTradeContentAddress('valuation-bundle', bundleContent),
    content: bundleContent,
  };
}

describe('AFL trade-intelligence valuation bundle', () => {
  it('accepts a reproducible complete-package bundle with separate governed components', () => {
    expect(aflTradeValuationBundleManifestSchema.safeParse(manifest()).success).toBe(true);
  });

  it('preserves the existing v1 content address and accepts the additive v2 boundary', () => {
    const v1 = manifest();
    expect(v1.valuationBundleId).toBe(
      'valuation-bundle:5c998091b5619778628379f345412cd373c6e8b7cfc4e1e6a5ee54bbcd7b143c'
    );
    expect(aflTradeValuationBundleManifestSchema.safeParse(v1).success).toBe(true);

    const parsedV2 = aflTradeValuationBundleManifestV2Schema.safeParse(v2Manifest());
    expect(parsedV2.success).toBe(true);
    if (!parsedV2.success) return;
    expect(parsedV2.data.content.schemaVersion).toBe('afl-trade-valuation-bundle/v2');
    expect(parsedV2.data.content.publicAssetBoundary).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(parsedV2.data.content.outputInventoryContract).toEqual({
      inventorySchemaVersion: 'afl-trade-valuation-output-inventory/v1',
      bindingDirection: 'detached_inventory_references_bundle_and_descendants',
      granularity: 'one_root_inventory_per_valuation_case',
      distributionPartitioning: 'bounded_view_measure_shards',
      semanticBinding: 'semantic_content_id_paired_with_immutable_byte_reference',
      publicationRequirement: 'required_before_publication',
      contractArtifact: outputInventoryContractArtifact(),
    });
  });

  it('keeps the detached output-inventory contract exclusive to v2', () => {
    const v1WithContract = {
      ...content(),
      outputInventoryContract: v2Content().outputInventoryContract,
    };
    expect(aflTradeValuationBundleManifestSchema.safeParse(manifest(v1WithContract)).success).toBe(
      false
    );
  });

  it('rejects cross-version ownership boundaries and unknown bundle versions', () => {
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        manifest({
          ...content(),
          publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as never,
        })
      ).success
    ).toBe(false);
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        v2Manifest({
          ...v2Content(),
          publicAssetBoundary: 'source_native_afl_assets_no_fantasy_ownership' as never,
        })
      ).success
    ).toBe(false);

    const v3Content = {
      ...v2Content(),
      schemaVersion: 'afl-trade-valuation-bundle/v3',
    };
    expect(
      aflTradeValuationBundleManifestSchema.safeParse({
        valuationBundleId: createAflTradeContentAddress('valuation-bundle', v3Content),
        content: v3Content,
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership and independent point-sum package shortcuts', () => {
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        manifest({ ...content(), publicAssetBoundary: 'fantasy_user_owned_assets' as never })
      ).success
    ).toBe(false);
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        manifest({
          ...content(),
          packagePolicy: {
            ...content().packagePolicy,
            aggregation: 'independent_point_sum' as never,
          },
        })
      ).success
    ).toBe(false);
  });

  it('rejects user or fantasy ownership literals and ownership fields in v2', () => {
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        v2Manifest({ ...v2Content(), publicAssetBoundary: 'user_owned_afl_assets' as never })
      ).success
    ).toBe(false);
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        v2Manifest({ ...v2Content(), publicAssetBoundary: 'fantasy_user_owned_assets' as never })
      ).success
    ).toBe(false);

    const contentWithOwnershipFields = {
      ...v2Content(),
      userId: 'fixture-user',
      fantasyTeamId: 'fixture-fantasy-team',
      ownerId: 'fixture-owner',
    };
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(contentWithOwnershipFields))
        .success
    ).toBe(false);
  });

  it('rejects inline descendant identities and bundle-specific inventory references', () => {
    const inlineDescendants = {
      ...v2Content(),
      valuationCaseId: `valuation-case:${digest('1')}`,
      valuationCalculationId: `valuation-calculation:${digest('2')}`,
      valuationDistributionIds: [`valuation-distribution:${digest('3')}`],
      valuationComparisonIds: [`valuation-comparison:${digest('4')}`],
      structuredExplanationId: `structured-explanation:${digest('5')}`,
    };
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(inlineDescendants)).success
    ).toBe(false);

    const bundleSpecificInventory = {
      ...v2Content(),
      outputInventoryId: `valuation-output-inventory:${digest('6')}`,
      outputInventoryArtifact: artifact('7'),
    };
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(bundleSpecificInventory)).success
    ).toBe(false);
  });

  it('rejects a re-addressed contract with a tampered topology policy', () => {
    const tamperedContract = {
      ...v2Content(),
      outputInventoryContract: {
        ...v2Content().outputInventoryContract,
        bindingDirection: 'bundle_references_descendant_inventory' as never,
      },
    };
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(tamperedContract)).success
    ).toBe(false);
  });

  it('requires the contract artifact to exist before bundle execution', () => {
    const lateContract = {
      ...v2Content(),
      outputInventoryContract: {
        ...v2Content().outputInventoryContract,
        contractArtifact: outputInventoryContractArtifact('2026-08-05T02:00:00.001Z'),
      },
    };
    expect(aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(lateContract)).success).toBe(
      false
    );
  });

  it('binds contract changes into the v2 content address and accepts explicit re-addressing', () => {
    const original = v2Manifest();
    const changedContent = {
      ...original.content,
      outputInventoryContract: {
        ...original.content.outputInventoryContract,
        contractArtifact: outputInventoryContractArtifact('2026-08-05T01:45:00.000Z'),
      },
    };

    expect(
      aflTradeValuationBundleManifestSchema.safeParse({ ...original, content: changedContent })
        .success
    ).toBe(false);

    const readdressed = v2Manifest(changedContent);
    expect(readdressed.valuationBundleId).not.toBe(original.valuationBundleId);
    expect(aflTradeValuationBundleManifestSchema.safeParse(readdressed).success).toBe(true);
  });

  it('rejects a contract reference to different canonical bytes or a tampered byte length', () => {
    const correct = outputInventoryContractArtifact();
    const mismatched = createAflTradeCanonicalJsonArtifactRef(
      { ...outputInventoryContractPayload(), unrelatedPolicy: 'different-bytes' },
      correct.createdAt
    );

    for (const contractArtifact of [
      mismatched,
      { ...correct, byteLength: correct.byteLength + 1 },
    ]) {
      const candidate = {
        ...v2Content(),
        outputInventoryContract: {
          ...v2Content().outputInventoryContract,
          contractArtifact,
        },
      };
      expect(aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(candidate)).success).toBe(
        false
      );
    }
  });

  it('applies shared component and temporal refinements to v2 bundles', () => {
    const duplicateRun = v2Content();
    duplicateRun.components[1].runId = duplicateRun.components[0].runId;
    expect(aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(duplicateRun)).success).toBe(
      false
    );

    const hindsight = v2Content();
    hindsight.viewContexts[0].knowledgeCutoffAt = '2020-11-13T00:00:00.000Z';
    hindsight.viewContexts[0].valuationAsOf = '2020-11-13T00:00:00.000Z';
    expect(aflTradeValuationBundleManifestSchema.safeParse(v2Manifest(hindsight)).success).toBe(
      false
    );
  });

  it('requires each governed component exactly once with distinct protocol and run lineage', () => {
    const base = content();
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        manifest({ ...base, components: [base.components[0], base.components[0]] })
      ).success
    ).toBe(false);

    const duplicateRun = content();
    duplicateRun.components[1].runId = duplicateRun.components[0].runId;
    expect(aflTradeValuationBundleManifestSchema.safeParse(manifest(duplicateRun)).success).toBe(
      false
    );
  });

  it('rejects at-trade hindsight', () => {
    const value = content();
    value.viewContexts[0].knowledgeCutoffAt = '2020-11-13T00:00:00.000Z';
    value.viewContexts[0].valuationAsOf = '2020-11-13T00:00:00.000Z';
    expect(aflTradeValuationBundleManifestSchema.safeParse(manifest(value)).success).toBe(false);
  });

  it('requires all views exactly once and one shared current temporal context', () => {
    const duplicateView = content();
    duplicateView.viewContexts[3] = { ...duplicateView.viewContexts[2] };
    expect(aflTradeValuationBundleManifestSchema.safeParse(manifest(duplicateView)).success).toBe(
      false
    );

    const mismatchedCurrent = content();
    mismatchedCurrent.viewContexts[3].knowledgeCutoffAt = '2025-12-30T23:59:59.000Z';
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(manifest(mismatchedCurrent)).success
    ).toBe(false);
  });

  it('prohibits fallback values for unresolved assets and preserves shared factors', () => {
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        manifest({
          ...content(),
          packagePolicy: {
            ...content().packagePolicy,
            unresolvedAssetTreatment: 'estimate_from_latest_name_match' as never,
          },
        })
      ).success
    ).toBe(false);
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(
        manifest({
          ...content(),
          packagePolicy: {
            ...content().packagePolicy,
            sharedFactorTreatment: 'assume_asset_independence' as never,
          },
        })
      ).success
    ).toBe(false);
  });

  it('requires every risk statistic and explanation distinction exactly once', () => {
    const statisticBase = content();
    const missingStatisticContent = {
      ...statisticBase,
      simulation: {
        ...statisticBase.simulation,
        requiredStatistics: [...statisticBase.simulation.requiredStatistics.slice(0, 8), 'mean'],
      },
    };
    const missingStatistic: unknown = {
      valuationBundleId: createAflTradeContentAddress('valuation-bundle', missingStatisticContent),
      content: missingStatisticContent,
    };
    expect(aflTradeValuationBundleManifestSchema.safeParse(missingStatistic).success).toBe(false);

    const distinctionBase = content();
    const missingDistinctionContent = {
      ...distinctionBase,
      explanationPolicy: {
        ...distinctionBase.explanationPolicy,
        requiredDistinctions: [
          ...distinctionBase.explanationPolicy.requiredDistinctions.slice(0, 4),
          'model_estimate',
        ],
      },
    };
    const missingDistinction: unknown = {
      valuationBundleId: createAflTradeContentAddress(
        'valuation-bundle',
        missingDistinctionContent
      ),
      content: missingDistinctionContent,
    };
    expect(aflTradeValuationBundleManifestSchema.safeParse(missingDistinction).success).toBe(false);
  });

  it('requires execution after every valuation as-of time and chronological completion', () => {
    const earlyExecution = content();
    earlyExecution.execution.startedAt = '2025-12-31T12:00:00.000Z';
    expect(aflTradeValuationBundleManifestSchema.safeParse(manifest(earlyExecution)).success).toBe(
      false
    );

    const backwardsExecution = content();
    backwardsExecution.execution.finishedAt = '2026-08-05T01:00:00.000Z';
    expect(
      aflTradeValuationBundleManifestSchema.safeParse(manifest(backwardsExecution)).success
    ).toBe(false);
  });

  it('rejects content changed after the bundle identity was calculated', () => {
    const original = manifest();
    expect(
      aflTradeValuationBundleManifestSchema.safeParse({
        ...original,
        content: { ...original.content, valueUnitId: 'tampered-value-unit' },
      }).success
    ).toBe(false);
  });

  it('rejects v2 content changed after its bundle identity was calculated', () => {
    const original = v2Manifest();
    expect(
      aflTradeValuationBundleManifestSchema.safeParse({
        ...original,
        content: { ...original.content, valueUnitId: 'tampered-v2-value-unit' },
      }).success
    ).toBe(false);
  });
});
