import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_MODEL_PARTITIONS } from './playerContributionContracts';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const finiteNumberSchema = z.number().finite();
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_PICK_OUTCOME_CATEGORIES = [
  'no_afl_game',
  'short_career',
  'replacement_level',
  'regular_contributor',
  'high_quality',
  'elite',
] as const;

export const AFL_TRADE_DRAFT_PATHWAYS = [
  'national',
  'rookie',
  'preseason',
  'supplementary',
] as const;

export const AFL_TRADE_SELECTION_ACCESS_TYPES = [
  'open',
  'father_son_bid_match',
  'academy_bid_match',
  'other_restricted',
] as const;

const draftSelectionSchema = z
  .object({
    pathway: z.enum(AFL_TRADE_DRAFT_PATHWAYS),
    access: z.enum(AFL_TRADE_SELECTION_ACCESS_TYPES),
    nominalSelectionNumber: z.number().int().positive().max(500).nullable(),
    actualSelectionNumber: z.number().int().positive().max(500).nullable(),
    bidSelectionNumber: z.number().int().positive().max(500).nullable(),
    draftRound: z.number().int().positive().max(30).nullable(),
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      selection.pathway === 'national' &&
      (selection.nominalSelectionNumber === null ||
        selection.actualSelectionNumber === null ||
        selection.draftRound === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'National-draft observations require nominal, actual, and round positions.',
      });
    }
    if (selection.pathway !== 'national' && selection.bidSelectionNumber !== null) {
      context.addIssue({
        code: 'custom',
        path: ['bidSelectionNumber'],
        message: 'Bid-matched selection positions belong to the national draft only.',
      });
    }
    const restricted = selection.access !== 'open';
    if (
      (restricted && selection.pathway === 'national' && selection.bidSelectionNumber === null) ||
      (!restricted && selection.bidSelectionNumber !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bidSelectionNumber'],
        message: 'Bid position must be present exactly for restricted national selections.',
      });
    }
  });

const matureOutcomeSchema = z
  .object({
    state: z.literal('mature_observed'),
    contribution: finiteNumberSchema,
    gamesPlayed: z.number().int().nonnegative().max(500),
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (
      outcome.category === 'no_afl_game' &&
      (outcome.gamesPlayed !== 0 || outcome.contribution !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The no-game outcome requires zero games and zero contribution.',
      });
    }
    if (outcome.category !== 'no_afl_game' && outcome.gamesPlayed === 0) {
      context.addIssue({
        code: 'custom',
        path: ['gamesPlayed'],
        message: 'Every non-no-game outcome requires at least one AFL game.',
      });
    }
  });

const rightCensoredOutcomeSchema = z
  .object({
    state: z.literal('right_censored'),
    contributionObservedToDate: finiteNumberSchema,
    gamesObservedToDate: z.number().int().nonnegative().max(500),
    censoredAt: isoDateTimeSchema,
  })
  .strict();

const unavailableOutcomeSchema = z
  .object({
    state: z.literal('unavailable'),
    reason: z.enum([
      'source_missing',
      'identity_unresolved',
      'definition_unsupported',
      'pathway_unsupported',
    ]),
  })
  .strict();

export const aflTradePickOutcomeObservationSchema = z
  .object({
    observationId: publicIdSchema,
    playerId: publicIdSchema,
    draftClassId: publicIdSchema,
    draftYear: z.number().int().min(1897).max(2100),
    partition: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    predictionCutoffAt: isoDateTimeSchema,
    selectionKnownAt: isoDateTimeSchema,
    outcomeHorizonEndsAt: isoDateTimeSchema,
    outcomeObservedAt: isoDateTimeSchema,
    selection: draftSelectionSchema,
    era: publicIdSchema,
    playerPosition: publicIdSchema,
    ageAtDraft: z.number().finite().min(15).max(35),
    evidenceQuality: z.enum(['high', 'medium', 'low']),
    outcome: z.discriminatedUnion('state', [
      matureOutcomeSchema,
      rightCensoredOutcomeSchema,
      unavailableOutcomeSchema,
    ]),
  })
  .strict()
  .superRefine((observation, context) => {
    const predictionCutoff = Date.parse(observation.predictionCutoffAt);
    const horizonEnd = Date.parse(observation.outcomeHorizonEndsAt);
    const observedAt = Date.parse(observation.outcomeObservedAt);
    if (Date.parse(observation.selectionKnownAt) > predictionCutoff) {
      context.addIssue({
        code: 'custom',
        path: ['selectionKnownAt'],
        message: 'Selection evidence must be known by the prediction cutoff.',
      });
    }
    if (horizonEnd <= predictionCutoff || observedAt <= predictionCutoff) {
      context.addIssue({
        code: 'custom',
        path: ['outcomeObservedAt'],
        message: 'The outcome horizon and observation must follow the prediction cutoff.',
      });
    }
    if (observation.outcome.state === 'mature_observed' && observedAt < horizonEnd) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'A mature outcome cannot be observed before its fixed horizon ends.',
      });
    }
    if (observation.outcome.state === 'right_censored') {
      if (
        observation.outcome.censoredAt !== observation.outcomeObservedAt ||
        observedAt >= horizonEnd
      ) {
        context.addIssue({
          code: 'custom',
          path: ['outcome', 'censoredAt'],
          message: 'Right-censoring must occur at observation time before the horizon ends.',
        });
      }
    }
  });

export const aflTradePickOutcomeObservationSetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-observation-set/v1'),
    publicAssetBoundary: z.literal('source_native_afl_draft_selection_no_fantasy_ownership'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    valueUnitId: publicIdSchema,
    fixedHorizonSeasons: z.number().int().positive().max(30),
    fixedHorizonDefinitionArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    outcomeDefinitionArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    curveEligibility: z.literal('open_access_national_draft_actual_selection_only'),
    observations: z.array(aflTradePickOutcomeObservationSchema).min(4).max(100_000),
  })
  .strict()
  .superRefine((set, context) => {
    const observationIds = set.observations.map(({ observationId }) => observationId);
    const playerDraftYears = set.observations.map(
      ({ playerId, draftYear }) => `${playerId}:${draftYear}`
    );
    if (
      new Set(observationIds).size !== observationIds.length ||
      new Set(playerDraftYears).size !== playerDraftYears.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Observation identities and player draft-year identities must be unique.',
      });
    }

    const classYears = new Map<string, number>();
    const yearClasses = new Map<number, string>();
    const classPartitions = new Map<string, Set<string>>();
    const classHorizons = new Map<string, Set<string>>();
    const classMaturity = new Map<string, Set<string>>();
    for (const observation of set.observations) {
      classYears.set(observation.draftClassId, observation.draftYear);
      yearClasses.set(observation.draftYear, observation.draftClassId);
      const partitions = classPartitions.get(observation.draftClassId) ?? new Set<string>();
      partitions.add(observation.partition);
      classPartitions.set(observation.draftClassId, partitions);
      const horizons = classHorizons.get(observation.draftClassId) ?? new Set<string>();
      horizons.add(observation.outcomeHorizonEndsAt);
      classHorizons.set(observation.draftClassId, horizons);
      if (observation.outcome.state !== 'unavailable') {
        const maturity = classMaturity.get(observation.draftClassId) ?? new Set<string>();
        maturity.add(observation.outcome.state);
        classMaturity.set(observation.draftClassId, maturity);
      }
    }
    const classYearPairs = set.observations.map(
      ({ draftClassId, draftYear }) => `${draftClassId}:${draftYear}`
    );
    if (
      classYears.size !== new Set(classYearPairs).size ||
      yearClasses.size !== new Set(classYearPairs).size ||
      [...classPartitions.values()].some((partitions) => partitions.size !== 1) ||
      [...classHorizons.values()].some((horizons) => horizons.size !== 1) ||
      [...classMaturity.values()].some((maturity) => maturity.size > 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Each draft class must map to one year, partition, horizon, and cohort-level maturity state.',
      });
    }

    for (const partition of AFL_TRADE_MODEL_PARTITIONS) {
      if (!set.observations.some((observation) => observation.partition === partition)) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: `Observation set must contain the ${partition} partition.`,
        });
      }
    }
    for (let index = 1; index < AFL_TRADE_MODEL_PARTITIONS.length; index += 1) {
      const previous = AFL_TRADE_MODEL_PARTITIONS[index - 1];
      const current = AFL_TRADE_MODEL_PARTITIONS[index];
      const previousLabels = set.observations
        .filter(({ partition }) => partition === previous)
        .map(({ outcomeObservedAt }) => Date.parse(outcomeObservedAt));
      const currentCutoffs = set.observations
        .filter(({ partition }) => partition === current)
        .map(({ predictionCutoffAt }) => Date.parse(predictionCutoffAt));
      if (Math.max(...previousLabels) >= Math.min(...currentCutoffs)) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Whole draft-class partitions must be chronological and label-purged.',
        });
        break;
      }
    }
  });

export const aflTradePickOutcomeObservationSetSchema = z
  .object({
    observationSetId: aflTradeContentAddressedIdSchema('pick-observation-set'),
    content: aflTradePickOutcomeObservationSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'pick-observation-set',
      set.observationSetId,
      set.content,
      context,
      ['observationSetId']
    );
  });

export type AflTradePickOutcomeObservation = z.infer<typeof aflTradePickOutcomeObservationSchema>;
export type AflTradePickOutcomeObservationSetContent = z.infer<
  typeof aflTradePickOutcomeObservationSetContentSchema
>;
export type AflTradePickOutcomeObservationSet = z.infer<
  typeof aflTradePickOutcomeObservationSetSchema
>;

export function createAflTradePickOutcomeObservationSet(
  unparsedContent: AflTradePickOutcomeObservationSetContent
): AflTradePickOutcomeObservationSet {
  const parsed = aflTradePickOutcomeObservationSetContentSchema.parse(unparsedContent);
  const content = {
    ...parsed,
    observations: [...parsed.observations].sort((left, right) =>
      left.observationId.localeCompare(right.observationId)
    ),
  };
  return aflTradePickOutcomeObservationSetSchema.parse({
    observationSetId: createAflTradeContentAddress('pick-observation-set', content),
    content,
  });
}
