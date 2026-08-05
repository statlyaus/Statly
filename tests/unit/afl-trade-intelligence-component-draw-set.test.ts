import { describe, expect, it } from 'vitest';

import {
  aflTradeComponentDrawSetSchema,
  createAflTradeComponentDrawSet,
  type AflTradeComponentDrawSetContent,
} from '@/server/aflTradeIntelligence/valuation/componentDrawSet';

function digest(character: string): string {
  return character.repeat(64);
}

const playerComponent = {
  role: 'player_contribution_and_availability' as const,
  modelKind: 'player_contribution_and_availability' as const,
  protocolId: `model-protocol:${digest('1')}`,
  runId: `model-run:${digest('2')}`,
  datasetId: `dataset:${digest('3')}`,
  gate3DecisionId: `gate-decision:${digest('4')}`,
};

const pickComponent = {
  role: 'draft_pick_and_future_pick_distribution' as const,
  modelKind: 'draft_pick_and_future_pick_distribution' as const,
  protocolId: `model-protocol:${digest('5')}`,
  runId: `model-run:${digest('6')}`,
  datasetId: `dataset:${digest('7')}`,
  gate3DecisionId: `gate-decision:${digest('8')}`,
};

function forecast(view: 'at_trade' | 'remaining', values: Array<{ raw: number; weight: number }>) {
  const seasons = values.map(({ raw, weight }, seasonOffset) => ({
    seasonOffset,
    undiscountedContribution: raw,
    footballTimingWeight: weight,
    timingAdjustedContribution: raw * weight,
  }));
  return {
    view,
    timingTreatment: 'component_applied_football_timing_only_no_market_discount' as const,
    seasons,
    undiscountedContribution: seasons.reduce(
      (sum, season) => sum + season.undiscountedContribution,
      0
    ),
    timingAdjustedContribution: seasons.reduce(
      (sum, season) => sum + season.timingAdjustedContribution,
      0
    ),
  };
}

function outcome(
  assetId: string,
  componentRole: 'player_contribution_and_availability' | 'draft_pick_and_future_pick_distribution',
  scale: number
) {
  return {
    assetId,
    componentRole,
    forecasts: [
      forecast('at_trade', [
        { raw: 10 * scale, weight: 1 },
        { raw: 8 * scale, weight: 0.9 },
      ]),
      forecast('remaining', [
        { raw: 6 * scale, weight: 1 },
        { raw: 4 * scale, weight: 0.9 },
      ]),
    ],
  };
}

function content(): AflTradeComponentDrawSetContent {
  return {
    schemaVersion: 'afl-trade-component-draw-set/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationBundleId: `valuation-bundle:${digest('9')}`,
    valueUnitId: 'football-contribution-above-replacement-v1',
    components: [playerComponent, pickComponent],
    execution: {
      mode: 'exact_joint_mixture',
      samplingAlgorithmVersion: null,
      seed: null,
      monteCarloError: 'zero_exact_enumeration',
    },
    assets: [
      {
        status: 'supported',
        assetId: 'asset:future-pick-b',
        assetKind: 'future_pick_entitlement',
        componentRole: 'draft_pick_and_future_pick_distribution',
        forecastRepresentation: 'season_path',
      },
      {
        status: 'supported',
        assetId: 'asset:player-a',
        assetKind: 'player',
        componentRole: 'player_contribution_and_availability',
        forecastRepresentation: 'season_path',
      },
      {
        status: 'excluded',
        assetId: 'asset:unresolved-c',
        assetKind: 'unresolved',
        componentRole: null,
        reasonCode: 'lineage-unresolved',
        explanation: 'The fabricated consideration has no resolved value-bearing successor.',
      },
    ],
    draws: [
      {
        drawIndex: 0,
        drawKey: 'draw:0',
        probabilityWeight: 0.4,
        sharedFactorStates: [
          { kind: 'draft_class', factorKey: 'draft-class:2027', stateId: 'class:strong' },
          { kind: 'future_ladder', factorKey: 'season:2026', stateId: 'ladder:one' },
        ],
        assetOutcomes: [
          outcome('asset:future-pick-b', 'draft_pick_and_future_pick_distribution', 1.2),
          outcome('asset:player-a', 'player_contribution_and_availability', 1),
        ],
      },
      {
        drawIndex: 1,
        drawKey: 'draw:1',
        probabilityWeight: 0.6,
        sharedFactorStates: [
          { kind: 'draft_class', factorKey: 'draft-class:2027', stateId: 'class:weak' },
          { kind: 'future_ladder', factorKey: 'season:2026', stateId: 'ladder:two' },
        ],
        assetOutcomes: [
          outcome('asset:future-pick-b', 'draft_pick_and_future_pick_distribution', 0.7),
          outcome('asset:player-a', 'player_contribution_and_availability', 1.1),
        ],
      },
    ],
    uncertaintyTreatments: [
      {
        kind: 'model_estimation',
        treatment: 'reported_separately',
        reasonCode: 'external-cluster-bootstrap',
      },
      {
        kind: 'outcome_distribution',
        treatment: 'included_in_draws',
        reasonCode: 'component-outcome-state',
      },
      {
        kind: 'draft_class_shared_effect',
        treatment: 'included_in_draws',
        reasonCode: 'shared-class-state',
      },
      {
        kind: 'future_ladder_landing',
        treatment: 'included_in_draws',
        reasonCode: 'joint-ladder-state',
      },
      {
        kind: 'monte_carlo_error',
        treatment: 'not_available',
        reasonCode: 'exact-mixture-zero-error',
      },
    ],
    limitation:
      'Normalized source-independent component handoff only; not source approval, model calibration, Gate approval, or publication readiness.',
  };
}

