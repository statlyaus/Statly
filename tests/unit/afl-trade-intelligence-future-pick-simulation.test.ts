import { describe, expect, it } from 'vitest';

import {
  aflTradeFuturePickSimulationContentSchema,
  aflTradeFuturePickSimulationSchema,
  simulateAflTradeFuturePicks,
  type AflTradeFuturePickSimulationConfig,
} from '@/server/aflTradeIntelligence/modeling/futurePickSimulation';
import {
  createAflTradeFuturePickScenario,
  type AflTradeFuturePickScenarioContent,
} from '@/server/aflTradeIntelligence/modeling/futurePickContracts';
import {
  fitAflTradePickDistributionBenchmark,
  type AflTradePickDistributionBenchmarkConfig,
} from '@/server/aflTradeIntelligence/modeling/pickDistributionBenchmark';
import {
  createAflTradePickOutcomeObservationSet,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSetContent,
} from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);
const modelRunId = `model-run:${digest('9')}`;

function outcome(
  contribution: number,
  category: Extract<
    AflTradePickOutcomeObservation['outcome'],
    { state: 'mature_observed' }
  >['category']
): AflTradePickOutcomeObservation['outcome'] {
  return {
    state: 'mature_observed',
    contribution,
    gamesPlayed: category === 'no_afl_game' ? 0 : 30,
    category,
  };
}

function observation(
  id: string,
  partition: AflTradePickOutcomeObservation['partition'],
  draftYear: number,
  selection: number,
  observedOutcome: AflTradePickOutcomeObservation['outcome']
): AflTradePickOutcomeObservation {
  return {
    observationId: `observation-${id}`,
    playerId: `player-${id}`,
    draftClassId: `draft-class-${draftYear}`,
    draftYear,
    partition,
    predictionCutoffAt: `${draftYear}-01-01T00:00:00.000Z`,
    selectionKnownAt: `${draftYear - 1}-12-31T00:00:00.000Z`,
    outcomeHorizonEndsAt: `${draftYear + 2}-12-31T00:00:00.000Z`,
    outcomeObservedAt: `${draftYear + 3}-01-01T00:00:00.000Z`,
    selection: {
      pathway: 'national',
      access: 'open',
      nominalSelectionNumber: selection,
      actualSelectionNumber: selection,
      bidSelectionNumber: null,
      draftRound: selection === 1 ? 1 : 2,
    },
    era: 'fixture-era',
    playerPosition: 'midfielder',
    ageAtDraft: 18.5,
    evidenceQuality: 'high',
    outcome: observedOutcome,
  };
}

function benchmark() {
  const content: AflTradePickOutcomeObservationSetContent = {
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
      observation('train-pick-1-elite', 'train', 1998, 1, outcome(100, 'elite')),
      observation('train-pick-1-bust', 'train', 1998, 1, outcome(0, 'no_afl_game')),
      observation('train-pick-5-short', 'train', 1998, 5, outcome(20, 'short_career')),
      observation('train-pick-5-regular', 'train', 1998, 5, outcome(40, 'regular_contributor')),
      observation('calibration', 'calibration', 2004, 1, outcome(50, 'regular_contributor')),
      observation('validation', 'validation', 2008, 1, outcome(50, 'regular_contributor')),
      observation('final-test', 'final_test', 2012, 1, outcome(50, 'regular_contributor')),
    ],
  };
  const config: AflTradePickDistributionBenchmarkConfig = {
    schemaVersion: 'afl-trade-pick-distribution-benchmark-config/v1',
    minimumBlockObservations: 1,
    eligibility: 'mature_open_access_national_draft_training_observations',
    informationWeight: 'eligible_player_count',
    sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
    interpolation: 'left_block_carry_forward_within_training_domain',
    extrapolation: 'prohibited',
    estimatorStatus: 'benchmark_only_not_censor_aware_candidate',
  };
  return fitAflTradePickDistributionBenchmark(
    createAflTradePickOutcomeObservationSet(content),
    config
  );
}

