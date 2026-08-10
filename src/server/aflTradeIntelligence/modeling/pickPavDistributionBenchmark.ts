import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  aflTradePickPavObservationSetSchema,
  type AflTradePickPavObservation,
  type AflTradePickPavObservationSet,
} from './pickOutcomeContracts';
import { fitAflTradeWeightedNonIncreasingIsotonic } from './weightedIsotonic';

export const AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_SCHEMA_VERSION =
  'afl-trade-pick-pav-distribution-benchmark/v1' as const;
export const AFL_TRADE_PICK_PAV_DISTRIBUTION_AUTHORITY_BOUNDARY =
  'private_exact_released_selection_fixed_horizon_pav_training_benchmark_no_grade_publication_or_fantasy_ownership' as const;

const finite = z.number().finite();
const probability = finite.min(0).max(1);
const FLOAT_TOLERANCE = 1e-10;

export const AFL_TRADE_PICK_PAV_BENCHMARK_EXCLUSION_REASONS = [
  'held_out_partition',
  'right_censored',
  'outcome_unavailable',
  'non_national_pathway',
  'selection_access_not_open',
] as const;

export const aflTradePickPavDistributionBenchmarkConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-distribution-benchmark-config/v1'),
    minimumBlockObservations: z.number().int().positive().max(100_000),
    eligibility: z.literal('mature_open_access_national_draft_training_observations'),
    informationWeight: z.literal('eligible_selection_count'),
    smoother: z.literal('weighted_non_increasing_isotonic'),
    sparseBlockMergePolicy: z.literal('nearest_adjacent_fitted_mean_left_tie_break'),
    interpolation: z.literal('left_block_carry_forward_within_training_domain'),
    extrapolation: z.literal('prohibited'),
    estimatorStatus: z.literal('benchmark_only_requires_temporal_validation_and_approval'),
  })
  .strict();

const empiricalSupportSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
    selectionId: aflTradeContentAddressedIdSchema('draft-selection'),
    draftYear: z.number().int().min(1897).max(2200),
    actualSelectionNumber: z.number().int().positive().max(500),
    contribution: finite,
    gamesPlayed: z.number().int().nonnegative().max(500),
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    probability,
  })
  .strict();

const distributionSummarySchema = z
  .object({
    expectedContribution: finite,
    p10Contribution: finite,
    p50Contribution: finite,
    p90Contribution: finite,
    expectedGames: finite.nonnegative(),
    p10Games: z.number().int().nonnegative(),
    p50Games: z.number().int().nonnegative(),
    p90Games: z.number().int().nonnegative(),
    outcomeProbabilities: z
      .array(
        z.object({ category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES), probability }).strict()
      )
      .length(AFL_TRADE_PICK_OUTCOME_CATEGORIES.length),
  })
  .strict();

const distributionBlockSchema = z
  .object({
    blockIndex: z.number().int().nonnegative(),
    minimumSelectionNumber: z.number().int().positive().max(500),
    maximumSelectionNumber: z.number().int().positive().max(500),
    sourceSelectionNumbers: z.array(z.number().int().positive().max(500)).min(1).max(500),
    observationCount: z.number().int().positive().max(100_000),
    draftClassCount: z.number().int().positive().max(500),
    empiricalSupport: z.array(empiricalSupportSchema).min(1).max(100_000),
    distribution: distributionSummarySchema,
  })
  .strict();

