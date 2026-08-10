import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const isoInstantSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_DEVELOPMENT_GRADE_PROVIDERS = [
  'afl_tables',
  'footywire',
  'fryzigg',
] as const;

const observedMetricSchema = z
  .object({ state: z.literal('observed'), value: z.number().finite().nonnegative() })
  .strict();
const partialMetricSchema = z
  .object({
    state: z.literal('partial'),
    observedValue: z.number().finite().nonnegative(),
    reason: z.literal('active_career_right_censored'),
  })
  .strict();
const unavailableMetricSchema = z
  .object({
    state: z.literal('unavailable'),
    reason: z.enum(['source_missing', 'definition_unsupported', 'identity_unresolved']),
  })
  .strict();
const outcomeMetricSchema = z.discriminatedUnion('state', [
  observedMetricSchema,
  partialMetricSchema,
  unavailableMetricSchema,
]);

const outcomeSchema = z
  .object({
    games: outcomeMetricSchema,
    goals: outcomeMetricSchema,
    coachesVotes: outcomeMetricSchema,
    brownlowVotes: outcomeMetricSchema,
  })
  .strict();

const resolvedPlayerSchema = z
  .object({
    identityState: z.literal('resolved'),
    playerId: publicIdSchema,
    playerName: z.string().trim().min(1).max(160),
  })
  .strict();
const unresolvedPlayerSchema = z
  .object({
    identityState: z.literal('unresolved'),
    playerId: z.null(),
    playerName: z.string().trim().min(1).max(160),
  })
  .strict();
const playerSchema = z.discriminatedUnion('identityState', [
  resolvedPlayerSchema,
  unresolvedPlayerSchema,
]);

const acquisitionSchema = z
  .object({
    acquisitionId: publicIdSchema,
    effectiveAt: isoInstantSchema,
    outcomeMaturedAt: isoInstantSchema,
    outcomeObservedAt: isoInstantSchema,
    seasonYear: z.number().int().min(1897).max(2100),
    mechanism: z.enum([
      'national_draft',
      'rookie_draft',
      'mid_season_draft',
      'pre_season_draft',
      'mini_draft',
      'trade',
      'free_agency',
      'pre_draft',
      'post_draft',
      'training_squad_selection',
    ]),
    receivingClubId: publicIdSchema,
    player: playerSchema,
    selection: z
      .object({
        nominalNumber: z.number().int().positive().max(500).nullable(),
        actualNumber: z.number().int().positive().max(500).nullable(),
        round: z.number().int().positive().max(30).nullable(),
        originalClubId: publicIdSchema.nullable(),
      })
      .strict(),
    atTrade: z
      .object({
        age: z.number().finite().min(15).max(60).nullable(),
        heightCm: z.number().int().min(100).max(250).nullable(),
        weightKg: z.number().int().min(30).max(200).nullable(),
      })
      .strict(),
    outcome: outcomeSchema,
  })
  .strict()
  .superRefine((acquisition, context) => {
    const effectiveAt = Date.parse(acquisition.effectiveAt);
    const maturedAt = Date.parse(acquisition.outcomeMaturedAt);
    const observedAt = Date.parse(acquisition.outcomeObservedAt);
    if (maturedAt <= effectiveAt) {
      context.addIssue({
        code: 'custom',
        path: ['outcomeMaturedAt'],
        message: 'Outcome maturity must follow acquisition.',
      });
    }
    if (observedAt < maturedAt) {
      const outcomes = Object.values(acquisition.outcome);
      if (
        outcomes.some(({ state }) => state === 'observed') ||
        !outcomes.some(({ state }) => state === 'partial')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['outcome'],
          message:
            'Pre-maturity outcomes must remain explicitly partial or unavailable and include right-censoring evidence.',
        });
      }
    }
    if (new Date(acquisition.effectiveAt).getUTCFullYear() !== acquisition.seasonYear) {
      context.addIssue({
        code: 'custom',
        path: ['seasonYear'],
        message: 'Acquisition season must equal the effective-at year.',
      });
    }
  });