describe('AFL trade-intelligence component draw set', () => {
  it('canonicalizes semantic order without destroying joint draw alignment', () => {
    const canonical = createAflTradeComponentDrawSet(content());
    const reversed = content();
    reversed.components.reverse();
    reversed.assets.reverse();
    reversed.draws.reverse();
    reversed.uncertaintyTreatments.reverse();
    for (const draw of reversed.draws) {
      draw.sharedFactorStates.reverse();
      draw.assetOutcomes.reverse();
      for (const assetOutcome of draw.assetOutcomes) {
        assetOutcome.forecasts.reverse();
        for (const item of assetOutcome.forecasts) item.seasons.reverse();
      }
    }

    const normalized = createAflTradeComponentDrawSet(reversed);

    expect(normalized).toEqual(canonical);
    expect(normalized.content.draws.map((draw) => draw.drawKey)).toEqual(['draw:0', 'draw:1']);
    expect(normalized.content.draws[0].assetOutcomes.map((item) => item.assetId)).toEqual([
      'asset:future-pick-b',
      'asset:player-a',
    ]);
  });

  it('rejects probability gaps, non-contiguous indices, and duplicate draw keys', () => {
    const probabilityGap = content();
    probabilityGap.draws[1].probabilityWeight = 0.5;
    const indexGap = content();
    indexGap.draws[1].drawIndex = 2;
    const duplicateKey = content();
    duplicateKey.draws[1].drawKey = duplicateKey.draws[0].drawKey;

    expect(() => createAflTradeComponentDrawSet(probabilityGap)).toThrow(/probability mass/i);
    expect(() => createAflTradeComponentDrawSet(indexGap)).toThrow(/contiguous indices/i);
    expect(() => createAflTradeComponentDrawSet(duplicateKey)).toThrow(/unique keys/i);
  });

  it('requires every supported asset in every draw with its declared component role', () => {
    const missingAsset = content();
    missingAsset.draws[1].assetOutcomes.pop();
    const swappedRole = content();
    swappedRole.draws[0].assetOutcomes[0].componentRole = 'player_contribution_and_availability';
    const excludedAsOutcome = content();
    excludedAsOutcome.draws[0].assetOutcomes.push(
      outcome('asset:unresolved-c', 'player_contribution_and_availability', 1)
    );

    expect(() => createAflTradeComponentDrawSet(missingAsset)).toThrow(/same supported assets/i);
    expect(() => createAflTradeComponentDrawSet(swappedRole)).toThrow(/component roles/i);
    expect(() => createAflTradeComponentDrawSet(excludedAsOutcome)).toThrow(
      /same supported assets/i
    );
  });

  it('rejects shared-factor key drift while allowing state values to vary jointly', () => {
    const keyDrift = content();
    keyDrift.draws[1].sharedFactorStates[0].factorKey = 'draft-class:2028';
    const duplicateFactor = content();
    duplicateFactor.draws[0].sharedFactorStates[1] = {
      ...duplicateFactor.draws[0].sharedFactorStates[0],
    };

    expect(() => createAflTradeComponentDrawSet(keyDrift)).toThrow(/shared-factor keys/i);
    expect(() => createAflTradeComponentDrawSet(duplicateFactor)).toThrow(/shared-factor keys/i);
    expect(() => createAflTradeComponentDrawSet(content())).not.toThrow();
  });

  it('reconciles every season transformation and forecast total', () => {
    const invalidProduct = content();
    invalidProduct.draws[0].assetOutcomes[0].forecasts[0].seasons[0].timingAdjustedContribution += 1;
    const invalidTotal = content();
    invalidTotal.draws[0].assetOutcomes[0].forecasts[0].undiscountedContribution += 1;
    const duplicateOffset = content();
    duplicateOffset.draws[0].assetOutcomes[0].forecasts[0].seasons[1].seasonOffset = 0;

    expect(() => createAflTradeComponentDrawSet(invalidProduct)).toThrow(
      /raw contribution times weight/i
    );
    expect(() => createAflTradeComponentDrawSet(invalidTotal)).toThrow(/reconcile/i);
    expect(() => createAflTradeComponentDrawSet(duplicateOffset)).toThrow(/season offsets/i);
  });

  it('keeps exact-mixture and sampled Monte Carlo treatment distinct', () => {
    const mislabeledExact = content();
    mislabeledExact.uncertaintyTreatments[4].treatment = 'reported_separately';
    const sampled = content();
    sampled.execution = {
      mode: 'deterministic_counter_sample',
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1',
      seed: 'fixture-stage5-seed',
      monteCarloError: 'requires_downstream_reporting',
    };
    sampled.uncertaintyTreatments[4].treatment = 'reported_separately';

    expect(() => createAflTradeComponentDrawSet(mislabeledExact)).toThrow(/execution mode/i);
    expect(() => createAflTradeComponentDrawSet(sampled)).not.toThrow();
  });

  it('rejects ownership fields, market discounting, and undeclared marginal assets', () => {
    const valid = createAflTradeComponentDrawSet(content());
    const forbidden = [
      { ...valid.content, userId: 'user-1' },
      { ...valid.content, fantasyLeagueId: 'league-1' },
      {
        ...valid.content,
        assets: [
          { ...valid.content.assets[0], ownerId: 'owner-1' },
          ...valid.content.assets.slice(1),
        ],
      },
      {
        ...valid.content,
        draws: [
          {
            ...valid.content.draws[0],
            assetOutcomes: [
              {
                ...valid.content.draws[0].assetOutcomes[0],
                forecasts: [
                  {
                    ...valid.content.draws[0].assetOutcomes[0].forecasts[0],
                    marketDiscountRate: 0.1,
                  },
                  valid.content.draws[0].assetOutcomes[0].forecasts[1],
                ],
              },
              ...valid.content.draws[0].assetOutcomes.slice(1),
            ],
          },
          ...valid.content.draws.slice(1),
        ],
      },
    ];

    for (const invalidContent of forbidden) {
      expect(
        aflTradeComponentDrawSetSchema.safeParse({
          componentDrawSetId: valid.componentDrawSetId,
          content: invalidContent,
        }).success
      ).toBe(false);
    }
  });

  it('requires both governed components and detects content-address tampering', () => {
    const duplicateComponent = content();
    duplicateComponent.components = [playerComponent, playerComponent];
    expect(() => createAflTradeComponentDrawSet(duplicateComponent)).toThrow(/both governed/i);

    const valid = createAflTradeComponentDrawSet(content());
    expect(
      aflTradeComponentDrawSetSchema.safeParse({
        ...valid,
        content: { ...valid.content, valueUnitId: 'tampered-unit' },
      }).success
    ).toBe(false);
  });
});
