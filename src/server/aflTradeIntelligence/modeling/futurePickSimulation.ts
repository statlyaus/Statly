import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  sampleAflTradeDeterministicWeightedIndex,
  type AflTradeDeterministicSampleCoordinate,
} from './deterministicUncertainty';
import {
  aflTradeFuturePickScenarioSchema,
  type AflTradeFuturePickScenario,
} from './futurePickContracts';
import {
  aflTradePickDistributionBenchmarkFitSchema,
  type AflTradePickDistributionBenchmarkFit,
} from './pickDistributionBenchmark';
import { AFL_TRADE_PICK_OUTCOME_CATEGORIES } from './pickOutcomeContracts';

const FLOAT_TOLERANCE = 1e-8;
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const finiteNumberSchema = z.number().finite();

export const aflTradeFuturePickSimulationConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-future-pick-simulation-config/v1'),
    executionPolicy: z.literal('exact_first_then_versioned_counter_sampling'),
    exactJointStateLimit: z.number().int().positive().max(100_000),
    fallbackSampleCount: z.number().int().min(100).max(100_000),
    seed: publicIdSchema,
    samplingAlgorithmVersion: z.literal('counter_sha256_rejection_v1'),
  })
  .strict();

const simulatedAssetOutcomeSchema = z
  .object({
    futurePickAssetId: publicIdSchema,
    nominalSelectionNumber: z.number().int().positive().max(500),
    actualSelectionNumber: z.number().int().positive().max(500),
    bidSelectionNumber: z.null(),
    distributionBlockIndex: z.number().int().nonnegative().max(499),
    outcomeObservationId: publicIdSchema,
    outcomeCategory: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    rawContribution: finiteNumberSchema,
    draftClassContributionMultiplier: finiteNumberSchema.positive(),
    classAdjustedContribution: finiteNumberSchema,
    productiveDelaySeasons: z.number().int().nonnegative().max(30),
    totalDelaySeasons: z.number().int().nonnegative().max(60),
    footballTimingWeight: finiteNumberSchema.min(0).max(1),
    timingAdjustedContribution: finiteNumberSchema,
  })
  .strict();

const simulationDrawSchema = z
  .object({
    drawIndex: z.number().int().nonnegative().max(99_999),
    probabilityWeight: finiteNumberSchema.positive().max(1),
    ladderStateId: publicIdSchema,
    ruleResolutionStateId: publicIdSchema,
    draftClassEffectStateId: publicIdSchema,
    assetOutcomes: z.array(simulatedAssetOutcomeSchema).min(1).max(100),
    packageContribution: finiteNumberSchema,
  })
  .strict();

const distributionSummarySchema = z
  .object({
    expectedContribution: finiteNumberSchema,
    p10Contribution: finiteNumberSchema,
    medianContribution: finiteNumberSchema,
    p90Contribution: finiteNumberSchema,
  })
  .strict();

const assetSummarySchema = distributionSummarySchema
  .extend({ futurePickAssetId: publicIdSchema })
  .strict();

export const aflTradeFuturePickSimulationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-future-pick-simulation/v1'),
    publicAssetBoundary: z.literal('afl_club_entitlements_no_user_or_fantasy_ownership'),
    futurePickScenarioId: aflTradeContentAddressedIdSchema('future-pick-scenario'),
    pickBenchmarkFitId: aflTradeContentAddressedIdSchema('pick-benchmark-fit'),
    modelRunId: aflTradeContentAddressedIdSchema('model-run'),
    futureScenarioDatasetId: aflTradeContentAddressedIdSchema('dataset'),
    pickOutcomeDatasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    valueUnitId: publicIdSchema,
    config: aflTradeFuturePickSimulationConfigSchema,
    executionMode: z.enum(['exact_finite_mixture', 'deterministic_counter_sample']),
    theoreticalJointStateCount: z.string().regex(/^[1-9][0-9]*$/),
    evaluatedStateCount: z.number().int().positive().max(100_000),
    draws: z.array(simulationDrawSchema).min(1).max(100_000),
    packageSummary: distributionSummarySchema,
    assetSummaries: z.array(assetSummarySchema).min(1).max(100),
    diagnostics: z
      .object({
        probabilityMass: finiteNumberSchema,
        monteCarloStandardError: finiteNumberSchema.nonnegative(),
        modelEstimationUncertainty: z.literal('not_included_requires_external_cluster_bootstrap'),
        outcomeDistributionUncertainty: z.literal('included'),
        draftClassSharedEffectUncertainty: z.literal('included_once_per_joint_state'),
        futureLadderLandingUncertainty: z.literal('included_as_joint_ladder_states'),
        productiveDelayUncertainty: z.literal('included_separately_from_market_impatience'),
        monteCarloError: z.enum(['zero_exact_enumeration', 'reported_standard_error']),
      })
      .strict(),
    simulationOrder: z.tuple([
      z.literal('joint_ladder_state'),
      z.literal('rule_vintage_selection_resolution'),
      z.literal('shared_draft_class_effect'),
      z.literal('player_outcome'),
      z.literal('productive_delay'),
    ]),
    limitation: z.literal(
      'Source-independent simulation harness only; not source approval, calibrated model evidence, or deployment approval.'
    ),
  })
  .strict()
  .superRefine((simulation, context) => {
    const probabilityMass = simulation.draws.reduce((sum, draw) => sum + draw.probabilityWeight, 0);
    const expectedDrawCount =
      simulation.executionMode === 'exact_finite_mixture'
        ? Number(simulation.theoreticalJointStateCount)
        : simulation.config.fallbackSampleCount;
    if (
      simulation.draws.length !== simulation.evaluatedStateCount ||
      simulation.evaluatedStateCount !== expectedDrawCount ||
      simulation.draws.some((draw, index) => draw.drawIndex !== index) ||
      Math.abs(probabilityMass - 1) > FLOAT_TOLERANCE ||
      Math.abs(simulation.diagnostics.probabilityMass - probabilityMass) > FLOAT_TOLERANCE ||
      (simulation.executionMode === 'exact_finite_mixture' &&
        (simulation.diagnostics.monteCarloStandardError !== 0 ||
          simulation.diagnostics.monteCarloError !== 'zero_exact_enumeration')) ||
      (simulation.executionMode === 'deterministic_counter_sample' &&
        simulation.diagnostics.monteCarloError !== 'reported_standard_error')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['draws'],
        message:
          'Simulation draws, probability mass, execution mode, and diagnostics must reconcile.',
      });
    }

    const assetIds = simulation.assetSummaries.map(({ futurePickAssetId }) => futurePickAssetId);
    if (
      new Set(assetIds).size !== assetIds.length ||
      assetIds.some((assetId, index) => assetId !== [...assetIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assetSummaries'],
        message: 'Asset summaries must have unique canonical identities.',
      });
    }
    for (const [drawIndex, draw] of simulation.draws.entries()) {
      const drawAssetIds = draw.assetOutcomes.map(({ futurePickAssetId }) => futurePickAssetId);
      const recomputedPackage = draw.assetOutcomes.reduce(
        (sum, asset) => sum + asset.timingAdjustedContribution,
        0
      );
      if (
        drawAssetIds.some((assetId, index) => assetId !== assetIds[index]) ||
        Math.abs(recomputedPackage - draw.packageContribution) > FLOAT_TOLERANCE ||
        draw.assetOutcomes.some(
          (asset) =>
            asset.bidSelectionNumber !== null ||
            asset.totalDelaySeasons < asset.productiveDelaySeasons ||
            Math.abs(
              asset.rawContribution * asset.draftClassContributionMultiplier -
                asset.classAdjustedContribution
            ) > FLOAT_TOLERANCE ||
            Math.abs(
              asset.classAdjustedContribution * asset.footballTimingWeight -
                asset.timingAdjustedContribution
            ) > FLOAT_TOLERANCE
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['draws', drawIndex],
          message:
            'Draw asset order, contribution transformations, and package totals must reconcile.',
        });
      }
    }

    const packageSummary = summarizeWeightedValues(
      simulation.draws.map((draw) => ({
        value: draw.packageContribution,
        weight: draw.probabilityWeight,
      }))
    );
    if (!summariesMatch(simulation.packageSummary, packageSummary)) {
      context.addIssue({
        code: 'custom',
        path: ['packageSummary'],
        message: 'Package summary must be derived from the weighted joint draws.',
      });
    }
    for (const [assetIndex, assetSummary] of simulation.assetSummaries.entries()) {
      const recomputed = summarizeWeightedValues(
        simulation.draws.map((draw) => ({
          value: draw.assetOutcomes[assetIndex].timingAdjustedContribution,
          weight: draw.probabilityWeight,
        }))
      );
      if (!summariesMatch(assetSummary, recomputed)) {
        context.addIssue({
          code: 'custom',
          path: ['assetSummaries', assetIndex],
          message: 'Asset summaries must be derived from the weighted joint draws.',
        });
      }
    }
  });