const providerSeasonSchema = z
  .object({
    observationId: publicIdSchema,
    playerId: publicIdSchema,
    seasonYear: z.number().int().min(1897).max(2100),
    knownAt: isoInstantSchema,
    state: z.enum(['reconciled', 'conflicting']),
    sourceProviders: z.array(z.enum(AFL_TRADE_DEVELOPMENT_GRADE_PROVIDERS)).min(1).max(3),
    stats: z
      .object({
        games: z.number().finite().nonnegative(),
        goals: z.number().finite().nonnegative(),
        coachesVotes: z.number().finite().nonnegative(),
        brownlowVotes: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (new Set(observation.sourceProviders).size !== observation.sourceProviders.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceProviders'],
        message: 'A provider may contribute at most once to one reconciled season.',
      });
    }
  });

const datasetInputSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-development-grade-dataset-input/v1'),
    environment: z.enum(['test_fixture', 'development']),
    createdAt: isoInstantSchema,
    sourceBoundary: z.literal('pinned_workbook_and_reconciled_fitzroy_no_fantasy_ownership'),
    fixedOutcomeHorizonSeasons: z.number().int().positive().max(15),
    acquisitions: z.array(acquisitionSchema).min(1).max(100_000),
    providerSeasons: z.array(providerSeasonSchema).max(500_000),
  })
  .strict()
  .superRefine((input, context) => {
    const acquisitionIds = input.acquisitions.map(({ acquisitionId }) => acquisitionId);
    const observationIds = input.providerSeasons.map(({ observationId }) => observationId);
    if (new Set(acquisitionIds).size !== acquisitionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['acquisitions'],
        message: 'Acquisition identifiers must be unique.',
      });
    }
    if (new Set(observationIds).size !== observationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['providerSeasons'],
        message: 'Provider observation identifiers must be unique.',
      });
    }
    const createdAt = Date.parse(input.createdAt);
    input.acquisitions.forEach((acquisition, index) => {
      if (Date.parse(acquisition.outcomeObservedAt) > createdAt) {
        context.addIssue({
          code: 'custom',
          path: ['acquisitions', index, 'outcomeObservedAt'],
          message: 'Dataset creation cannot predate an admitted outcome observation.',
        });
      }
      const expectedMaturityYear = acquisition.seasonYear + input.fixedOutcomeHorizonSeasons;
      if (new Date(acquisition.outcomeMaturedAt).getUTCFullYear() !== expectedMaturityYear) {
        context.addIssue({
          code: 'custom',
          path: ['acquisitions', index, 'outcomeMaturedAt'],
          message: 'Outcome maturity must match the configured fixed season horizon.',
        });
      }
    });
    input.providerSeasons.forEach((observation, index) => {
      if (Date.parse(observation.knownAt) > createdAt) {
        context.addIssue({
          code: 'custom',
          path: ['providerSeasons', index, 'knownAt'],
          message: 'Dataset creation cannot predate a provider observation.',
        });
      }
    });
  });

const eligibleSchema = z
  .object({ state: z.literal('eligible'), reasons: z.array(z.never()).max(0) })
  .strict();
const unavailableEligibilitySchema = z
  .object({
    state: z.enum(['insufficient_data', 'identity_unresolved']),
    reasons: z
      .array(
        z.enum(['no_reconciled_pretrade_provider_history', 'canonical_player_identity_unresolved'])
      )
      .min(1)
      .max(2),
  })
  .strict();
const eligibilitySchema = z.union([eligibleSchema, unavailableEligibilitySchema]);

const datasetRowSchema = acquisitionSchema
  .extend({
    atTradeProviderObservationIds: z.array(publicIdSchema).max(100),
    eligibility: eligibilitySchema,
  })
  .strict();

export const aflTradeDevelopmentGradeDatasetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-development-grade-dataset/v1'),
    environment: z.enum(['test_fixture', 'development']),
    createdAt: isoInstantSchema,
    sourceBoundary: z.literal('pinned_workbook_and_reconciled_fitzroy_no_fantasy_ownership'),
    fixedOutcomeHorizonSeasons: z.number().int().positive().max(15),
    contributingProviders: z.array(z.enum(AFL_TRADE_DEVELOPMENT_GRADE_PROVIDERS)).max(3),
    providerSeasons: z.array(providerSeasonSchema).max(500_000),
    rows: z.array(datasetRowSchema).min(1).max(100_000),
    prohibitedSourceFields: z.tuple([
      z.literal('grade'),
      z.literal('expected'),
      z.literal('actual'),
    ]),
    publicationEligible: z.literal(false),
  })
  .strict();

