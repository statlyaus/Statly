import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  aflTradePickOutcomeObservationSetSchema,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSet,
} from './pickOutcomeContracts';
import { fitAflTradeWeightedNonIncreasingIsotonic } from './weightedIsotonic';

const finiteNumberSchema = z.number().finite();
const probabilitySchema = finiteNumberSchema.min(0).max(1);
const publicIdSchema = z.string().trim().min(1).max(200);
const FLOAT_TOLERANCE = 1e-10;

export const AFL_TRADE_PICK_BENCHMARK_EXCLUSION_REASONS = [
  'held_out_partition',
  'right_censored',
  'outcome_unavailable',
  'non_national_pathway',
  'restricted_access',
  'actual_selection_unavailable',
] as const;

export const aflTradePickDistributionBenchmarkConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-distribution-benchmark-config/v1'),
    minimumBlockObservations: z.number().int().positive().max(100_000),
    eligibility: z.literal('mature_open_access_national_draft_training_observations'),
    informationWeight: z.literal('eligible_player_count'),
    sparseBlockMergePolicy: z.literal('nearest_adjacent_fitted_mean_left_tie_break'),
    interpolation: z.literal('left_block_carry_forward_within_training_domain'),
    extrapolation: z.literal('prohibited'),
    estimatorStatus: z.literal('benchmark_only_not_censor_aware_candidate'),
  })
  .strict();

const outcomeProbabilitySchema = z
  .object({
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    probability: probabilitySchema,
  })
  .strict();

const empiricalSupportSchema = z
  .object({
    observationId: publicIdSchema,
    contribution: finiteNumberSchema,
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    probability: probabilitySchema,
  })
  .strict();

const distributionBlockSchema = z
  .object({
    blockIndex: z.number().int().nonnegative(),
    minimumSelectionNumber: z.number().int().positive().max(500),
    maximumSelectionNumber: z.number().int().positive().max(500),
    sourceSelectionNumbers: z.array(z.number().int().positive().max(500)).min(1),
    fittedExpectedContribution: finiteNumberSchema,
    observationCount: z.number().int().positive(),
    empiricalSupport: z.array(empiricalSupportSchema).min(1),
    outcomeProbabilities: z
      .array(outcomeProbabilitySchema)
      .length(AFL_TRADE_PICK_OUTCOME_CATEGORIES.length),
    p10Contribution: finiteNumberSchema,
    p50Contribution: finiteNumberSchema,
    p90Contribution: finiteNumberSchema,
  })
  .strict();

const curvePointSchema = z
  .object({
    selectionNumber: z.number().int().positive().max(500),
    distributionBlockIndex: z.number().int().nonnegative(),
    expectedContribution: finiteNumberSchema,
    p10Contribution: finiteNumberSchema,
    p50Contribution: finiteNumberSchema,
    p90Contribution: finiteNumberSchema,
  })
  .strict();

const excludedObservationSchema = z
  .object({
    observationId: publicIdSchema,
    reason: z.enum(AFL_TRADE_PICK_BENCHMARK_EXCLUSION_REASONS),
  })
  .strict();

export const aflTradePickDistributionBenchmarkFitContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-distribution-benchmark-fit/v1'),
    observationSetId: aflTradeContentAddressedIdSchema('pick-observation-set'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    valueUnitId: publicIdSchema,
    fixedHorizonSeasons: z.number().int().positive().max(30),
    fixedHorizonDefinitionArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    outcomeDefinitionArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    publicAssetBoundary: z.literal('source_native_afl_draft_selection_no_fantasy_ownership'),
    config: aflTradePickDistributionBenchmarkConfigSchema,
    trainingObservationIds: z.array(publicIdSchema).min(1).max(100_000),
    excludedObservations: z.array(excludedObservationSchema).max(100_000),
    distributionBlocks: z.array(distributionBlockSchema).min(1).max(500),
    selectionCurve: z.array(curvePointSchema).min(1).max(500),
    diagnostics: z
      .object({
        inputObservationCount: z.number().int().positive(),
        eligibleTrainingObservationCount: z.number().int().positive(),
        excludedObservationCount: z.number().int().nonnegative(),
        sourceSelectionCount: z.number().int().positive().max(500),
        fittedBlockCount: z.number().int().positive().max(500),
        minimumTrainingSelection: z.number().int().positive().max(500),
        maximumTrainingSelection: z.number().int().positive().max(500),
      })
      .strict(),
    limitation: z.literal(
      'Deterministic mature-cohort benchmark only; not source approval, a censor-aware candidate, or deployment evidence.'
    ),
  })
  .strict()
  .superRefine((fit, context) => {
    const trainingIds = fit.trainingObservationIds;
    const excludedIds = fit.excludedObservations.map(({ observationId }) => observationId);
    const allIds = [...trainingIds, ...excludedIds];
    if (
      new Set(trainingIds).size !== trainingIds.length ||
      new Set(excludedIds).size !== excludedIds.length ||
      new Set(allIds).size !== allIds.length ||
      allIds.length !== fit.diagnostics.inputObservationCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['trainingObservationIds'],
        message:
          'Training and excluded observation identities must form a disjoint input partition.',
      });
    }
    if (
      fit.diagnostics.eligibleTrainingObservationCount !== trainingIds.length ||
      fit.diagnostics.excludedObservationCount !== excludedIds.length ||
      fit.diagnostics.fittedBlockCount !== fit.distributionBlocks.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: 'Benchmark diagnostics must reconcile with the fitted observations and blocks.',
      });
    }

    const supportIds: string[] = [];
    const sourceSelections: number[] = [];
    let previousMaximum = 0;
    let previousFittedValue = Number.POSITIVE_INFINITY;
    for (const [blockIndex, block] of fit.distributionBlocks.entries()) {
      const sortedSelections = [...block.sourceSelectionNumbers].sort(
        (left, right) => left - right
      );
      const expectedMinimum = sortedSelections[0];
      const expectedMaximum = sortedSelections.at(-1)!;
      const probabilities = block.outcomeProbabilities;
      const supportProbability = block.empiricalSupport.reduce(
        (sum, support) => sum + support.probability,
        0
      );
      const supportMean = block.empiricalSupport.reduce(
        (sum, support) => sum + support.contribution * support.probability,
        0
      );
      const categoryOrder = probabilities.map(({ category }) => category);
      const expectedCategoryProbabilities = AFL_TRADE_PICK_OUTCOME_CATEGORIES.map((category) =>
        block.empiricalSupport
          .filter((support) => support.category === category)
          .reduce((sum, support) => sum + support.probability, 0)
      );
      const empiricalQuantiles = [0.1, 0.5, 0.9].map((quantile) =>
        empiricalQuantile(
          block.empiricalSupport.map(({ contribution }) => contribution),
          quantile
        )
      );
      if (
        block.blockIndex !== blockIndex ||
        new Set(sortedSelections).size !== sortedSelections.length ||
        sortedSelections.some(
          (selection, index) => selection !== block.sourceSelectionNumbers[index]
        ) ||
        block.minimumSelectionNumber !== expectedMinimum ||
        block.maximumSelectionNumber !== expectedMaximum ||
        block.minimumSelectionNumber <= previousMaximum ||
        block.fittedExpectedContribution > previousFittedValue + FLOAT_TOLERANCE ||
        block.observationCount !== block.empiricalSupport.length ||
        (fit.distributionBlocks.length > 1 &&
          block.observationCount < fit.config.minimumBlockObservations) ||
        Math.abs(supportProbability - 1) > FLOAT_TOLERANCE ||
        Math.abs(supportMean - block.fittedExpectedContribution) > FLOAT_TOLERANCE ||
        block.empiricalSupport.some(
          ({ probability }) => Math.abs(probability - 1 / block.observationCount) > FLOAT_TOLERANCE
        ) ||
        categoryOrder.some(
          (category, index) => category !== AFL_TRADE_PICK_OUTCOME_CATEGORIES[index]
        ) ||
        probabilities.some(
          ({ probability }, index) =>
            Math.abs(probability - expectedCategoryProbabilities[index]) > FLOAT_TOLERANCE
        ) ||
        Math.abs(block.p10Contribution - empiricalQuantiles[0]) > FLOAT_TOLERANCE ||
        Math.abs(block.p50Contribution - empiricalQuantiles[1]) > FLOAT_TOLERANCE ||
        Math.abs(block.p90Contribution - empiricalQuantiles[2]) > FLOAT_TOLERANCE
      ) {
        context.addIssue({
          code: 'custom',
          path: ['distributionBlocks', blockIndex],
          message:
            'Distribution blocks must be ordered, monotone, sufficiently supported empirical fits.',
        });
      }
      supportIds.push(...block.empiricalSupport.map(({ observationId }) => observationId));
      sourceSelections.push(...sortedSelections);
      previousMaximum = block.maximumSelectionNumber;
      previousFittedValue = block.fittedExpectedContribution;
    }
    if (
      new Set(supportIds).size !== supportIds.length ||
      [...supportIds].sort().some((id, index) => id !== [...trainingIds].sort()[index]) ||
      new Set(sourceSelections).size !== sourceSelections.length ||
      sourceSelections.length !== fit.diagnostics.sourceSelectionCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionBlocks'],
        message: 'Block support and source selections must reconcile exactly with training inputs.',
      });
    }

    const minimum = fit.diagnostics.minimumTrainingSelection;
    const maximum = fit.diagnostics.maximumTrainingSelection;
    if (
      fit.selectionCurve.length !== maximum - minimum + 1 ||
      fit.selectionCurve.some((point, index) => point.selectionNumber !== minimum + index) ||
      minimum !== Math.min(...sourceSelections) ||
      maximum !== Math.max(...sourceSelections)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectionCurve'],
        message:
          'The benchmark curve must cover every in-domain selection and prohibit extrapolation.',
      });
    }
    for (const [curveIndex, point] of fit.selectionCurve.entries()) {
      const expectedBlock = [...fit.distributionBlocks]
        .reverse()
        .find((block) => block.minimumSelectionNumber <= point.selectionNumber);
      if (
        !expectedBlock ||
        point.distributionBlockIndex !== expectedBlock.blockIndex ||
        Math.abs(point.expectedContribution - expectedBlock.fittedExpectedContribution) >
          FLOAT_TOLERANCE ||
        point.p10Contribution !== expectedBlock.p10Contribution ||
        point.p50Contribution !== expectedBlock.p50Contribution ||
        point.p90Contribution !== expectedBlock.p90Contribution
      ) {
        context.addIssue({
          code: 'custom',
          path: ['selectionCurve', curveIndex],
          message:
            'Curve points must carry the preceding fitted distribution within the training domain.',
        });
      }
    }
  });

