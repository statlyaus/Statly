import { describe, expect, it } from 'vitest';

import {
  aflTradePickDistributionBenchmarkConfigSchema,
  aflTradePickDistributionBenchmarkFitContentSchema,
  fitAflTradePickDistributionBenchmark,
  type AflTradePickDistributionBenchmarkConfig,
} from '@/server/aflTradeIntelligence/modeling/pickDistributionBenchmark';
import {
  createAflTradePickOutcomeObservationSet,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSetContent,
} from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);

function matureOutcome(
  contribution: number,
  category: Extract<
    AflTradePickOutcomeObservation['outcome'],
    { state: 'mature_observed' }
  >['category']
): AflTradePickOutcomeObservation['outcome'] {
  return {
    state: 'mature_observed',
    contribution,
    gamesPlayed: category === 'no_afl_game' ? 0 : 40,
    category,
  };
}

function observation({
  id,
  partition,
  draftYear,
  actualSelectionNumber = 1,
  outcome,
  selection,
}: {
  id: string;
  partition: AflTradePickOutcomeObservation['partition'];
  draftYear: number;
  actualSelectionNumber?: number | null;
  outcome: AflTradePickOutcomeObservation['outcome'];
  selection?: Partial<AflTradePickOutcomeObservation['selection']>;
}): AflTradePickOutcomeObservation {
  const horizon = `${draftYear + 2}-12-31T00:00:00.000Z`;
  const isCensored = outcome.state === 'right_censored';
  const outcomeObservedAt = isCensored
    ? `${draftYear + 1}-01-01T00:00:00.000Z`
    : `${draftYear + 3}-01-01T00:00:00.000Z`;
  return {
    observationId: `observation-${id}`,
    playerId: `player-${id}`,
    draftClassId: `draft-class-${draftYear}`,
    draftYear,
    partition,
    predictionCutoffAt: `${draftYear}-01-01T00:00:00.000Z`,
    selectionKnownAt: `${draftYear - 1}-12-31T00:00:00.000Z`,
    outcomeHorizonEndsAt: horizon,
    outcomeObservedAt,
    selection: {
      pathway: 'national',
      access: 'open',
      nominalSelectionNumber: actualSelectionNumber,
      actualSelectionNumber,
      bidSelectionNumber: null,
      draftRound: 1,
      ...selection,
    },
    era: 'fixture-era',
    playerPosition: 'midfielder',
    ageAtDraft: 18.5,
    evidenceQuality: 'high',
    outcome:
      outcome.state === 'right_censored' ? { ...outcome, censoredAt: outcomeObservedAt } : outcome,
  };
}

function observationSetContent(): AflTradePickOutcomeObservationSetContent {
  return {
    schemaVersion: 'afl-trade-pick-observation-set/v1',
    publicAssetBoundary: 'source_native_afl_draft_selection_no_fantasy_ownership',
    datasetId: `dataset:${digest('1')}`,
    modelProtocolId: `model-protocol:${digest('2')}`,
    valueUnitId: 'fixture-contribution-unit',
    fixedHorizonSeasons: 2,
    fixedHorizonDefinitionArtifactId: `artifact:${digest('3')}`,
    outcomeDefinitionArtifactId: `artifact:${digest('4')}`,
    curveEligibility: 'open_access_national_draft_actual_selection_only',
    observations: [
      observation({
        id: 'train-pick-1-a',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: 1,
        outcome: matureOutcome(100, 'elite'),
      }),
      observation({
        id: 'train-pick-1-b',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: 1,
        outcome: matureOutcome(80, 'high_quality'),
      }),
      observation({
        id: 'train-pick-3',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: 3,
        outcome: matureOutcome(20, 'replacement_level'),
      }),
      observation({
        id: 'train-pick-5',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: 5,
        outcome: matureOutcome(40, 'regular_contributor'),
      }),
      observation({
        id: 'train-restricted',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: 2,
        outcome: matureOutcome(10_000, 'elite'),
        selection: {
          access: 'academy_bid_match',
          bidSelectionNumber: 2,
        },
      }),
      observation({
        id: 'train-rookie',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: null,
        outcome: matureOutcome(10_000, 'elite'),
        selection: {
          pathway: 'rookie',
          nominalSelectionNumber: null,
          draftRound: null,
        },
      }),
      observation({
        id: 'train-unavailable',
        partition: 'train',
        draftYear: 1998,
        actualSelectionNumber: 4,
        outcome: { state: 'unavailable', reason: 'source_missing' },
      }),
      observation({
        id: 'train-censored-cohort',
        partition: 'train',
        draftYear: 2000,
        actualSelectionNumber: 1,
        outcome: {
          state: 'right_censored',
          contributionObservedToDate: 500,
          gamesObservedToDate: 20,
          censoredAt: '2001-01-01T00:00:00.000Z',
        },
      }),
      observation({
        id: 'calibration',
        partition: 'calibration',
        draftYear: 2004,
        actualSelectionNumber: 1,
        outcome: matureOutcome(20_000, 'elite'),
      }),
      observation({
        id: 'validation',
        partition: 'validation',
        draftYear: 2008,
        actualSelectionNumber: 1,
        outcome: matureOutcome(30_000, 'elite'),
      }),
      observation({
        id: 'final-test',
        partition: 'final_test',
        draftYear: 2012,
        actualSelectionNumber: 1,
        outcome: {
          state: 'right_censored',
          contributionObservedToDate: 40_000,
          gamesObservedToDate: 20,
          censoredAt: '2013-01-01T00:00:00.000Z',
        },
      }),
    ],
  };
}