const curvePointSchema = z
  .object({
    selectionNumber: z.number().int().positive().max(500),
    distributionBlockIndex: z.number().int().nonnegative(),
    observationCount: z.number().int().positive(),
    distribution: distributionSummarySchema,
  })
  .strict();

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PICK_PAV_DISTRIBUTION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    observationSetSha256: aflTradeSha256Schema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    valueUnit: z.literal('fixed_horizon_pav'),
    fixedHorizonSeasons: z.number().int().positive().max(15),
    config: aflTradePickPavDistributionBenchmarkConfigSchema,
    trainingObservationIds: z
      .array(aflTradeContentAddressedIdSchema('pick-pav-observation'))
      .min(1)
      .max(100_000),
    excludedObservations: z
      .array(
        z
          .object({
            observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
            reason: z.enum(AFL_TRADE_PICK_PAV_BENCHMARK_EXCLUSION_REASONS),
          })
          .strict()
      )
      .max(100_000),
    distributionBlocks: z.array(distributionBlockSchema).min(1).max(500),
    selectionCurve: z.array(curvePointSchema).min(1).max(500),
    diagnostics: z
      .object({
        inputObservationCount: z.number().int().positive(),
        eligibleTrainingObservationCount: z.number().int().positive(),
        excludedObservationCount: z.number().int().nonnegative(),
        sourceSelectionCount: z.number().int().positive().max(500),
        sourceDraftClassCount: z.number().int().positive().max(500),
        fittedBlockCount: z.number().int().positive().max(500),
        minimumTrainingSelection: z.number().int().positive().max(500),
        maximumTrainingSelection: z.number().int().positive().max(500),
      })
      .strict(),
    limitations: z.tuple([
      z.literal(
        'Training-only mature national-draft benchmark; active careers and held-out cohorts are excluded, not treated as zero.'
      ),
      z.literal(
        'Unsupported selections are unavailable; this candidate is not a grade or approved publication.'
      ),
    ]),
  })
  .strict()
  .superRefine((fit, context) => {
    const trainingIds = [...fit.trainingObservationIds].sort();
    const excludedIds = fit.excludedObservations.map(({ observationId }) => observationId).sort();
    const allIds = [...trainingIds, ...excludedIds];
    if (
      new Set(trainingIds).size !== trainingIds.length ||
      new Set(excludedIds).size !== excludedIds.length ||
      new Set(allIds).size !== allIds.length ||
      allIds.length !== fit.diagnostics.inputObservationCount ||
      fit.diagnostics.eligibleTrainingObservationCount !== trainingIds.length ||
      fit.diagnostics.excludedObservationCount !== excludedIds.length ||
      fit.diagnostics.fittedBlockCount !== fit.distributionBlocks.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['trainingObservationIds'],
        message: 'Training and exclusion membership must form one exact disjoint input partition.',
      });
    }
    const supportIds: string[] = [];
    const sourceSelections: number[] = [];
    const sourceDraftYears = new Set<number>();
    let previousMaximum = 0;
    let previousExpected = Number.POSITIVE_INFINITY;
    for (const [index, block] of fit.distributionBlocks.entries()) {
      const selections = [...block.sourceSelectionNumbers].sort((left, right) => left - right);
      const support = [...block.empiricalSupport].sort((left, right) =>
        left.observationId.localeCompare(right.observationId)
      );
      const probabilityPerObservation = 1 / support.length;
      const contributionValues = support.map(({ contribution }) => contribution);
      const gameValues = support.map(({ gamesPlayed }) => gamesPlayed);
      const expectedContribution = mean(contributionValues);
      const expectedGames = mean(gameValues);
      const categoryProbabilities = AFL_TRADE_PICK_OUTCOME_CATEGORIES.map((category) =>
        support
          .filter((observation) => observation.category === category)
          .reduce((sum, observation) => sum + observation.probability, 0)
      );
      const summary = block.distribution;
      if (
        block.blockIndex !== index ||
        block.minimumSelectionNumber !== selections[0] ||
        block.maximumSelectionNumber !== selections.at(-1) ||
        block.minimumSelectionNumber <= previousMaximum ||
        new Set(selections).size !== selections.length ||
        block.observationCount !== support.length ||
        block.draftClassCount !== new Set(support.map(({ draftYear }) => draftYear)).size ||
        block.draftClassCount < 1 ||
        (fit.distributionBlocks.length > 1 &&
          block.observationCount < fit.config.minimumBlockObservations) ||
        support.some(
          (observation) =>
            !selections.includes(observation.actualSelectionNumber) ||
            Math.abs(observation.probability - probabilityPerObservation) > FLOAT_TOLERANCE
        ) ||
        Math.abs(summary.expectedContribution - expectedContribution) > FLOAT_TOLERANCE ||
        Math.abs(summary.expectedGames - expectedGames) > FLOAT_TOLERANCE ||
        summary.expectedContribution > previousExpected + FLOAT_TOLERANCE ||
        summary.p10Contribution !== quantile(contributionValues, 0.1) ||
        summary.p50Contribution !== quantile(contributionValues, 0.5) ||
        summary.p90Contribution !== quantile(contributionValues, 0.9) ||
        summary.p10Games !== quantile(gameValues, 0.1) ||
        summary.p50Games !== quantile(gameValues, 0.5) ||
        summary.p90Games !== quantile(gameValues, 0.9) ||
        summary.outcomeProbabilities.some(
          ({ category, probability: value }, categoryIndex) =>
            category !== AFL_TRADE_PICK_OUTCOME_CATEGORIES[categoryIndex] ||
            Math.abs(value - categoryProbabilities[categoryIndex]) > FLOAT_TOLERANCE
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['distributionBlocks', index],
          message: 'Distribution blocks must be supported, monotone, canonical empirical fits.',
        });
      }
      supportIds.push(...support.map(({ observationId }) => observationId));
      sourceSelections.push(...selections);
      support.forEach(({ draftYear }) => sourceDraftYears.add(draftYear));
      previousMaximum = block.maximumSelectionNumber;
      previousExpected = summary.expectedContribution;
    }
    if (
      [...supportIds].sort().some((id, index) => id !== trainingIds[index]) ||
      new Set(supportIds).size !== supportIds.length ||
      new Set(sourceSelections).size !== sourceSelections.length ||
      fit.diagnostics.sourceSelectionCount !== sourceSelections.length ||
      fit.diagnostics.sourceDraftClassCount !== sourceDraftYears.size
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distributionBlocks'],
        message: 'Distribution support must reconcile exactly with training membership.',
      });
    }
    const minimum = fit.diagnostics.minimumTrainingSelection;
    const maximum = fit.diagnostics.maximumTrainingSelection;
    if (
      minimum !== Math.min(...sourceSelections) ||
      maximum !== Math.max(...sourceSelections) ||
      fit.selectionCurve.length !== maximum - minimum + 1 ||
      fit.selectionCurve.some((point, index) => point.selectionNumber !== minimum + index)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectionCurve'],
        message: 'The selection curve must cover exactly the supported training domain.',
      });
    }
    for (const [index, point] of fit.selectionCurve.entries()) {
      const expectedBlock = [...fit.distributionBlocks]
        .reverse()
        .find((block) => block.minimumSelectionNumber <= point.selectionNumber);
      if (
        !expectedBlock ||
        point.distributionBlockIndex !== expectedBlock.blockIndex ||
        point.observationCount !== expectedBlock.observationCount ||
        JSON.stringify(point.distribution) !== JSON.stringify(expectedBlock.distribution)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['selectionCurve', index],
          message: 'Every curve point must carry its exact fitted empirical distribution.',
        });
      }
    }
  });