export const aflTradePickDistributionBenchmarkFitSchema = z
  .object({
    benchmarkFitId: aflTradeContentAddressedIdSchema('pick-benchmark-fit'),
    content: aflTradePickDistributionBenchmarkFitContentSchema,
  })
  .strict()
  .superRefine((fit, context) => {
    addAflTradeContentAddressIssue('pick-benchmark-fit', fit.benchmarkFitId, fit.content, context, [
      'benchmarkFitId',
    ]);
  });

export type AflTradePickDistributionBenchmarkConfig = z.infer<
  typeof aflTradePickDistributionBenchmarkConfigSchema
>;
export type AflTradePickDistributionBenchmarkFit = z.infer<
  typeof aflTradePickDistributionBenchmarkFitSchema
>;

export const DEFAULT_AFL_TRADE_PICK_DISTRIBUTION_BENCHMARK_CONFIG = {
  schemaVersion: 'afl-trade-pick-distribution-benchmark-config/v1',
  minimumBlockObservations: 20,
  eligibility: 'mature_open_access_national_draft_training_observations',
  informationWeight: 'eligible_player_count',
  sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
  interpolation: 'left_block_carry_forward_within_training_domain',
  extrapolation: 'prohibited',
  estimatorStatus: 'benchmark_only_not_censor_aware_candidate',
} as const satisfies AflTradePickDistributionBenchmarkConfig;

interface WorkingBlock {
  selectionNumbers: number[];
  fittedValue: number;
  observations: AflTradePickOutcomeObservation[];
}

function empiricalQuantile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function exclusionReason(
  observation: AflTradePickOutcomeObservation
): (typeof AFL_TRADE_PICK_BENCHMARK_EXCLUSION_REASONS)[number] | null {
  if (observation.partition !== 'train') return 'held_out_partition';
  if (observation.outcome.state === 'right_censored') return 'right_censored';
  if (observation.outcome.state === 'unavailable') return 'outcome_unavailable';
  if (observation.selection.pathway !== 'national') return 'non_national_pathway';
  if (observation.selection.access !== 'open') return 'restricted_access';
  if (observation.selection.actualSelectionNumber === null) return 'actual_selection_unavailable';
  return null;
}