function config(minimumBlockObservations = 2): AflTradePickDistributionBenchmarkConfig {
  return {
    schemaVersion: 'afl-trade-pick-distribution-benchmark-config/v1',
    minimumBlockObservations,
    eligibility: 'mature_open_access_national_draft_training_observations',
    informationWeight: 'eligible_player_count',
    sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
    interpolation: 'left_block_carry_forward_within_training_domain',
    extrapolation: 'prohibited',
    estimatorStatus: 'benchmark_only_not_censor_aware_candidate',
  };
}

describe('AFL trade-intelligence pick-distribution benchmark', () => {
  it('fits a monotone empirical distribution with player-count information weights', () => {
    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config()
    );

    expect(fit.content.distributionBlocks).toHaveLength(2);
    expect(fit.content.distributionBlocks[0]).toMatchObject({
      sourceSelectionNumbers: [1],
      fittedExpectedContribution: 90,
      observationCount: 2,
      p10Contribution: 80,
      p50Contribution: 80,
      p90Contribution: 100,
    });
    expect(fit.content.distributionBlocks[1]).toMatchObject({
      sourceSelectionNumbers: [3, 5],
      fittedExpectedContribution: 30,
      observationCount: 2,
    });
    expect(
      fit.content.distributionBlocks[0].outcomeProbabilities.map(({ probability }) => probability)
    ).toEqual([0, 0, 0, 0, 0.5, 0.5]);
    expect(fit.content.distributionBlocks[1].empiricalSupport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contribution: 20, probability: 0.5 }),
        expect.objectContaining({ contribution: 40, probability: 0.5 }),
      ])
    );
  });

  it('accounts explicitly for held-out, censored, unavailable, pathway, and access exclusions', () => {
    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config()
    );

    expect(fit.content.trainingObservationIds).toEqual([
      'observation-train-pick-1-a',
      'observation-train-pick-1-b',
      'observation-train-pick-3',
      'observation-train-pick-5',
    ]);
    expect(fit.content.excludedObservations).toEqual(
      expect.arrayContaining([
        { observationId: 'observation-train-censored-cohort', reason: 'right_censored' },
        { observationId: 'observation-train-unavailable', reason: 'outcome_unavailable' },
        { observationId: 'observation-train-rookie', reason: 'non_national_pathway' },
        { observationId: 'observation-train-restricted', reason: 'restricted_access' },
        { observationId: 'observation-calibration', reason: 'held_out_partition' },
        { observationId: 'observation-validation', reason: 'held_out_partition' },
        { observationId: 'observation-final-test', reason: 'held_out_partition' },
      ])
    );
    expect(fit.content.diagnostics).toMatchObject({
      inputObservationCount: 11,
      eligibleTrainingObservationCount: 4,
      excludedObservationCount: 7,
    });
  });

  it('does not let censored, restricted, non-national, or held-out extremes leak into the fit', () => {
    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config()
    );

    expect(
      fit.content.distributionBlocks.map(
        ({ fittedExpectedContribution }) => fittedExpectedContribution
      )
    ).toEqual([90, 30]);
    expect(
      fit.content.distributionBlocks.flatMap(({ empiricalSupport }) =>
        empiricalSupport.map(({ contribution }) => contribution)
      )
    ).toEqual(expect.arrayContaining([100, 80, 20, 40]));
    expect(
      fit.content.distributionBlocks.some(({ empiricalSupport }) =>
        empiricalSupport.some(({ contribution }) => contribution >= 500)
      )
    ).toBe(false);
  });

  it('merges sparse blocks deterministically while retaining a monotone empirical mean', () => {
    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config(3)
    );

    expect(fit.content.distributionBlocks).toHaveLength(1);
    expect(fit.content.distributionBlocks[0]).toMatchObject({
      sourceSelectionNumbers: [1, 3, 5],
      observationCount: 4,
      fittedExpectedContribution: 60,
    });
  });

  it('interpolates only inside the observed selection domain without inventing extrapolation', () => {
    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config()
    );

    expect(fit.content.selectionCurve.map(({ selectionNumber }) => selectionNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      fit.content.selectionCurve.map(
        ({ selectionNumber, distributionBlockIndex, expectedContribution }) => ({
          selectionNumber,
          distributionBlockIndex,
          expectedContribution,
        })
      )
    ).toEqual([
      { selectionNumber: 1, distributionBlockIndex: 0, expectedContribution: 90 },
      { selectionNumber: 2, distributionBlockIndex: 0, expectedContribution: 90 },
      { selectionNumber: 3, distributionBlockIndex: 1, expectedContribution: 30 },
      { selectionNumber: 4, distributionBlockIndex: 1, expectedContribution: 30 },
      { selectionNumber: 5, distributionBlockIndex: 1, expectedContribution: 30 },
    ]);
  });

  it('is order invariant, content addressed, provenance bound, and input immutable', () => {
    const content = observationSetContent();
    const input = createAflTradePickOutcomeObservationSet(content);
    const before = structuredClone(input);
    const forward = fitAflTradePickDistributionBenchmark(input, config());
    const reverse = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet({
        ...content,
        observations: [...content.observations].reverse(),
      }),
      config()
    );

    expect(forward).toEqual(reverse);
    expect(input).toEqual(before);
    expect(forward.benchmarkFitId).toMatch(/^pick-benchmark-fit:[a-f0-9]{64}$/);
    expect(forward.content).toMatchObject({
      observationSetId: input.observationSetId,
      datasetId: input.content.datasetId,
      modelProtocolId: input.content.modelProtocolId,
      valueUnitId: input.content.valueUnitId,
      publicAssetBoundary: 'source_native_afl_draft_selection_no_fantasy_ownership',
    });
  });

  it('rejects malformed configuration and internally inconsistent distributions', () => {
    expect(
      aflTradePickDistributionBenchmarkConfigSchema.safeParse({
        ...config(),
        minimumBlockObservations: 0,
      }).success
    ).toBe(false);
    expect(
      aflTradePickDistributionBenchmarkConfigSchema.safeParse({
        ...config(),
        informationWeight: 'games_played',
      }).success
    ).toBe(false);

    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config()
    );
    expect(
      aflTradePickDistributionBenchmarkFitContentSchema.safeParse({
        ...fit.content,
        selectionCurve: fit.content.selectionCurve.slice(1),
      }).success
    ).toBe(false);
    expect(
      aflTradePickDistributionBenchmarkFitContentSchema.safeParse({
        ...fit.content,
        distributionBlocks: fit.content.distributionBlocks.map((block, index) =>
          index === 0
            ? {
                ...block,
                empiricalSupport: block.empiricalSupport.map((support) => ({
                  ...support,
                  probability: 0.6,
                })),
              }
            : block
        ),
      }).success
    ).toBe(false);
  });

  it('preserves the public-AFL no-fantasy-ownership boundary in strict output contracts', () => {
    const fit = fitAflTradePickDistributionBenchmark(
      createAflTradePickOutcomeObservationSet(observationSetContent()),
      config()
    );

    expect(
      aflTradePickDistributionBenchmarkFitContentSchema.safeParse({
        ...fit.content,
        fantasyLeagueId: 'league-1',
        ownerId: 'user-1',
      }).success
    ).toBe(false);
  });
});