export const aflTradePickPavDistributionBenchmarkSchema = z
  .object({
    benchmarkId: aflTradeContentAddressedIdSchema('pick-pav-benchmark'),
    content: contentSchema,
  })
  .strict()
  .superRefine((benchmark, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-benchmark',
      benchmark.benchmarkId,
      benchmark.content,
      context,
      ['benchmarkId']
    );
  });

export type AflTradePickPavDistributionBenchmarkConfig = z.infer<
  typeof aflTradePickPavDistributionBenchmarkConfigSchema
>;
export type AflTradePickPavDistributionBenchmark = z.infer<
  typeof aflTradePickPavDistributionBenchmarkSchema
>;

export const DEFAULT_AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_CONFIG = {
  schemaVersion: 'afl-trade-pick-pav-distribution-benchmark-config/v1',
  minimumBlockObservations: 20,
  eligibility: 'mature_open_access_national_draft_training_observations',
  informationWeight: 'eligible_selection_count',
  smoother: 'weighted_non_increasing_isotonic',
  sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
  interpolation: 'left_block_carry_forward_within_training_domain',
  extrapolation: 'prohibited',
  estimatorStatus: 'benchmark_only_requires_temporal_validation_and_approval',
} as const satisfies AflTradePickPavDistributionBenchmarkConfig;

type EligibleObservation = AflTradePickPavObservation & {
  outcome: Extract<AflTradePickPavObservation['outcome'], { state: 'mature_observed' }>;
};

