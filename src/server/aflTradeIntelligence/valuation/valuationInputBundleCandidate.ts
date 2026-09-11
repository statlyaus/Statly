import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_INPUT_BUNDLE_SCHEMA_VERSION,
  aflTradeValuationInputBundleSchema,
  type AflTradeValuationInputBundle,
} from '../artifacts/valuationInputBundle';
import { governedValuationComponentRunManifestSchema } from './internal/governedValuationComponentRunManifest';
import { aflTradeQualifiedCurrentValuationModelEvidenceResultSchema } from './currentValuationModelEvidence';

const LIMITATION =
  'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.' as const;

export type AflTradeValuationInputBundleCandidateInput = Readonly<{
  modelEvidence: unknown;
  playerRun: unknown;
  pickRun: unknown;
  valueUnitId: string;
  createdAt: string;
  currentView: Readonly<{
    effectiveAt: string;
    knowledgeCutoffAt: string;
    valuationAsOf: string;
  }>;
  policies: Readonly<{
    listSpot: AflTradeArtifactRef;
    scarcity: AflTradeArtifactRef;
    roleCongestion: AflTradeArtifactRef;
    lowReturn: AflTradeArtifactRef;
    eliteOutcome: AflTradeArtifactRef;
    practicalEquivalence: AflTradeArtifactRef;
    explanation: AflTradeArtifactRef;
  }>;
  simulation: Readonly<{ draws: number; seed: string }>;
}>;

export function createAflTradeValuationInputBundleCandidate(
  input: AflTradeValuationInputBundleCandidateInput
): AflTradeValuationInputBundle {
  const modelEvidence = aflTradeQualifiedCurrentValuationModelEvidenceResultSchema.parse(
    input.modelEvidence
  );
  const playerRun = governedValuationComponentRunManifestSchema.parse(input.playerRun);
  const pickRun = governedValuationComponentRunManifestSchema.parse(input.pickRun);

  if (
    playerRun.content.schemaVersion !== 'governed-valuation-component-run/v2' ||
    pickRun.content.schemaVersion !== 'governed-valuation-component-run/v2'
  ) {
    throw new TypeError('Valuation input candidates require successor component-run manifests.');
  }

  if (
    playerRun.content.role !== 'player_contribution_and_availability' ||
    playerRun.runId !== modelEvidence.playerRunId
  ) {
    throw new TypeError('Player component run does not match qualified current model evidence.');
  }
  if (
    pickRun.content.role !== 'draft_pick_and_future_pick_distribution' ||
    pickRun.runId !== modelEvidence.pickRunId
  ) {
    throw new TypeError('Pick component run does not match qualified current model evidence.');
  }
  if (Date.parse(input.createdAt) < Date.parse(modelEvidence.completedAt)) {
    throw new TypeError('Valuation input bundle cannot predate qualified model evidence.');
  }
  if (
    Date.parse(playerRun.content.registeredAt) > Date.parse(modelEvidence.capturedAt) ||
    Date.parse(pickRun.content.registeredAt) > Date.parse(modelEvidence.capturedAt)
  ) {
    throw new TypeError('Qualified model evidence cannot predate its component registrations.');
  }

  const content = {
    schemaVersion: AFL_TRADE_VALUATION_INPUT_BUNDLE_SCHEMA_VERSION,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    environment: 'non_production' as const,
    scopeKey: modelEvidence.scopeKey,
    valueUnitId: input.valueUnitId,
    createdAt: input.createdAt,
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        modelKind: 'player_contribution_and_availability' as const,
        protocolId: playerRun.content.protocolId,
        runId: playerRun.runId,
        datasetId: playerRun.content.datasetId,
        gate3DecisionId: modelEvidence.playerGate3DecisionId,
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        modelKind: 'draft_pick_and_future_pick_distribution' as const,
        protocolId: pickRun.content.protocolId,
        runId: pickRun.runId,
        datasetId: pickRun.content.datasetId,
        gate3DecisionId: modelEvidence.pickGate3DecisionId,
      },
    ],
    viewPolicy: {
      atTrade: {
        modelVintage: 'historical_restatement' as const,
        knowledgeCutoff: 'transaction_effective_at_exclusive' as const,
      },
      current: { modelVintage: 'current' as const, ...input.currentView },
      currentViewsShareOneTemporalContext: true as const,
    },
    packagePolicy: {
      calculationUnit: 'complete_multi_party_trade' as const,
      attribution: 'lineage_frontier_exactly_once' as const,
      aggregation: 'joint_simulation_not_independent_point_sum' as const,
      currentOutcomeIdentity: 'realized_club_value_plus_remaining_asset_value' as const,
      unresolvedAssetTreatment: 'exclude_with_explicit_reason_no_fallback_value' as const,
      listSpotPolicyArtifact: input.policies.listSpot,
      scarcityPolicyArtifact: input.policies.scarcity,
      roleCongestionPolicyArtifact: input.policies.roleCongestion,
    },
    simulation: {
      mode: 'deterministic_counter_sample' as const,
      draws: input.simulation.draws,
      seed: input.simulation.seed,
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1' as const,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: input.policies.lowReturn,
      eliteOutcomeDefinitionArtifact: input.policies.eliteOutcome,
      practicalEquivalenceDefinitionArtifact: input.policies.practicalEquivalence,
    },
    explanationPolicyArtifact: input.policies.explanation,
    publicationEligible: false as const,
    limitation: LIMITATION,
  };

  return aflTradeValuationInputBundleSchema.parse({
    valuationInputBundleId: createAflTradeContentAddress('valuation-input-bundle', content),
    content,
  });
}
