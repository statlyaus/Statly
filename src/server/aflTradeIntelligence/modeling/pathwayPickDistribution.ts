import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_DRAFT_PATHWAYS,
  aflTradePickOutcomeObservationSetSchema,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSet,
} from './pickOutcomeContracts';
import { fitAflTradeWeightedNonIncreasingIsotonic } from './weightedIsotonic';

const finiteNumberSchema = z.number().finite();
const publicIdSchema = z.string().trim().min(1).max(240);
const pathwaySchema = z.enum(AFL_TRADE_DRAFT_PATHWAYS);

export const AFL_TRADE_PATHWAY_PICK_EXCLUSION_REASONS = [
  'held_out_partition',
  'right_censored',
  'outcome_unavailable',
  'restricted_access',
  'actual_selection_unavailable',
] as const;

export const aflTradePathwayPickDistributionConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pathway-pick-distribution-config/v1'),
    minimumPathwayObservations: z.number().int().positive().max(100_000),
    minimumBlockObservations: z.number().int().positive().max(100_000),
    extrapolation: z.literal('prohibited'),
    estimatorStatus: z.literal('candidate_requires_validation_and_approval'),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.minimumBlockObservations > config.minimumPathwayObservations) {
      context.addIssue({
        code: 'custom',
        path: ['minimumBlockObservations'],
        message: 'Block support cannot exceed the minimum support required for a pathway.',
      });
    }
  });

const summarySchema = z
  .object({
    median: finiteNumberSchema,
    p10: finiteNumberSchema,
    p90: finiteNumberSchema,
  })
  .strict();

