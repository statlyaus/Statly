import { createAflTradePreparedValuationInputSet } from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import { createAflTradeCurrentValuationCohortPreparationOperationId } from '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';

const digest = (character: string) => character.repeat(64);
const artifact = (character: string) => ({
  artifactId: `artifact:${digest(character)}`,
  contentSha256: digest(character),
  storageUri: `artifact://sha256/${digest(character)}`,
  mediaType: 'application/json',
  byteLength: 256,
  createdAt: '2026-08-20T08:00:00.000Z',
});

export function createAflTradeCurrentValuationBundleFixture(input: {
  readonly scopeKey: string;
  readonly playerRunId: string;
  readonly pickRunId: string;
}) {
  const content = {
    schemaVersion: 'afl-trade-valuation-input-bundle/v1' as const,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    environment: 'non_production' as const,
    scopeKey: input.scopeKey,
    valueUnitId: 'contribution-above-replacement-v1',
    createdAt: '2026-08-20T08:30:00.000Z',
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: `model-protocol:${digest('1')}`,
        runId: input.playerRunId,
        datasetId: `dataset:${digest('2')}`,
        gate3DecisionId: `gate-decision:${digest('3')}`,
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: `model-protocol:${digest('4')}`,
        runId: input.pickRunId,
        datasetId: `dataset:${digest('5')}`,
        gate3DecisionId: `gate-decision:${digest('6')}`,
      },
    ],
    viewPolicy: {
      atTrade: {
        modelVintage: 'historical_restatement' as const,
        knowledgeCutoff: 'transaction_effective_at_exclusive' as const,
      },
      current: {
        modelVintage: 'current' as const,
        effectiveAt: '2026-08-21T07:00:00.000Z',
        knowledgeCutoffAt: '2026-08-21T07:00:00.000Z',
        valuationAsOf: '2026-08-21T08:00:00.000Z',
      },
      currentViewsShareOneTemporalContext: true as const,
    },
    packagePolicy: {
      calculationUnit: 'complete_multi_party_trade' as const,
      attribution: 'lineage_frontier_exactly_once' as const,
      aggregation: 'joint_simulation_not_independent_point_sum' as const,
      currentOutcomeIdentity: 'realized_club_value_plus_remaining_asset_value' as const,
      unresolvedAssetTreatment: 'exclude_with_explicit_reason_no_fallback_value' as const,
      listSpotPolicyArtifact: artifact('7'),
      scarcityPolicyArtifact: artifact('8'),
      roleCongestionPolicyArtifact: artifact('9'),
    },
    simulation: {
      mode: 'deterministic_counter_sample' as const,
      draws: 10_000,
      seed: 'current-cohort-fixture-seed',
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1' as const,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('a'),
      eliteOutcomeDefinitionArtifact: artifact('b'),
      practicalEquivalenceDefinitionArtifact: artifact('c'),
    },
    explanationPolicyArtifact: artifact('d'),
    publicationEligible: false as const,
    limitation:
      'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.' as const,
  };
  const valuationInputBundle = {
    valuationInputBundleId: createAflTradeContentAddress('valuation-input-bundle', content),
    content,
  };
  return {
    valuationInputBundle,
    valuationInputBundleId: valuationInputBundle.valuationInputBundleId,
    valuationInputBundleArtifact: createAflTradeCanonicalJsonArtifactRef(
      valuationInputBundle,
      content.createdAt
    ),
  };
}

export function createAflTradeCurrentValuationCohortFixture() {
  const playerRunId = `model-run:${digest('9')}`;
  const pickRunId = `model-run:${digest('a')}`;
  const bundle = createAflTradeCurrentValuationBundleFixture({
    scopeKey: 'afl-men:2026-trades',
    playerRunId,
    pickRunId,
  });
  const operationId = createAflTradeCurrentValuationCohortPreparationOperationId({
    scopeKey: 'afl-men:2026-trades',
    factualReleaseId: `outcome-release:${digest('2')}`,
    factualReleaseRevision: 7,
    modelQualificationId: `model-qualification:${digest('8')}`,
    modelQualificationWorkId: `model-qualification-work:${digest('0')}`,
    modelQualificationRevision: 3,
    expectedPreparedInputRevision: 11,
  });
  const context = {
    operationId,
    scopeKey: 'afl-men:2026-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('2')}`,
    factualReleaseRevision: 7,
    factualReleaseArtifact: artifact('3'),
    releaseMembershipArtifact: artifact('4'),
    releaseTradeIds: ['trade-a'],
    sourceQualificationReportId: `valuation-source-qualification:${digest('5')}`,
    sourceQualificationReportArtifact: artifact('6'),
    sourceQualificationEvidenceRefs: [artifact('7')],
    modelQualificationId: `model-qualification:${digest('8')}`,
    modelQualificationWorkId: `model-qualification-work:${digest('0')}`,
    modelQualificationRevision: 3,
    playerRunId,
    pickRunId,
    expectedPreparedInputRevision: 11,
    valuationInputBundleId: bundle.valuationInputBundleId,
    valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
    capturedAt: '2026-08-21T09:00:00.000Z',
  } as const;
  const preparedInputSet = createAflTradePreparedValuationInputSet({
    schemaVersion: 'afl-trade-prepared-valuation-input-set/v3',
    environment: 'non_production',
    scopeKey: context.scopeKey,
    factualReleaseScopeKey: context.factualReleaseScopeKey,
    factualReleaseId: context.factualReleaseId,
    factualReleaseArtifact: context.factualReleaseArtifact,
    releaseMembershipArtifact: context.releaseMembershipArtifact,
    preparationAuthority: 'authenticated_calculation_evidence_snapshot',
    qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
    qualificationReportId: context.sourceQualificationReportId,
    qualificationReportArtifact: context.sourceQualificationReportArtifact,
    sourceQualificationEvidenceRefs: context.sourceQualificationEvidenceRefs,
    valuationInputBundleId: context.valuationInputBundleId,
    valuationInputBundleArtifact: context.valuationInputBundleArtifact,
    releaseTradeIds: context.releaseTradeIds,
    entries: [{
      tradeId: 'trade-a',
      state: 'ready',
      materializationManifestId: `private-evaluation-materialization-manifest:${digest('d')}`,
      materializationManifestArtifact: artifact('e'),
    }],
    tradeCount: 1,
    readyCount: 1,
    blockedCount: 0,
    preparedAt: context.capturedAt,
    publicationEligible: false,
    limitation:
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
  });
  return {
    context,
    valuationInputBundle: bundle.valuationInputBundle,
    preparedInputSet,
    commitInput: { context, preparedInputSet },
  };
}
