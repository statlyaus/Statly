import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeValuationInputBundleSchema } from '@/server/aflTradeIntelligence/artifacts/valuationInputBundle';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-15T01:00:00.000Z',
  };
}

function inputBundleContent() {
  return {
    schemaVersion: 'afl-trade-valuation-input-bundle/v1' as const,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    environment: 'non_production' as const,
    scopeKey: 'afl-public-trade-value',
    valueUnitId: 'contribution-above-replacement-v1',
    createdAt: '2026-08-15T02:00:00.000Z',
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
    viewPolicy: {
      atTrade: {
        modelVintage: 'historical_restatement' as const,
        knowledgeCutoff: 'transaction_effective_at_exclusive' as const,
      },
      current: {
        modelVintage: 'current' as const,
        effectiveAt: '2026-08-14T23:59:59.000Z',
        knowledgeCutoffAt: '2026-08-14T23:59:59.000Z',
        valuationAsOf: '2026-08-15T00:00:00.000Z',
      },
      currentViewsShareOneTemporalContext: true as const,
    },
    packagePolicy: {
      calculationUnit: 'complete_multi_party_trade' as const,
      attribution: 'lineage_frontier_exactly_once' as const,
      aggregation: 'joint_simulation_not_independent_point_sum' as const,
      currentOutcomeIdentity: 'realized_club_value_plus_remaining_asset_value' as const,
      unresolvedAssetTreatment: 'exclude_with_explicit_reason_no_fallback_value' as const,
      listSpotPolicyArtifact: artifact('9'),
      scarcityPolicyArtifact: artifact('a'),
      roleCongestionPolicyArtifact: artifact('b'),
    },
    simulation: {
      mode: 'deterministic_counter_sample' as const,
      draws: 10_000,
      seed: 'valuation-input-seed-20260815',
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1' as const,
      centralIntervalLevel: 0.8 as const,
      downsideQuantile: 0.1 as const,
      upsideQuantile: 0.9 as const,
      lowReturnDefinitionArtifact: artifact('c'),
      eliteOutcomeDefinitionArtifact: artifact('d'),
      practicalEquivalenceDefinitionArtifact: artifact('e'),
    },
    explanationPolicyArtifact: artifact('f'),
    publicationEligible: false as const,
    limitation:
      'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.',
  };
}

describe('AFL trade-intelligence valuation input bundle', () => {
  it('accepts an immutable governed bundle before trade calculation produces execution outputs', () => {
    const content = inputBundleContent();
    const bundle = {
      valuationInputBundleId: createAflTradeContentAddress('valuation-input-bundle', content),
      content,
    };

    const parsed = aflTradeValuationInputBundleSchema.parse(bundle);

    expect(parsed).toEqual(bundle);
    expect(parsed.content).not.toHaveProperty('execution');
    expect(parsed.content).not.toHaveProperty('outputs');
  });

  it('is non-production-only in the local rehearsal contract', () => {
    const content = { ...inputBundleContent(), environment: 'production' as const };
    expect(() =>
      aflTradeValuationInputBundleSchema.parse({
        valuationInputBundleId: createAflTradeContentAddress('valuation-input-bundle', content),
        content,
      })
    ).toThrow();
  });
});