const availablePathwaySchema = z
  .object({
    pathway: pathwaySchema,
    status: z.literal('available'),
    eligibleObservationCount: z.number().int().positive(),
    minimumSelectionNumber: z.number().int().positive(),
    maximumSelectionNumber: z.number().int().positive(),
    blocks: z
      .array(
        z
          .object({
            blockIndex: z.number().int().nonnegative(),
            sourceSelectionNumbers: z.array(z.number().int().positive()).min(1),
            observationIds: z.array(publicIdSchema).min(1),
            expectedContribution: finiteNumberSchema,
            distribution: summarySchema,
          })
          .strict()
      )
      .min(1),
    curve: z
      .array(
        z
          .object({
            selectionNumber: z.number().int().positive(),
            blockIndex: z.number().int().nonnegative(),
            expectedContribution: finiteNumberSchema,
            distribution: summarySchema,
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const insufficientPathwaySchema = z
  .object({
    pathway: pathwaySchema,
    status: z.literal('insufficient_data'),
    eligibleObservationCount: z.number().int().nonnegative(),
    minimumRequired: z.number().int().positive(),
    trainingObservationIds: z.array(publicIdSchema),
  })
  .strict();

const contentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pathway-pick-distribution/v1'),
    observationSetId: aflTradeContentAddressedIdSchema('pick-observation-set'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    valueUnitId: publicIdSchema,
    config: aflTradePathwayPickDistributionConfigSchema,
    pathways: z
      .array(z.discriminatedUnion('status', [availablePathwaySchema, insufficientPathwaySchema]))
      .length(AFL_TRADE_DRAFT_PATHWAYS.length),
    excludedObservations: z.array(
      z
        .object({
          observationId: publicIdSchema,
          reason: z.enum(AFL_TRADE_PATHWAY_PICK_EXCLUSION_REASONS),
        })
        .strict()
    ),
    limitations: z.tuple([
      z.literal('Pathways are never pooled; unsupported selections remain unavailable.'),
      z.literal(
        'Candidate requires temporal validation, calibration, review, and activation before public use.'
      ),
    ]),
    publicationEligible: z.literal(false),
  })
  .strict();

const distributionSchema = z
  .object({
    distributionId: aflTradeContentAddressedIdSchema('pathway-pick-distribution'),
    content: contentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeContentAddressIssue(
      'pathway-pick-distribution',
      value.distributionId,
      value.content,
      context,
      ['distributionId']
    );
  });

export type AflTradePathwayPickDistributionConfig = z.infer<
  typeof aflTradePathwayPickDistributionConfigSchema
>;

type EligibleObservation = AflTradePickOutcomeObservation & {
  outcome: Extract<AflTradePickOutcomeObservation['outcome'], { state: 'mature_observed' }>;
};

interface WorkingBlock {
  selectionNumbers: number[];
  observations: EligibleObservation[];
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function summarize(observations: readonly EligibleObservation[]) {
  const values = observations.map(({ outcome }) => outcome.contribution);
  return { median: quantile(values, 0.5), p10: quantile(values, 0.1), p90: quantile(values, 0.9) };
}

function mean(observations: readonly EligibleObservation[]): number {
  return (
    observations.reduce((total, value) => total + value.outcome.contribution, 0) /
    observations.length
  );
}

function mergeSparseBlocks(blocks: WorkingBlock[], minimum: number): WorkingBlock[] {
  const result = blocks.map((block) => ({
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
          : Math.abs(mean(result[index - 1].observations) - mean(result[index].observations)) <=
              Math.abs(mean(result[index].observations) - mean(result[index + 1].observations))
            ? index - 1
            : index;
    result.splice(mergeFrom, 2, {
      selectionNumbers: [
        ...result[mergeFrom].selectionNumbers,
        ...result[mergeFrom + 1].selectionNumbers,
      ].sort((a, b) => a - b),
      observations: [...result[mergeFrom].observations, ...result[mergeFrom + 1].observations].sort(
        (a, b) => a.observationId.localeCompare(b.observationId)
      ),
    });
  }
  return result;
}

function exclusionReason(observation: AflTradePickOutcomeObservation) {
  if (observation.partition !== 'train') return 'held_out_partition' as const;
  if (observation.outcome.state === 'right_censored') return 'right_censored' as const;
  if (observation.outcome.state === 'unavailable') return 'outcome_unavailable' as const;
  if (observation.selection.access !== 'open') return 'restricted_access' as const;
  if (observation.selection.actualSelectionNumber === null)
    return 'actual_selection_unavailable' as const;
  return null;
}

function fitPathway(
  pathway: (typeof AFL_TRADE_DRAFT_PATHWAYS)[number],
  observations: EligibleObservation[],
  config: AflTradePathwayPickDistributionConfig
) {
  const sorted = [...observations].sort((a, b) => a.observationId.localeCompare(b.observationId));
  if (sorted.length < config.minimumPathwayObservations) {
    return {
      pathway,
      status: 'insufficient_data' as const,
      eligibleObservationCount: sorted.length,
      minimumRequired: config.minimumPathwayObservations,
      trainingObservationIds: sorted.map(({ observationId }) => observationId),
    };
  }
  const bySelection = new Map<number, EligibleObservation[]>();
  sorted.forEach((observation) => {
    const selection = observation.selection.actualSelectionNumber!;
    bySelection.set(selection, [...(bySelection.get(selection) ?? []), observation]);
  });
  const isotonic = fitAflTradeWeightedNonIncreasingIsotonic(
    [...bySelection.entries()].map(([selection, values]) => ({
      pointId: `selection:${selection}`,
      x: selection,
      value: mean(values),
      weight: values.length,
    }))
  );
  const working = mergeSparseBlocks(
    isotonic.blocks.map((block) => {
      const selections = block.pointIds.map((id) => Number(id.split(':')[1]));
      return {
        selectionNumbers: selections,
        observations: selections.flatMap((selection) => bySelection.get(selection) ?? []),
      };
    }),
    config.minimumBlockObservations
  );
  const blocks = working.map((block, blockIndex) => ({
    blockIndex,
    sourceSelectionNumbers: block.selectionNumbers,
    observationIds: block.observations.map(({ observationId }) => observationId).sort(),
    expectedContribution: mean(block.observations),
    distribution: summarize(block.observations),
  }));
  const minimumSelectionNumber = Math.min(...bySelection.keys());
  const maximumSelectionNumber = Math.max(...bySelection.keys());
  const curve = Array.from(
    { length: maximumSelectionNumber - minimumSelectionNumber + 1 },
    (_, index) => {
      const selectionNumber = minimumSelectionNumber + index;
      const block = [...blocks]
        .reverse()
        .find((value) => value.sourceSelectionNumbers[0] <= selectionNumber)!;
      return {
        selectionNumber,
        blockIndex: block.blockIndex,
        expectedContribution: block.expectedContribution,
        distribution: block.distribution,
      };
    }
  );
  return {
    pathway,
    status: 'available' as const,
    eligibleObservationCount: sorted.length,
    minimumSelectionNumber,
    maximumSelectionNumber,
    blocks,
    curve,
  };
}

export function fitAflTradePathwayPickDistributions(
  unparsedSet: AflTradePickOutcomeObservationSet,
  unparsedConfig: AflTradePathwayPickDistributionConfig
) {
  const set = aflTradePickOutcomeObservationSetSchema.parse(unparsedSet);
  const config = aflTradePathwayPickDistributionConfigSchema.parse(unparsedConfig);
  const eligible: EligibleObservation[] = [];
  const excludedObservations: Array<{
    observationId: string;
    reason: (typeof AFL_TRADE_PATHWAY_PICK_EXCLUSION_REASONS)[number];
  }> = [];
  set.content.observations.forEach((observation) => {
    const reason = exclusionReason(observation);
    if (reason) excludedObservations.push({ observationId: observation.observationId, reason });
    else eligible.push(observation as EligibleObservation);
  });
  const content = contentSchema.parse({
    schemaVersion: 'afl-trade-pathway-pick-distribution/v1',
    observationSetId: set.observationSetId,
    datasetId: set.content.datasetId,
    modelProtocolId: set.content.modelProtocolId,
    valueUnitId: set.content.valueUnitId,
    config,
    pathways: AFL_TRADE_DRAFT_PATHWAYS.map((pathway) =>
      fitPathway(
        pathway,
        eligible.filter((observation) => observation.selection.pathway === pathway),
        config
      )
    ),
    excludedObservations: excludedObservations.sort((a, b) =>
      a.observationId.localeCompare(b.observationId)
    ),
    limitations: [
      'Pathways are never pooled; unsupported selections remain unavailable.',
      'Candidate requires temporal validation, calibration, review, and activation before public use.',
    ],
    publicationEligible: false,
  });
  return distributionSchema.parse({
    distributionId: createAflTradeContentAddress('pathway-pick-distribution', content),
    content,
  });
}