function scenarioContent(
  fit: ReturnType<typeof benchmark>,
  overrides: Partial<AflTradeFuturePickScenarioContent> = {}
): AflTradeFuturePickScenarioContent {
  return {
    schemaVersion: 'afl-trade-future-pick-scenario/v1',
    publicAssetBoundary: 'afl_club_entitlements_no_user_or_fantasy_ownership',
    datasetId: `dataset:${digest('5')}`,
    modelProtocolId: fit.content.modelProtocolId,
    pickBenchmarkFitId: fit.benchmarkFitId,
    valueUnitId: fit.content.valueUnitId,
    effectiveAt: '2026-08-01T00:00:00.000Z',
    draftYear: 2027,
    ladderInputArtifactId: `artifact:${digest('6')}`,
    ladderInputKnownAt: '2026-07-31T00:00:00.000Z',
    pickCurveMinimumSelection: 1,
    pickCurveMaximumSelection: 5,
    ladderStates: [
      {
        ladderStateId: 'ladder-a',
        probability: 0.6,
        clubPositions: [
          { aflClubId: 'afl-club-a', finishingPosition: 1 },
          { aflClubId: 'afl-club-b', finishingPosition: 2 },
        ],
      },
      {
        ladderStateId: 'ladder-b',
        probability: 0.4,
        clubPositions: [
          { aflClubId: 'afl-club-a', finishingPosition: 2 },
          { aflClubId: 'afl-club-b', finishingPosition: 1 },
        ],
      },
    ],
    ruleVintage: {
      ruleVintageArtifactId: `artifact:${digest('7')}`,
      knownAt: '2026-07-01T00:00:00.000Z',
      effectiveDraftYearFrom: 2027,
      effectiveDraftYearTo: 2027,
      aflClubCount: 2,
      supportedRounds: 2,
      nominalOrderRule: 'reverse_final_ladder_within_round',
      adjustmentResolution: 'joint_monotone_nominal_to_actual_state_distribution',
      supportedSelectionAccess: 'open_only',
      resolutionStates: [
        {
          ruleResolutionStateId: 'resolution-base',
          probability: 0.75,
          nominalToActualSelections: [1, 2, 3, 4].map((selection) => ({
            nominalSelectionNumber: selection,
            actualSelectionNumber: selection,
          })),
        },
        {
          ruleResolutionStateId: 'resolution-inserted',
          probability: 0.25,
          nominalToActualSelections: [
            { nominalSelectionNumber: 1, actualSelectionNumber: 1 },
            { nominalSelectionNumber: 2, actualSelectionNumber: 3 },
            { nominalSelectionNumber: 3, actualSelectionNumber: 4 },
            { nominalSelectionNumber: 4, actualSelectionNumber: 5 },
          ],
        },
      ],
    },
    futurePickEntitlements: [
      {
        futurePickAssetId: 'future-pick-a',
        aflClubEntitlementHolderId: 'afl-club-b',
        ladderLinkedAflClubId: 'afl-club-a',
        draftYear: 2027,
        round: 1,
        selectionPathway: 'national',
        selectionAccess: 'open',
        bidSelectionNumber: null,
      },
      {
        futurePickAssetId: 'future-pick-b',
        aflClubEntitlementHolderId: 'afl-club-a',
        ladderLinkedAflClubId: 'afl-club-b',
        draftYear: 2027,
        round: 2,
        selectionPathway: 'national',
        selectionAccess: 'open',
        bidSelectionNumber: null,
      },
    ],
    draftClassEffectModelArtifactId: `artifact:${digest('8')}`,
    draftClassEffectStates: [
      {
        draftClassEffectStateId: 'class-effect-high',
        probability: 0.5,
        contributionMultiplier: 1.2,
      },
      {
        draftClassEffectStateId: 'class-effect-low',
        probability: 0.5,
        contributionMultiplier: 0.8,
      },
    ],
    productiveDelayPolicy: {
      productiveDelayModelArtifactId: `artifact:${digest('a')}`,
      footballTimingPolicyArtifactId: `artifact:${digest('b')}`,
      seasonsUntilDraft: 1,
      timingInterpretation: 'football_productivity_timing_only_no_market_impatience',
      categoryDelayDistributions: [
        { category: 'no_afl_game', delayStates: [{ productiveDelaySeasons: 0, probability: 1 }] },
        {
          category: 'short_career',
          delayStates: [
            { productiveDelaySeasons: 1, probability: 0.5 },
            { productiveDelaySeasons: 2, probability: 0.5 },
          ],
        },
        {
          category: 'replacement_level',
          delayStates: [{ productiveDelaySeasons: 0, probability: 1 }],
        },
        {
          category: 'regular_contributor',
          delayStates: [{ productiveDelaySeasons: 1, probability: 1 }],
        },
        {
          category: 'high_quality',
          delayStates: [{ productiveDelaySeasons: 0, probability: 1 }],
        },
        { category: 'elite', delayStates: [{ productiveDelaySeasons: 0, probability: 1 }] },
      ],
      footballTimingWeights: [
        { totalDelaySeasons: 0, footballTimingWeight: 1 },
        { totalDelaySeasons: 1, footballTimingWeight: 0.9 },
        { totalDelaySeasons: 2, footballTimingWeight: 0.8 },
        { totalDelaySeasons: 3, footballTimingWeight: 0.7 },
      ],
    },
    simulationOrder: [
      'joint_ladder_state',
      'rule_vintage_selection_resolution',
      'shared_draft_class_effect',
      'player_outcome',
      'productive_delay',
    ],
    limitation:
      'Scenario contracts provide no source-rights approval, model approval, or deployment approval.',
    ...overrides,
  };
}