interface WorkingBlock {
  selectionNumbers: number[];
  fittedValue: number;
  observations: EligibleObservation[];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: readonly number[], target: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(target * ordered.length) - 1)]!;
}

function exclusionReason(
  observation: AflTradePickPavObservation
): (typeof AFL_TRADE_PICK_PAV_BENCHMARK_EXCLUSION_REASONS)[number] | null {
  if (observation.partition !== 'train') return 'held_out_partition';
  if (observation.outcome.state === 'right_censored') return 'right_censored';
  if (observation.outcome.state === 'unavailable') return 'outcome_unavailable';
  if (observation.selection.pathway !== 'national') return 'non_national_pathway';
  if (observation.selection.access.state !== 'open') return 'selection_access_not_open';
  return null;
}

function merged(left: WorkingBlock, right: WorkingBlock): WorkingBlock {
  const observations = [...left.observations, ...right.observations].sort((a, b) =>
    a.observationId.localeCompare(b.observationId)
  );
  return {
    selectionNumbers: [...left.selectionNumbers, ...right.selectionNumbers].sort((a, b) => a - b),
    fittedValue: mean(observations.map(({ outcome }) => outcome.contribution)),
    observations,
  };
}

function enforceMinimumSupport(blocks: WorkingBlock[], minimum: number): WorkingBlock[] {
  const result = blocks.map((block) => ({
    ...block,
    selectionNumbers: [...block.selectionNumbers],
    observations: [...block.observations],
  }));
  while (result.length > 1) {
    const index = result.findIndex(({ observations }) => observations.length < minimum);
    if (index < 0) break;
    const mergeFrom =
      index === 0
        ? 0
        : index === result.length - 1
          ? index - 1
          : Math.abs(result[index - 1]!.fittedValue - result[index]!.fittedValue) <=
              Math.abs(result[index]!.fittedValue - result[index + 1]!.fittedValue)
            ? index - 1
            : index;
    result.splice(mergeFrom, 2, merged(result[mergeFrom]!, result[mergeFrom + 1]!));
  }
  return result;
}

function summarize(observations: readonly EligibleObservation[]) {
  const contributions = observations.map(({ outcome }) => outcome.contribution);
  const games = observations.map(({ outcome }) => outcome.gamesPlayed);
  return {
    expectedContribution: mean(contributions),
    p10Contribution: quantile(contributions, 0.1),
    p50Contribution: quantile(contributions, 0.5),
    p90Contribution: quantile(contributions, 0.9),
    expectedGames: mean(games),
    p10Games: quantile(games, 0.1),
    p50Games: quantile(games, 0.5),
    p90Games: quantile(games, 0.9),
    outcomeProbabilities: AFL_TRADE_PICK_OUTCOME_CATEGORIES.map((category) => ({
      category,
      probability:
        observations.filter(({ outcome }) => outcome.category === category).length /
        observations.length,
    })),
  };
}