export const aflTradeFuturePickSimulationSchema = z
  .object({
    futurePickSimulationId: aflTradeContentAddressedIdSchema('future-pick-simulation'),
    content: aflTradeFuturePickSimulationContentSchema,
  })
  .strict()
  .superRefine((simulation, context) => {
    addAflTradeContentAddressIssue(
      'future-pick-simulation',
      simulation.futurePickSimulationId,
      simulation.content,
      context,
      ['futurePickSimulationId']
    );
  });

export type AflTradeFuturePickSimulationConfig = z.infer<
  typeof aflTradeFuturePickSimulationConfigSchema
>;
export type AflTradeFuturePickSimulation = z.infer<typeof aflTradeFuturePickSimulationSchema>;

export const DEFAULT_AFL_TRADE_FUTURE_PICK_SIMULATION_CONFIG = {
  schemaVersion: 'afl-trade-future-pick-simulation-config/v1',
  executionPolicy: 'exact_first_then_versioned_counter_sampling',
  exactJointStateLimit: 50_000,
  fallbackSampleCount: 20_000,
  seed: 'afl-trade-future-pick-default-seed-v1',
  samplingAlgorithmVersion: 'counter_sha256_rejection_v1',
} as const satisfies AflTradeFuturePickSimulationConfig;

interface WeightedValue {
  value: number;
  weight: number;
}

interface ResolvedAsset {
  entitlement: AflTradeFuturePickScenario['content']['futurePickEntitlements'][number];
  nominalSelectionNumber: number;
  actualSelectionNumber: number;
  distributionBlock: AflTradePickDistributionBenchmarkFit['content']['distributionBlocks'][number];
}

type SimulationDraw = z.infer<typeof simulationDrawSchema>;
type SimulatedAssetOutcome = z.infer<typeof simulatedAssetOutcomeSchema>;

function summarizeWeightedValues(values: readonly WeightedValue[]) {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const quantile = (target: number) => {
    let cumulative = 0;
    for (const item of sorted) {
      cumulative += item.weight / totalWeight;
      if (cumulative + FLOAT_TOLERANCE >= target) return item.value;
    }
    return sorted.at(-1)!.value;
  };
  return {
    expectedContribution:
      values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight,
    p10Contribution: quantile(0.1),
    medianContribution: quantile(0.5),
    p90Contribution: quantile(0.9),
  };
}

function summariesMatch(
  left: {
    expectedContribution: number;
    p10Contribution: number;
    medianContribution: number;
    p90Contribution: number;
  },
  right: {
    expectedContribution: number;
    p10Contribution: number;
    medianContribution: number;
    p90Contribution: number;
  }
): boolean {
  return (
    Math.abs(left.expectedContribution - right.expectedContribution) <= FLOAT_TOLERANCE &&
    Math.abs(left.p10Contribution - right.p10Contribution) <= FLOAT_TOLERANCE &&
    Math.abs(left.medianContribution - right.medianContribution) <= FLOAT_TOLERANCE &&
    Math.abs(left.p90Contribution - right.p90Contribution) <= FLOAT_TOLERANCE
  );
}