function config(
  exactJointStateLimit: number,
  fallbackSampleCount = 1_000,
  seed = 'fixture-simulation-seed'
): AflTradeFuturePickSimulationConfig {
  return {
    schemaVersion: 'afl-trade-future-pick-simulation-config/v1',
    executionPolicy: 'exact_first_then_versioned_counter_sampling',
    exactJointStateLimit,
    fallbackSampleCount,
    seed,
    samplingAlgorithmVersion: 'counter_sha256_rejection_v1',
  };
}

describe('AFL trade-intelligence future-pick simulation', () => {
  it('enumerates the complete finite joint mixture before considering sampling', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const simulation = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(36));

    expect(simulation.content).toMatchObject({
      executionMode: 'exact_finite_mixture',
      theoreticalJointStateCount: '36',
      evaluatedStateCount: 36,
      modelRunId,
      futurePickScenarioId: scenario.futurePickScenarioId,
      pickBenchmarkFitId: fit.benchmarkFitId,
    });
    expect(simulation.content.diagnostics).toMatchObject({
      monteCarloStandardError: 0,
      monteCarloError: 'zero_exact_enumeration',
    });
    expect(simulation.content.diagnostics.probabilityMass).toBeCloseTo(1, 12);
  });

  it('uses one shared class effect and reconciles rule, delay, asset, and package values', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const simulation = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(100));

    for (const draw of simulation.content.draws) {
      expect(
        new Set(
          draw.assetOutcomes.map(
            ({ draftClassContributionMultiplier }) => draftClassContributionMultiplier
          )
        ).size
      ).toBe(1);
      expect(draw.packageContribution).toBeCloseTo(
        draw.assetOutcomes.reduce(
          (sum, { timingAdjustedContribution }) => sum + timingAdjustedContribution,
          0
        ),
        12
      );
      for (const asset of draw.assetOutcomes) {
        expect(asset.bidSelectionNumber).toBeNull();
        expect(asset.totalDelaySeasons).toBe(1 + asset.productiveDelaySeasons);
        expect(asset.actualSelectionNumber).toBeGreaterThanOrEqual(asset.nominalSelectionNumber);
      }
    }
    expect(simulation.content.simulationOrder).toEqual(scenario.content.simulationOrder);
  });

  it('switches to deterministic counter sampling only below the exact-state threshold', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const exact = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(36));
    const sampled = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(35, 1_000));

    expect(exact.content.executionMode).toBe('exact_finite_mixture');
    expect(sampled.content).toMatchObject({
      executionMode: 'deterministic_counter_sample',
      theoreticalJointStateCount: '36',
      evaluatedStateCount: 1_000,
    });
    expect(sampled.content.diagnostics.monteCarloStandardError).toBeGreaterThan(0);
    expect(sampled.content.diagnostics.monteCarloError).toBe('reported_standard_error');
  });

  it('replays exactly for one seed and separates a changed seed without mutating inputs', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const scenarioBefore = structuredClone(scenario);
    const fitBefore = structuredClone(fit);
    const first = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(1, 500));
    const replay = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(1, 500));
    const changedSeed = simulateAflTradeFuturePicks(
      scenario,
      fit,
      modelRunId,
      config(1, 500, 'changed-seed')
    );

    expect(first).toEqual(replay);
    expect(first.futurePickSimulationId).not.toBe(changedSeed.futurePickSimulationId);
    expect(first.content.draws).not.toEqual(changedSeed.content.draws);
    expect(scenario).toEqual(scenarioBefore);
    expect(fit).toEqual(fitBefore);
  });

  it('converges toward the exact oracle consistently with separately reported Monte Carlo error', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const exact = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(100));
    const sampled = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(1, 10_000));
    const absoluteError = Math.abs(
      sampled.content.packageSummary.expectedContribution -
        exact.content.packageSummary.expectedContribution
    );

    expect(absoluteError).toBeLessThanOrEqual(
      sampled.content.diagnostics.monteCarloStandardError * 4
    );
    expect(sampled.content.diagnostics.monteCarloStandardError).toBeLessThan(1);
  });

  it('binds benchmark, protocol, value unit, curve domain, datasets, and model run', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const simulation = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(100));

    expect(simulation.content).toMatchObject({
      futureScenarioDatasetId: scenario.content.datasetId,
      pickOutcomeDatasetId: fit.content.datasetId,
      modelProtocolId: fit.content.modelProtocolId,
      valueUnitId: fit.content.valueUnitId,
      modelRunId,
    });
    expect(() =>
      simulateAflTradeFuturePicks(
        createAflTradeFuturePickScenario(
          scenarioContent(fit, { modelProtocolId: `model-protocol:${digest('c')}` })
        ),
        fit,
        modelRunId,
        config(100)
      )
    ).toThrow(/provenance/i);
    expect(() =>
      simulateAflTradeFuturePicks(scenario, fit, 'model-run:bad', config(100))
    ).toThrow();
  });

  it('reports uncertainty components without relabelling model or Monte Carlo uncertainty', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const exact = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(100));

    expect(exact.content.diagnostics).toMatchObject({
      modelEstimationUncertainty: 'not_included_requires_external_cluster_bootstrap',
      outcomeDistributionUncertainty: 'included',
      draftClassSharedEffectUncertainty: 'included_once_per_joint_state',
      futureLadderLandingUncertainty: 'included_as_joint_ladder_states',
      productiveDelayUncertainty: 'included_separately_from_market_impatience',
    });
    expect(exact.content.limitation).toContain('not source approval');
  });

  it('rejects probability, summary, transformation, content-address, and ownership tampering', () => {
    const fit = benchmark();
    const scenario = createAflTradeFuturePickScenario(scenarioContent(fit));
    const simulation = simulateAflTradeFuturePicks(scenario, fit, modelRunId, config(100));
    expect(
      aflTradeFuturePickSimulationContentSchema.safeParse({
        ...simulation.content,
        packageSummary: { ...simulation.content.packageSummary, expectedContribution: -999 },
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickSimulationContentSchema.safeParse({
        ...simulation.content,
        draws: simulation.content.draws.map((draw, index) =>
          index === 0
            ? {
                ...draw,
                assetOutcomes: draw.assetOutcomes.map((asset, assetIndex) =>
                  assetIndex === 0
                    ? { ...asset, timingAdjustedContribution: asset.timingAdjustedContribution + 1 }
                    : asset
                ),
              }
            : draw
        ),
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickSimulationSchema.safeParse({
        ...simulation,
        content: {
          ...simulation.content,
          ownerId: 'fantasy-user',
          fantasyLeagueId: 'fantasy-league',
        },
      }).success
    ).toBe(false);
  });
});
