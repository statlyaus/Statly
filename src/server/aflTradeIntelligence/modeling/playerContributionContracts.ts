import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const finiteNumberSchema = z.number().finite();
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_MODEL_PARTITIONS = [
  'train',
  'calibration',
  'validation',
  'final_test',
] as const;

const observedContributionSchema = z
  .object({
    state: z.literal('observed'),
    total: finiteNumberSchema,
  })
  .strict();

const unavailableContributionSchema = z
  .object({
    state: z.literal('unavailable'),
    reason: z.enum(['source_missing', 'definition_unsupported', 'identity_unresolved']),
  })
  .strict();

const completedCareerSchema = z
  .object({
    state: z.literal('completed'),
    careerEndedAt: isoDateTimeSchema,
  })
  .strict();

const rightCensoredCareerSchema = z
  .object({
    state: z.literal('right_censored'),
    censoredAt: isoDateTimeSchema,
  })
  .strict();

export const aflTradePlayerSeasonObservationSchema = z
  .object({
    observationId: publicIdSchema,
    playerId: publicIdSchema,
    season: z.number().int().min(1897).max(2100),
    role: publicIdSchema,
    era: publicIdSchema,
    partition: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    predictionCutoffAt: isoDateTimeSchema,
    roleKnownAt: isoDateTimeSchema,
    outcomeObservedAt: isoDateTimeSchema,
    gamesPlayed: z.number().int().nonnegative().max(30),
    gamesAvailable: z.number().int().positive().max(30),
    contribution: z.discriminatedUnion('state', [
      observedContributionSchema,
      unavailableContributionSchema,
    ]),
    career: z.discriminatedUnion('state', [completedCareerSchema, rightCensoredCareerSchema]),
  })
  .strict()
  .superRefine((observation, context) => {
    const cutoff = Date.parse(observation.predictionCutoffAt);
    const observedAt = Date.parse(observation.outcomeObservedAt);
    if (Date.parse(observation.roleKnownAt) > cutoff) {
      context.addIssue({
        code: 'custom',
        path: ['roleKnownAt'],
        message: 'Role assignment must be known by the prediction cutoff.',
      });
    }
    if (observedAt <= cutoff) {
      context.addIssue({
        code: 'custom',
        path: ['outcomeObservedAt'],
        message: 'The outcome must be observed after the prediction cutoff.',
      });
    }
    if (observation.gamesPlayed > observation.gamesAvailable) {
      context.addIssue({
        code: 'custom',
        path: ['gamesPlayed'],
        message: 'Games played cannot exceed games available.',
      });
    }
    if (
      observation.contribution.state === 'observed' &&
      observation.gamesPlayed === 0 &&
      observation.contribution.total !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['contribution', 'total'],
        message: 'An observed zero-game season must have zero contribution.',
      });
    }
    if (observation.career.state === 'completed') {
      const careerEndedAt = Date.parse(observation.career.careerEndedAt);
      if (careerEndedAt < cutoff || careerEndedAt > observedAt) {
        context.addIssue({
          code: 'custom',
          path: ['career', 'careerEndedAt'],
          message: 'A completed career must end after cutoff and by outcome observation.',
        });
      }
    } else if (observation.career.censoredAt !== observation.outcomeObservedAt) {
      context.addIssue({
        code: 'custom',
        path: ['career', 'censoredAt'],
        message: 'Right-censoring must occur at the observation boundary.',
      });
    }
  });

export const aflTradePlayerObservationSetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-observation-set/v1'),
    publicIdentityBoundary: z.literal('source_native_no_fantasy_ownership'),
    valueUnitId: publicIdSchema,
    observations: z.array(aflTradePlayerSeasonObservationSchema).min(4).max(100_000),
  })
  .strict()
  .superRefine((set, context) => {
    const observationIds = set.observations.map((observation) => observation.observationId);
    if (new Set(observationIds).size !== observationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Observation identifiers must be unique.',
      });
    }
    const playerSeasons = set.observations.map(
      (observation) => `${observation.playerId}:${observation.season}`
    );
    if (new Set(playerSeasons).size !== playerSeasons.length) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'A player may have only one observation per season.',
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
      const previousPartition = AFL_TRADE_MODEL_PARTITIONS[index - 1];
      const currentPartition = AFL_TRADE_MODEL_PARTITIONS[index];
      const previousOutcomes = set.observations
        .filter((observation) => observation.partition === previousPartition)
        .map((observation) => Date.parse(observation.outcomeObservedAt));
      const currentCutoffs = set.observations
        .filter((observation) => observation.partition === currentPartition)
        .map((observation) => Date.parse(observation.predictionCutoffAt));
      if (Math.max(...previousOutcomes) >= Math.min(...currentCutoffs)) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Model partitions must be chronological and non-overlapping.',
        });
        break;
      }
    }
  });

export const aflTradePlayerObservationSetSchema = z
  .object({
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    content: aflTradePlayerObservationSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'player-observation-set',
      set.observationSetId,
      set.content,
      context,
      ['observationSetId']
    );
  });

export const aflTradePlayerBaselineConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-baseline-config/v1'),
    replacementQuantile: z.number().finite().gt(0).lte(0.5),
    minimumGamesForReplacementFit: z.number().int().positive().max(30),
    minimumTrainingObservationsPerGroup: z.number().int().positive().max(10_000),
    weighting: z.literal('games_played'),
    replacementStratification: z.literal('role_and_era'),
    unavailableAndZeroTreatment: z.literal('distinct'),
    activeCareerTreatment: z.literal('right_censored'),
  })
  .strict();