function resolveAssets(
  scenario: AflTradeFuturePickScenario,
  benchmark: AflTradePickDistributionBenchmarkFit,
  ladderState: AflTradeFuturePickScenario['content']['ladderStates'][number],
  ruleState: AflTradeFuturePickScenario['content']['ruleVintage']['resolutionStates'][number]
): ResolvedAsset[] {
  const actualSelectionByNominal = new Map(
    ruleState.nominalToActualSelections.map((mapping) => [
      mapping.nominalSelectionNumber,
      mapping.actualSelectionNumber,
    ])
  );
  const blocks = new Map(
    benchmark.content.distributionBlocks.map((block) => [block.blockIndex, block])
  );
  return scenario.content.futurePickEntitlements.map((entitlement) => {
    const finishingPosition = ladderState.clubPositions.find(
      ({ aflClubId }) => aflClubId === entitlement.ladderLinkedAflClubId
    )!.finishingPosition;
    const nominalSelectionNumber =
      (entitlement.round - 1) * scenario.content.ruleVintage.aflClubCount +
      (scenario.content.ruleVintage.aflClubCount - finishingPosition + 1);
    const actualSelectionNumber = actualSelectionByNominal.get(nominalSelectionNumber)!;
    const curvePoint = benchmark.content.selectionCurve.find(
      ({ selectionNumber }) => selectionNumber === actualSelectionNumber
    )!;
    return {
      entitlement,
      nominalSelectionNumber,
      actualSelectionNumber,
      distributionBlock: blocks.get(curvePoint.distributionBlockIndex)!,
    };
  });
}

function assetOutcome(
  scenario: AflTradeFuturePickScenario,
  resolvedAsset: ResolvedAsset,
  draftClassMultiplier: number,
  support: ResolvedAsset['distributionBlock']['empiricalSupport'][number],
  delayState: AflTradeFuturePickScenario['content']['productiveDelayPolicy']['categoryDelayDistributions'][number]['delayStates'][number]
): SimulatedAssetOutcome {
  const totalDelaySeasons =
    scenario.content.productiveDelayPolicy.seasonsUntilDraft + delayState.productiveDelaySeasons;
  const footballTimingWeight = scenario.content.productiveDelayPolicy.footballTimingWeights.find(
    (weight) => weight.totalDelaySeasons === totalDelaySeasons
  )!.footballTimingWeight;
  const classAdjustedContribution = support.contribution * draftClassMultiplier;
  return {
    futurePickAssetId: resolvedAsset.entitlement.futurePickAssetId,
    nominalSelectionNumber: resolvedAsset.nominalSelectionNumber,
    actualSelectionNumber: resolvedAsset.actualSelectionNumber,
    bidSelectionNumber: null,
    distributionBlockIndex: resolvedAsset.distributionBlock.blockIndex,
    outcomeObservationId: support.observationId,
    outcomeCategory: support.category,
    rawContribution: support.contribution,
    draftClassContributionMultiplier: draftClassMultiplier,
    classAdjustedContribution,
    productiveDelaySeasons: delayState.productiveDelaySeasons,
    totalDelaySeasons,
    footballTimingWeight,
    timingAdjustedContribution: classAdjustedContribution * footballTimingWeight,
  };
}

function delayDistributionForCategory(
  scenario: AflTradeFuturePickScenario,
  category: (typeof AFL_TRADE_PICK_OUTCOME_CATEGORIES)[number]
) {
  return scenario.content.productiveDelayPolicy.categoryDelayDistributions.find(
    (distribution) => distribution.category === category
  )!;
}