function mergeWorkingBlocks(left: WorkingBlock, right: WorkingBlock): WorkingBlock {
  const observations = [...left.observations, ...right.observations];
  return {
    selectionNumbers: [...left.selectionNumbers, ...right.selectionNumbers].sort(
      (first, second) => first - second
    ),
    fittedValue:
      observations.reduce((sum, observation) => {
        if (observation.outcome.state !== 'mature_observed') return sum;
        return sum + observation.outcome.contribution;
      }, 0) / observations.length,
    observations,
  };
}

function enforceMinimumBlockSupport(
  initialBlocks: WorkingBlock[],
  minimumBlockObservations: number
): WorkingBlock[] {
  const blocks = initialBlocks.map((block) => ({
    ...block,
    selectionNumbers: [...block.selectionNumbers],
    observations: [...block.observations],
  }));
  while (blocks.length > 1) {
    const sparseIndex = blocks.findIndex(
      ({ observations }) => observations.length < minimumBlockObservations
    );
    if (sparseIndex === -1) break;
    let leftIndex: number;
    if (sparseIndex === 0) {
      leftIndex = 0;
    } else if (sparseIndex === blocks.length - 1) {
      leftIndex = sparseIndex - 1;
    } else {
      const leftDistance = Math.abs(
        blocks[sparseIndex - 1].fittedValue - blocks[sparseIndex].fittedValue
      );
      const rightDistance = Math.abs(
        blocks[sparseIndex].fittedValue - blocks[sparseIndex + 1].fittedValue
      );
      leftIndex = leftDistance <= rightDistance ? sparseIndex - 1 : sparseIndex;
    }
    blocks.splice(leftIndex, 2, mergeWorkingBlocks(blocks[leftIndex], blocks[leftIndex + 1]));
  }
  return blocks;
}