const replacementLevelSchema = z
  .object({
    role: publicIdSchema,
    era: publicIdSchema,
    eligibleTrainingObservations: z.number().int().positive(),
    totalGamesWeight: z.number().int().positive(),
    replacementContributionPerGame: finiteNumberSchema,
  })
  .strict();

const scoredObservationSchema = z
  .object({
    observationId: publicIdSchema,
    playerId: publicIdSchema,
    season: z.number().int().min(1897).max(2100),
    partition: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    role: publicIdSchema,
    era: publicIdSchema,
    gamesPlayed: z.number().int().positive().max(30),
    gamesAvailable: z.number().int().positive().max(30),
    observedContribution: finiteNumberSchema,
    observedContributionPerGame: finiteNumberSchema,
    replacementContributionPerGame: finiteNumberSchema,
    impactAboveReplacementPerGame: finiteNumberSchema,
    availabilityRate: z.number().finite().min(0).max(1),
    observedContributionAboveReplacement: finiteNumberSchema,
    careerTreatment: z.enum(['completed', 'right_censored']),
  })
  .strict()
  .superRefine((score, context) => {
    const tolerance = 1e-9;
    const expectedPerGame = score.observedContribution / score.gamesPlayed;
    const expectedImpact = expectedPerGame - score.replacementContributionPerGame;
    const expectedAvailability = score.gamesPlayed / score.gamesAvailable;
    const expectedTotal = expectedImpact * score.gamesPlayed;
    if (
      Math.abs(score.observedContributionPerGame - expectedPerGame) > tolerance ||
      Math.abs(score.impactAboveReplacementPerGame - expectedImpact) > tolerance ||
      Math.abs(score.availabilityRate - expectedAvailability) > tolerance ||
      Math.abs(score.observedContributionAboveReplacement - expectedTotal) > tolerance
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scored observation arithmetic must reconcile exactly within tolerance.',
      });
    }
  });

const unscoredObservationSchema = z
  .object({
    observationId: publicIdSchema,
    reason: z.enum(['contribution_unavailable', 'zero_games', 'unsupported_role_era']),
  })
  .strict();

export const aflTradePlayerBaselineFitContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-baseline-fit/v1'),
    modelKind: z.literal('player_contribution_and_availability'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    valueUnitId: publicIdSchema,
    config: aflTradePlayerBaselineConfigSchema,
    inputObservationIds: z.array(publicIdSchema).min(4).max(100_000),
    replacementLevels: z.array(replacementLevelSchema).max(10_000),
    scores: z.array(scoredObservationSchema).max(100_000),
    unscored: z.array(unscoredObservationSchema).max(100_000),
    diagnostics: z
      .object({
        eligibleTrainingObservations: z.number().int().nonnegative(),
        supportedRoleEraGroups: z.number().int().nonnegative(),
        unsupportedRoleEraGroups: z.number().int().nonnegative(),
        scoredObservations: z.number().int().nonnegative(),
        unscoredObservations: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((fit, context) => {
    const inputIds = fit.inputObservationIds;
    const outputIds = [
      ...fit.scores.map((score) => score.observationId),
      ...fit.unscored.map((observation) => observation.observationId),
    ];
    if (
      new Set(inputIds).size !== inputIds.length ||
      new Set(outputIds).size !== outputIds.length ||
      inputIds.length !== outputIds.length ||
      inputIds.some((id) => !outputIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['inputObservationIds'],
        message: 'Every input observation must reconcile to exactly one scored or unscored result.',
      });
    }
    const groupKeys = fit.replacementLevels.map((level) => `${level.role}:${level.era}`);
    if (new Set(groupKeys).size !== groupKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['replacementLevels'],
        message: 'Replacement levels must be unique by role and era.',
      });
    }
    if (
      fit.diagnostics.supportedRoleEraGroups !== fit.replacementLevels.length ||
      fit.diagnostics.scoredObservations !== fit.scores.length ||
      fit.diagnostics.unscoredObservations !== fit.unscored.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: 'Baseline diagnostics must reconcile to the fitted output.',
      });
    }
  });

export const aflTradePlayerBaselineFitSchema = z
  .object({
    baselineFitId: aflTradeContentAddressedIdSchema('player-baseline-fit'),
    content: aflTradePlayerBaselineFitContentSchema,
  })
  .strict()
  .superRefine((fit, context) => {
    addAflTradeContentAddressIssue('player-baseline-fit', fit.baselineFitId, fit.content, context, [
      'baselineFitId',
    ]);
  });

export type AflTradePlayerSeasonObservation = z.infer<typeof aflTradePlayerSeasonObservationSchema>;
export type AflTradePlayerObservationSetContent = z.infer<
  typeof aflTradePlayerObservationSetContentSchema
>;
export type AflTradePlayerObservationSet = z.infer<typeof aflTradePlayerObservationSetSchema>;
export type AflTradePlayerBaselineConfig = z.infer<typeof aflTradePlayerBaselineConfigSchema>;
export type AflTradePlayerBaselineFit = z.infer<typeof aflTradePlayerBaselineFitSchema>;

export function createAflTradePlayerObservationSet(
  unparsedContent: AflTradePlayerObservationSetContent
): AflTradePlayerObservationSet {
  const content = aflTradePlayerObservationSetContentSchema.parse(unparsedContent);
  return aflTradePlayerObservationSetSchema.parse({
    observationSetId: createAflTradeContentAddress('player-observation-set', content),
    content,
  });
}