function theoreticalJointStateCount(
  scenario: AflTradeFuturePickScenario,
  benchmark: AflTradePickDistributionBenchmarkFit
): bigint {
  let stateCount = 0n;
  for (const ladderState of scenario.content.ladderStates) {
    for (const ruleState of scenario.content.ruleVintage.resolutionStates) {
      const resolvedAssets = resolveAssets(scenario, benchmark, ladderState, ruleState);
      let assetCombinationCount = 1n;
      for (const resolvedAsset of resolvedAssets) {
        const outcomeDelayCount = resolvedAsset.distributionBlock.empiricalSupport.reduce(
          (sum, support) =>
            sum +
            BigInt(delayDistributionForCategory(scenario, support.category).delayStates.length),
          0n
        );
        assetCombinationCount *= outcomeDelayCount;
      }
      stateCount += assetCombinationCount * BigInt(scenario.content.draftClassEffectStates.length);
    }
  }
  return stateCount;
}

function enumerateExactDraws(
  scenario: AflTradeFuturePickScenario,
  benchmark: AflTradePickDistributionBenchmarkFit
): SimulationDraw[] {
  const draws: SimulationDraw[] = [];
  for (const ladderState of scenario.content.ladderStates) {
    for (const ruleState of scenario.content.ruleVintage.resolutionStates) {
      const resolvedAssets = resolveAssets(scenario, benchmark, ladderState, ruleState);
      for (const classEffect of scenario.content.draftClassEffectStates) {
        const outerProbability =
          ladderState.probability * ruleState.probability * classEffect.probability;
        const appendDelays = (
          delayAssetIndex: number,
          probability: number,
          selectedSupports: Array<ResolvedAsset['distributionBlock']['empiricalSupport'][number]>,
          outcomes: SimulatedAssetOutcome[]
        ) => {
          if (delayAssetIndex === resolvedAssets.length) {
            draws.push({
              drawIndex: draws.length,
              probabilityWeight: probability,
              ladderStateId: ladderState.ladderStateId,
              ruleResolutionStateId: ruleState.ruleResolutionStateId,
              draftClassEffectStateId: classEffect.draftClassEffectStateId,
              assetOutcomes: outcomes,
              packageContribution: outcomes.reduce(
                (sum, outcome) => sum + outcome.timingAdjustedContribution,
                0
              ),
            });
            return;
          }
          const resolvedAsset = resolvedAssets[delayAssetIndex];
          const support = selectedSupports[delayAssetIndex];
          const delayDistribution = delayDistributionForCategory(scenario, support.category);
          for (const delayState of delayDistribution.delayStates) {
            appendDelays(
              delayAssetIndex + 1,
              probability * delayState.probability,
              selectedSupports,
              [
                ...outcomes,
                assetOutcome(
                  scenario,
                  resolvedAsset,
                  classEffect.contributionMultiplier,
                  support,
                  delayState
                ),
              ]
            );
          }
        };
        const appendPlayerOutcomes = (
          outcomeAssetIndex: number,
          probability: number,
          selectedSupports: Array<ResolvedAsset['distributionBlock']['empiricalSupport'][number]>
        ) => {
          if (outcomeAssetIndex === resolvedAssets.length) {
            appendDelays(0, probability, selectedSupports, []);
            return;
          }
          const resolvedAsset = resolvedAssets[outcomeAssetIndex];
          for (const support of resolvedAsset.distributionBlock.empiricalSupport) {
            appendPlayerOutcomes(outcomeAssetIndex + 1, probability * support.probability, [
              ...selectedSupports,
              support,
            ]);
          }
        };
        appendPlayerOutcomes(0, outerProbability, []);
      }
    }
  }
  return draws;
}

function sampleCoordinate(
  config: AflTradeFuturePickSimulationConfig,
  scenarioId: string,
  stream: AflTradeDeterministicSampleCoordinate['stream'],
  counters: number[]
): AflTradeDeterministicSampleCoordinate {
  return {
    algorithmVersion: config.samplingAlgorithmVersion,
    seed: config.seed,
    stream,
    streamKey: scenarioId,
    counters,
  };
}