export function fitAflTradePickDistributionBenchmark(
  unparsedObservationSet: AflTradePickOutcomeObservationSet,
  unparsedConfig: AflTradePickDistributionBenchmarkConfig = DEFAULT_AFL_TRADE_PICK_DISTRIBUTION_BENCHMARK_CONFIG
): AflTradePickDistributionBenchmarkFit {
  const observationSet = aflTradePickOutcomeObservationSetSchema.parse(unparsedObservationSet);
  const config = aflTradePickDistributionBenchmarkConfigSchema.parse(unparsedConfig);
  const eligible: AflTradePickOutcomeObservation[] = [];
  const excludedObservations: Array<{
    observationId: string;
    reason: (typeof AFL_TRADE_PICK_BENCHMARK_EXCLUSION_REASONS)[number];
  }> = [];
  for (const observation of observationSet.content.observations) {
    const reason = exclusionReason(observation);
    if (reason === null) eligible.push(observation);
    else excludedObservations.push({ observationId: observation.observationId, reason });
  }
  if (eligible.length === 0) {
    throw new RangeError(
      'The pick-distribution benchmark requires eligible training observations.'
    );
  }

  const observationsBySelection = new Map<number, AflTradePickOutcomeObservation[]>();
  for (const observation of eligible) {
    const selectionNumber = observation.selection.actualSelectionNumber!;
    const observations = observationsBySelection.get(selectionNumber) ?? [];
    observations.push(observation);
    observationsBySelection.set(selectionNumber, observations);
  }
  const isotonicFit = fitAflTradeWeightedNonIncreasingIsotonic(
    [...observationsBySelection.entries()].map(([selectionNumber, observations]) => ({
      pointId: `selection:${selectionNumber}`,
      x: selectionNumber,
      value:
        observations.reduce((sum, observation) => {
          if (observation.outcome.state !== 'mature_observed') return sum;
          return sum + observation.outcome.contribution;
        }, 0) / observations.length,
      weight: observations.length,
    }))
  );
  const workingBlocks = enforceMinimumBlockSupport(
    isotonicFit.blocks.map((block) => {
      const selectionNumbers = block.pointIds.map((pointId) => Number(pointId.split(':')[1]));
      return {
        selectionNumbers,
        fittedValue: block.fittedValue,
        observations: selectionNumbers
          .flatMap((selectionNumber) => observationsBySelection.get(selectionNumber) ?? [])
          .sort((left, right) => left.observationId.localeCompare(right.observationId)),
      };
    }),
    config.minimumBlockObservations
  );
  const distributionBlocks = workingBlocks.map((block, blockIndex) => {
    const probability = 1 / block.observations.length;
    const empiricalSupport = block.observations.map((observation) => {
      if (observation.outcome.state !== 'mature_observed') {
        throw new TypeError('Eligible benchmark support must contain mature outcomes.');
      }
      return {
        observationId: observation.observationId,
        contribution: observation.outcome.contribution,
        category: observation.outcome.category,
        probability,
      };
    });
    const quantileValues = empiricalSupport.map(({ contribution }) => contribution);
    return {
      blockIndex,
      minimumSelectionNumber: Math.min(...block.selectionNumbers),
      maximumSelectionNumber: Math.max(...block.selectionNumbers),
      sourceSelectionNumbers: [...block.selectionNumbers].sort((left, right) => left - right),
      fittedExpectedContribution: block.fittedValue,
      observationCount: block.observations.length,
      empiricalSupport,
      outcomeProbabilities: AFL_TRADE_PICK_OUTCOME_CATEGORIES.map((category) => ({
        category,
        probability: empiricalSupport
          .filter((support) => support.category === category)
          .reduce((sum, support) => sum + support.probability, 0),
      })),
      p10Contribution: empiricalQuantile(quantileValues, 0.1),
      p50Contribution: empiricalQuantile(quantileValues, 0.5),
      p90Contribution: empiricalQuantile(quantileValues, 0.9),
    };
  });
  const minimumTrainingSelection = Math.min(...observationsBySelection.keys());
  const maximumTrainingSelection = Math.max(...observationsBySelection.keys());
  const selectionCurve = Array.from(
    { length: maximumTrainingSelection - minimumTrainingSelection + 1 },
    (_, offset) => {
      const selectionNumber = minimumTrainingSelection + offset;
      const block = [...distributionBlocks]
        .reverse()
        .find((candidate) => candidate.minimumSelectionNumber <= selectionNumber)!;
      return {
        selectionNumber,
        distributionBlockIndex: block.blockIndex,
        expectedContribution: block.fittedExpectedContribution,
        p10Contribution: block.p10Contribution,
        p50Contribution: block.p50Contribution,
        p90Contribution: block.p90Contribution,
      };
    }
  );
  const content = aflTradePickDistributionBenchmarkFitContentSchema.parse({
    schemaVersion: 'afl-trade-pick-distribution-benchmark-fit/v1',
    observationSetId: observationSet.observationSetId,
    datasetId: observationSet.content.datasetId,
    modelProtocolId: observationSet.content.modelProtocolId,
    valueUnitId: observationSet.content.valueUnitId,
    fixedHorizonSeasons: observationSet.content.fixedHorizonSeasons,
    fixedHorizonDefinitionArtifactId: observationSet.content.fixedHorizonDefinitionArtifactId,
    outcomeDefinitionArtifactId: observationSet.content.outcomeDefinitionArtifactId,
    publicAssetBoundary: observationSet.content.publicAssetBoundary,
    config,
    trainingObservationIds: eligible.map(({ observationId }) => observationId).sort(),
    excludedObservations: excludedObservations.sort((left, right) =>
      left.observationId.localeCompare(right.observationId)
    ),
    distributionBlocks,
    selectionCurve,
    diagnostics: {
      inputObservationCount: observationSet.content.observations.length,
      eligibleTrainingObservationCount: eligible.length,
      excludedObservationCount: excludedObservations.length,
      sourceSelectionCount: observationsBySelection.size,
      fittedBlockCount: distributionBlocks.length,
      minimumTrainingSelection,
      maximumTrainingSelection,
    },
    limitation:
      'Deterministic mature-cohort benchmark only; not source approval, a censor-aware candidate, or deployment evidence.',
  });
  return aflTradePickDistributionBenchmarkFitSchema.parse({
    benchmarkFitId: createAflTradeContentAddress('pick-benchmark-fit', content),
    content,
  });
}