export function fitAflTradePickPavDistributionBenchmark(
  unparsedObservationSet: AflTradePickPavObservationSet,
  unparsedConfig: AflTradePickPavDistributionBenchmarkConfig = DEFAULT_AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_CONFIG
): AflTradePickPavDistributionBenchmark {
  const observationSet = aflTradePickPavObservationSetSchema.parse(unparsedObservationSet);
  const config = aflTradePickPavDistributionBenchmarkConfigSchema.parse(unparsedConfig);
  const eligible: EligibleObservation[] = [];
  const excludedObservations: Array<{
    observationId: string;
    reason: (typeof AFL_TRADE_PICK_PAV_BENCHMARK_EXCLUSION_REASONS)[number];
  }> = [];
  for (const observation of observationSet.content.observations) {
    const reason = exclusionReason(observation);
    if (reason === null && observation.outcome.state === 'mature_observed') {
      eligible.push(observation as EligibleObservation);
    } else {
      excludedObservations.push({
        observationId: observation.observationId,
        reason: reason ?? 'outcome_unavailable',
      });
    }
  }
  if (eligible.length === 0) {
    throw new RangeError('The pick-PAV benchmark requires eligible mature training observations.');
  }
  const latestTrainingHorizonEnd = Math.max(
    ...eligible.map(({ outcomeHorizonEndsAt }) => Date.parse(outcomeHorizonEndsAt))
  );
  const heldOutPredictionCutoffs = observationSet.content.observations
    .filter(({ partition }) => partition !== 'train')
    .map(({ predictionCutoffAt }) => Date.parse(predictionCutoffAt));
  if (
    heldOutPredictionCutoffs.length === 0 ||
    latestTrainingHorizonEnd >= Math.min(...heldOutPredictionCutoffs)
  ) {
    throw new RangeError(
      'Every training label horizon must end before the first held-out prediction cutoff.'
    );
  }
  const bySelection = new Map<number, EligibleObservation[]>();
  for (const observation of eligible) {
    const number = observation.selection.actualSelectionNumber;
    bySelection.set(number, [...(bySelection.get(number) ?? []), observation]);
  }
  const isotonic = fitAflTradeWeightedNonIncreasingIsotonic(
    [...bySelection.entries()].map(([selectionNumber, observations]) => ({
      pointId: `selection:${selectionNumber}`,
      x: selectionNumber,
      value: mean(observations.map(({ outcome }) => outcome.contribution)),
      weight: observations.length,
    }))
  );
  const working = enforceMinimumSupport(
    isotonic.blocks.map((block) => {
      const selectionNumbers = block.pointIds.map((id) => Number(id.split(':')[1]));
      return {
        selectionNumbers,
        fittedValue: block.fittedValue,
        observations: selectionNumbers
          .flatMap((number) => bySelection.get(number) ?? [])
          .sort((left, right) => left.observationId.localeCompare(right.observationId)),
      };
    }),
    config.minimumBlockObservations
  );
  const distributionBlocks = working.map((block, blockIndex) => {
    const empiricalProbability = 1 / block.observations.length;
    return {
      blockIndex,
      minimumSelectionNumber: Math.min(...block.selectionNumbers),
      maximumSelectionNumber: Math.max(...block.selectionNumbers),
      sourceSelectionNumbers: [...block.selectionNumbers],
      observationCount: block.observations.length,
      draftClassCount: new Set(block.observations.map(({ selection }) => selection.draftYear)).size,
      empiricalSupport: block.observations.map((observation) => ({
        observationId: observation.observationId,
        selectionId: observation.selection.selectionId,
        draftYear: observation.selection.draftYear,
        actualSelectionNumber: observation.selection.actualSelectionNumber,
        contribution: observation.outcome.contribution,
        gamesPlayed: observation.outcome.gamesPlayed,
        category: observation.outcome.category,
        probability: empiricalProbability,
      })),
      distribution: summarize(block.observations),
    };
  });
  const minimumTrainingSelection = Math.min(...bySelection.keys());
  const maximumTrainingSelection = Math.max(...bySelection.keys());
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
        observationCount: block.observationCount,
        distribution: block.distribution,
      };
    }
  );
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PICK_PAV_DISTRIBUTION_BENCHMARK_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PICK_PAV_DISTRIBUTION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: observationSet.content.environment,
    competition: observationSet.content.competition,
    observationSetId: observationSet.observationSetId,
    observationSetSha256: observationSet.content.observationSetSha256,
    releaseId: observationSet.content.releaseId,
    policyId: observationSet.content.policy.policyId,
    methodId: observationSet.content.policy.content.methodId,
    valueUnit: observationSet.content.policy.content.outcomeValueUnit,
    fixedHorizonSeasons: observationSet.content.policy.content.fixedHorizonSeasons,
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
      sourceSelectionCount: bySelection.size,
      sourceDraftClassCount: new Set(eligible.map(({ selection }) => selection.draftYear)).size,
      fittedBlockCount: distributionBlocks.length,
      minimumTrainingSelection,
      maximumTrainingSelection,
    },
    limitations: [
      'Training-only mature national-draft benchmark; active careers and held-out cohorts are excluded, not treated as zero.',
      'Unsupported selections are unavailable; this candidate is not a grade or approved publication.',
    ],
  });
  return aflTradePickPavDistributionBenchmarkSchema.parse({
    benchmarkId: createAflTradeContentAddress('pick-pav-benchmark', content),
    content,
  });
}