function sampleWeighted<T>(
  values: readonly T[],
  weights: readonly number[],
  coordinate: AflTradeDeterministicSampleCoordinate
): T {
  return values[sampleAflTradeDeterministicWeightedIndex(coordinate, weights)];
}

function sampleDraws(
  scenario: AflTradeFuturePickScenario,
  benchmark: AflTradePickDistributionBenchmarkFit,
  config: AflTradeFuturePickSimulationConfig
): SimulationDraw[] {
  return Array.from({ length: config.fallbackSampleCount }, (_, drawIndex) => {
    const ladderState = sampleWeighted(
      scenario.content.ladderStates,
      scenario.content.ladderStates.map(({ probability }) => probability),
      sampleCoordinate(config, scenario.futurePickScenarioId, 'future_ladder_landing', [
        drawIndex,
        0,
      ])
    );
    const ruleState = sampleWeighted(
      scenario.content.ruleVintage.resolutionStates,
      scenario.content.ruleVintage.resolutionStates.map(({ probability }) => probability),
      sampleCoordinate(config, scenario.futurePickScenarioId, 'future_ladder_landing', [
        drawIndex,
        1,
      ])
    );
    const classEffect = sampleWeighted(
      scenario.content.draftClassEffectStates,
      scenario.content.draftClassEffectStates.map(({ probability }) => probability),
      sampleCoordinate(config, scenario.futurePickScenarioId, 'draft_class_shared_effect', [
        drawIndex,
      ])
    );
    const resolvedAssets = resolveAssets(scenario, benchmark, ladderState, ruleState);
    const selectedSupports = resolvedAssets.map((resolvedAsset, assetIndex) =>
      sampleWeighted(
        resolvedAsset.distributionBlock.empiricalSupport,
        resolvedAsset.distributionBlock.empiricalSupport.map(({ probability }) => probability),
        sampleCoordinate(config, scenario.futurePickScenarioId, 'outcome_distribution', [
          drawIndex,
          assetIndex,
        ])
      )
    );
    const assetOutcomes = resolvedAssets.map((resolvedAsset, assetIndex) => {
      const support = selectedSupports[assetIndex];
      const delayDistribution = delayDistributionForCategory(scenario, support.category);
      const delayState = sampleWeighted(
        delayDistribution.delayStates,
        delayDistribution.delayStates.map(({ probability }) => probability),
        sampleCoordinate(config, scenario.futurePickScenarioId, 'productive_delay', [
          drawIndex,
          assetIndex,
        ])
      );
      return assetOutcome(
        scenario,
        resolvedAsset,
        classEffect.contributionMultiplier,
        support,
        delayState
      );
    });
    return {
      drawIndex,
      probabilityWeight: 1 / config.fallbackSampleCount,
      ladderStateId: ladderState.ladderStateId,
      ruleResolutionStateId: ruleState.ruleResolutionStateId,
      draftClassEffectStateId: classEffect.draftClassEffectStateId,
      assetOutcomes,
      packageContribution: assetOutcomes.reduce(
        (sum, outcome) => sum + outcome.timingAdjustedContribution,
        0
      ),
    };
  });
}

function monteCarloStandardError(draws: readonly SimulationDraw[]): number {
  if (draws.length <= 1) return 0;
  const mean = draws.reduce((sum, draw) => sum + draw.packageContribution, 0) / draws.length;
  const sampleVariance =
    draws.reduce((sum, draw) => sum + (draw.packageContribution - mean) ** 2, 0) /
    (draws.length - 1);
  return Math.sqrt(sampleVariance / draws.length);
}