export const aflTradeDevelopmentGradeDatasetSchema = z
  .object({
    datasetId: aflTradeContentAddressedIdSchema('development-grade-dataset'),
    content: aflTradeDevelopmentGradeDatasetContentSchema,
  })
  .strict()
  .superRefine((dataset, context) => {
    addAflTradeContentAddressIssue(
      'development-grade-dataset',
      dataset.datasetId,
      dataset.content,
      context,
      ['datasetId']
    );
  });

export type AflTradeDevelopmentGradeDataset = z.infer<typeof aflTradeDevelopmentGradeDatasetSchema>;
export type AflTradeDevelopmentGradeDatasetContent = z.infer<
  typeof aflTradeDevelopmentGradeDatasetContentSchema
>;

function eligibilityFor(
  acquisition: z.infer<typeof acquisitionSchema>,
  providerObservationIds: readonly string[]
): z.infer<typeof eligibilitySchema> {
  if (acquisition.player.identityState === 'unresolved') {
    return {
      state: 'identity_unresolved',
      reasons: ['canonical_player_identity_unresolved'],
    };
  }
  if (providerObservationIds.length === 0) {
    return {
      state: 'insufficient_data',
      reasons: ['no_reconciled_pretrade_provider_history'],
    };
  }
  return { state: 'eligible', reasons: [] };
}

export function createAflTradeDevelopmentGradeDataset(
  unparsedInput: unknown
): AflTradeDevelopmentGradeDataset {
  const input = datasetInputSchema.parse(unparsedInput);
  const providerSeasons = input.providerSeasons
    .map((observation) => ({
      ...observation,
      sourceProviders: [...observation.sourceProviders].sort(),
    }))
    .sort(
      (left, right) =>
        left.seasonYear - right.seasonYear || left.observationId.localeCompare(right.observationId)
    );
  const rows = input.acquisitions
    .map((acquisition) => {
      const playerId = acquisition.player.playerId;
      const atTradeProviderObservationIds =
        playerId === null
          ? []
          : providerSeasons
              .filter(
                (observation) =>
                  observation.state === 'reconciled' &&
                  observation.playerId === playerId &&
                  Date.parse(observation.knownAt) <= Date.parse(acquisition.effectiveAt)
              )
              .map(({ observationId }) => observationId);
      return {
        ...acquisition,
        atTradeProviderObservationIds,
        eligibility: eligibilityFor(acquisition, atTradeProviderObservationIds),
      };
    })
    .sort(
      (left, right) =>
        Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt) ||
        left.acquisitionId.localeCompare(right.acquisitionId)
    );
  const referencedObservationIds = new Set(
    rows.flatMap(({ atTradeProviderObservationIds }) => atTradeProviderObservationIds)
  );
  const contributingProviders = [
    ...new Set(
      providerSeasons
        .filter(({ observationId }) => referencedObservationIds.has(observationId))
        .flatMap(({ sourceProviders }) => sourceProviders)
    ),
  ].sort();
  const content = aflTradeDevelopmentGradeDatasetContentSchema.parse({
    schemaVersion: 'afl-trade-development-grade-dataset/v1',
    environment: input.environment,
    createdAt: input.createdAt,
    sourceBoundary: input.sourceBoundary,
    fixedOutcomeHorizonSeasons: input.fixedOutcomeHorizonSeasons,
    contributingProviders,
    providerSeasons,
    rows,
    prohibitedSourceFields: ['grade', 'expected', 'actual'],
    publicationEligible: false,
  });
  return aflTradeDevelopmentGradeDatasetSchema.parse({
    datasetId: createAflTradeContentAddress('development-grade-dataset', content),
    content,
  });
}

export function eligibleAflTradeHistoricalOutcomes(
  dataset: AflTradeDevelopmentGradeDataset,
  predictionCutoffAt: string
): AflTradeDevelopmentGradeDataset['content']['rows'] {
  const parsedDataset = aflTradeDevelopmentGradeDatasetSchema.parse(dataset);
  const cutoff = isoInstantSchema.parse(predictionCutoffAt);
  return parsedDataset.content.rows.filter(
    ({ outcomeMaturedAt }) => Date.parse(outcomeMaturedAt) < Date.parse(cutoff)
  );
}