export function simulateAflTradeFuturePicks(
  unparsedScenario: AflTradeFuturePickScenario,
  unparsedBenchmark: AflTradePickDistributionBenchmarkFit,
  modelRunId: string,
  unparsedConfig: AflTradeFuturePickSimulationConfig = DEFAULT_AFL_TRADE_FUTURE_PICK_SIMULATION_CONFIG
): AflTradeFuturePickSimulation {
  const scenario = aflTradeFuturePickScenarioSchema.parse(unparsedScenario);
  const benchmark = aflTradePickDistributionBenchmarkFitSchema.parse(unparsedBenchmark);
  const parsedModelRunId = aflTradeContentAddressedIdSchema('model-run').parse(modelRunId);
  const config = aflTradeFuturePickSimulationConfigSchema.parse(unparsedConfig);
  if (
    scenario.content.pickBenchmarkFitId !== benchmark.benchmarkFitId ||
    scenario.content.modelProtocolId !== benchmark.content.modelProtocolId ||
    scenario.content.valueUnitId !== benchmark.content.valueUnitId ||
    scenario.content.pickCurveMinimumSelection !==
      benchmark.content.diagnostics.minimumTrainingSelection ||
    scenario.content.pickCurveMaximumSelection !==
      benchmark.content.diagnostics.maximumTrainingSelection
  ) {
    throw new TypeError(
      'Future-pick scenario and pick benchmark provenance, value unit, and curve domain must match.'
    );
  }
  const jointStateCount = theoreticalJointStateCount(scenario, benchmark);
  const exact = jointStateCount <= BigInt(config.exactJointStateLimit);
  const draws = exact
    ? enumerateExactDraws(scenario, benchmark)
    : sampleDraws(scenario, benchmark, config);
  const packageSummary = summarizeWeightedValues(
    draws.map((draw) => ({ value: draw.packageContribution, weight: draw.probabilityWeight }))
  );
  const assetIds = scenario.content.futurePickEntitlements.map(
    ({ futurePickAssetId }) => futurePickAssetId
  );
  const assetSummaries = assetIds.map((futurePickAssetId, assetIndex) => ({
    futurePickAssetId,
    ...summarizeWeightedValues(
      draws.map((draw) => ({
        value: draw.assetOutcomes[assetIndex].timingAdjustedContribution,
        weight: draw.probabilityWeight,
      }))
    ),
  }));
  const probabilityMass = draws.reduce((sum, draw) => sum + draw.probabilityWeight, 0);
  const content = aflTradeFuturePickSimulationContentSchema.parse({
    schemaVersion: 'afl-trade-future-pick-simulation/v1',
    publicAssetBoundary: scenario.content.publicAssetBoundary,
    futurePickScenarioId: scenario.futurePickScenarioId,
    pickBenchmarkFitId: benchmark.benchmarkFitId,
    modelRunId: parsedModelRunId,
    futureScenarioDatasetId: scenario.content.datasetId,
    pickOutcomeDatasetId: benchmark.content.datasetId,
    modelProtocolId: benchmark.content.modelProtocolId,
    valueUnitId: benchmark.content.valueUnitId,
    config,
    executionMode: exact ? 'exact_finite_mixture' : 'deterministic_counter_sample',
    theoreticalJointStateCount: jointStateCount.toString(),
    evaluatedStateCount: draws.length,
    draws,
    packageSummary,
    assetSummaries,
    diagnostics: {
      probabilityMass,
      monteCarloStandardError: exact ? 0 : monteCarloStandardError(draws),
      modelEstimationUncertainty: 'not_included_requires_external_cluster_bootstrap',
      outcomeDistributionUncertainty: 'included',
      draftClassSharedEffectUncertainty: 'included_once_per_joint_state',
      futureLadderLandingUncertainty: 'included_as_joint_ladder_states',
      productiveDelayUncertainty: 'included_separately_from_market_impatience',
      monteCarloError: exact ? 'zero_exact_enumeration' : 'reported_standard_error',
    },
    simulationOrder: scenario.content.simulationOrder,
    limitation:
      'Source-independent simulation harness only; not source approval, calibrated model evidence, or deployment approval.',
  });
  return aflTradeFuturePickSimulationSchema.parse({
    futurePickSimulationId: createAflTradeContentAddress('future-pick-simulation', content),
    content,
  });
}
