import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  type AflTradeValuationDatasetCandidate,
  aflTradeValuationDatasetCandidateSchema,
  factualInputSchema,
} from '../artifacts/valuationDatasetAdmissionContracts';
import {
  type AflTradeAcquisitionSpellMetric,
  aflTradeAcquisitionSpellMetricSchema,
} from '../outcomes/acquisitionSpellMetricContracts';

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

export const AFL_TRADE_PLAYER_OBSERVATION_SET_SCHEMA_VERSION_V2 =
  'afl-trade-player-observation-set/v2' as const;

const sourceNativeOutcomeMetricSchema = z
  .object({
    metricCode: z.enum(['games', 'goals', 'brownlow_votes', 'coaches_votes']),
    spellMetricVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-version'),
    factSha256: z.string().regex(/^[a-f0-9]{64}$/),
    headRevision: z.number().int().positive(),
    numericValue: z.string().regex(/^(0|[1-9]\d{0,19})$/),
    coverageNumerator: z.number().int().nonnegative(),
    coverageDenominator: z.number().int().nonnegative(),
    effectiveThrough: z.string().date(),
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.coverageNumerator > metric.coverageDenominator) {
      context.addIssue({
        code: 'custom',
        path: ['coverageNumerator'],
        message: 'Observed metric coverage cannot exceed the governed match universe.',
      });
    }
  });

export const aflTradeSourceNativePlayerOutcomeSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-source-native-player-outcome/v1'),
    grain: z.literal('player_acquisition_spell_prediction'),
    outcomeObservedAt: isoDateTimeSchema,
    metrics: z.array(sourceNativeOutcomeMetricSchema).length(4),
  })
  .strict()
  .superRefine((outcome, context) => {
    const requiredMetrics = ['brownlow_votes', 'coaches_votes', 'games', 'goals'];
    if (outcome.metrics.some(({ metricCode }, index) => metricCode !== requiredMetrics[index])) {
      context.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'The source-native outcome vector must contain the four exact sorted metrics.',
      });
    }
    if (
      outcome.metrics.some(
        ({ recordedAt }) => Date.parse(recordedAt) > Date.parse(outcome.outcomeObservedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcomeObservedAt'],
        message: 'The observation boundary cannot predate an authenticated metric record.',
      });
    }
  });

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
    acquisitionSpellId: publicIdSchema.optional(),
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
    const playerSeasonSubjects = set.observations.map(
      (observation) =>
        `${observation.playerId}:${observation.season}:${observation.acquisitionSpellId ?? ''}`
    );
    if (new Set(playerSeasonSubjects).size !== playerSeasonSubjects.length) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'A player or acquisition spell may have only one observation per season.',
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

const aflTradeAdmittedPlayerObservationContentSchema = z
  .object({
    datasetRowId: aflTradeContentAddressedIdSchema('valuation-dataset-row'),
    rowOrdinal: z.number().int().positive().max(1_000_000),
    rowKey: publicIdSchema,
    playerId: publicIdSchema,
    clubId: publicIdSchema,
    season: z.number().int().min(1897).max(2200),
    eventId: publicIdSchema,
    eventVersionId: publicIdSchema,
    acquisitionSpellId: publicIdSchema,
    acquisitionSpellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    partition: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    predictionCutoffAt: isoDateTimeSchema,
    featureKnownThrough: isoDateTimeSchema,
    targetFrom: isoDateTimeSchema,
    targetThrough: isoDateTimeSchema,
    featureInputs: z.array(factualInputSchema).min(1).max(1000),
    outcome: aflTradeSourceNativePlayerOutcomeSchema,
  })
  .strict();

export const aflTradeAdmittedPlayerObservationSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('player-observation'),
    ...aflTradeAdmittedPlayerObservationContentSchema.shape,
  })
  .strict()
  .superRefine((observation, context) => {
    const { observationId, ...content } = observation;
    addAflTradeContentAddressIssue('player-observation', observationId, content, context, [
      'observationId',
    ]);
    const featureIds = observation.featureInputs.map(({ memberId }) => memberId);
    if (
      new Set(featureIds).size !== featureIds.length ||
      featureIds.some((memberId, index) => index > 0 && featureIds[index - 1]! >= memberId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['featureInputs'],
        message: 'Admitted feature inputs must be unique and canonically ordered.',
      });
    }
    if (
      observation.featureInputs.some(
        ({ recordedAt, effectiveThrough }) =>
          Date.parse(recordedAt) > Date.parse(observation.featureKnownThrough) ||
          Date.parse(effectiveThrough) > Date.parse(observation.predictionCutoffAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['featureInputs'],
        message: 'Admitted feature inputs must be known and valid at the prediction cutoff.',
      });
    }
  });

export const aflTradePlayerObservationSetV2ContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PLAYER_OBSERVATION_SET_SCHEMA_VERSION_V2),
    publicIdentityBoundary: z.literal('source_native_no_fantasy_ownership'),
    authorityBoundary: z.literal(
      'deterministic_admitted_dataset_projection_no_fit_grade_publication_or_fantasy_ownership'
    ),
    publicationEligible: z.literal(false),
    observationGrain: z.literal('player_acquisition_spell_prediction'),
    outcomeVector: z.tuple([
      z.literal('brownlow_votes'),
      z.literal('coaches_votes'),
      z.literal('games'),
      z.literal('goals'),
    ]),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetRowSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    observations: z.array(aflTradeAdmittedPlayerObservationSchema).min(4).max(100_000),
  })
  .strict()
  .superRefine((set, context) => {
    const rowIds = set.observations.map(({ datasetRowId }) => datasetRowId);
    if (
      new Set(rowIds).size !== rowIds.length ||
      set.observations.some(({ rowOrdinal }, index) => rowOrdinal !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Admitted dataset rows must be unique and retain exact contiguous row order.',
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
      const previousOutcomes = set.observations
        .filter(({ partition }) => partition === previous)
        .map(({ outcome }) => Date.parse(outcome.outcomeObservedAt));
      const currentCutoffs = set.observations
        .filter(({ partition }) => partition === current)
        .map(({ predictionCutoffAt }) => Date.parse(predictionCutoffAt));
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

export const aflTradePlayerObservationSetV2Schema = z
  .object({
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    content: aflTradePlayerObservationSetV2ContentSchema,
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

export const aflTradeAnyPlayerObservationSetSchema = z.union([
  aflTradePlayerObservationSetSchema,
  aflTradePlayerObservationSetV2Schema,
]);

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
export type AflTradePlayerObservationSetV2 = z.infer<typeof aflTradePlayerObservationSetV2Schema>;
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

export function createAflTradePlayerObservationSetV2(input: {
  candidate: AflTradeValuationDatasetCandidate;
  datasetAdmissionId: string;
  modelProtocolId: string;
  spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
}): AflTradePlayerObservationSetV2 {
  const candidate = aflTradeValuationDatasetCandidateSchema.parse(input.candidate);
  const spellMetrics = input.spellMetrics.map((metric) =>
    aflTradeAcquisitionSpellMetricSchema.parse(metric)
  );
  const metricById = new Map(
    spellMetrics.map((metric) => [metric.spellMetricVersionId, metric] as const)
  );
  if (metricById.size !== spellMetrics.length) {
    throw new RangeError('Authenticated acquisition-spell metric facts must be unique.');
  }
  const requiredMetricIds = [
    ...new Set(
      candidate.content.rows.flatMap(({ content }) =>
        [...content.featureInputs, ...content.targetInputs].flatMap((input) =>
          input.kind === 'acquisition_spell_metric' ? [input.memberId] : []
        )
      )
    ),
  ].sort();
  const suppliedMetricIds = [...metricById.keys()].sort();
  if (
    requiredMetricIds.length !== suppliedMetricIds.length ||
    requiredMetricIds.some((metricId, index) => metricId !== suppliedMetricIds[index])
  ) {
    throw new RangeError(
      'Observation materialization requires the exact feature and target metric fact set.'
    );
  }
  const observations = candidate.content.rows.map((row) => {
    const featureMemberIds = new Set(row.content.featureInputs.map(({ memberId }) => memberId));
    const targets = row.content.targetInputs.flatMap((target) =>
      target.kind === 'acquisition_spell_metric' ? [target] : []
    );
    if (targets.some(({ memberId }) => featureMemberIds.has(memberId))) {
      throw new RangeError('A target factual member cannot be reused as an admitted feature.');
    }
    const metricMembers = new Map(targets.map((target) => [target.memberId, target] as const));
    const metrics = targets
      .map((target) => {
        const fact = metricById.get(target.memberId);
        if (
          !fact ||
          fact.factSha256 !== target.recordSha256 ||
          fact.content.availability.state !== 'complete' ||
          fact.content.spell.spellVersionId !== target.spellVersionId ||
          fact.content.spell.spellVersionId !== row.content.lineage.acquisitionSpellVersionId ||
          fact.content.spell.playerId !== target.playerId ||
          fact.content.spell.playerId !== row.content.identity.playerId ||
          fact.content.spell.clubId !== target.clubId ||
          fact.content.spell.clubId !== row.content.identity.clubId ||
          fact.content.rule.metricCode !== target.metricCode ||
          fact.content.effectiveThrough !== target.effectiveThrough ||
          fact.content.recordedAt !== target.recordedAt
        ) {
          throw new RangeError(
            'An acquisition-spell target does not match its exact authenticated metric fact.'
          );
        }
        return sourceNativeOutcomeMetricSchema.parse({
          metricCode: fact.content.rule.metricCode,
          spellMetricVersionId: fact.spellMetricVersionId,
          factSha256: fact.factSha256,
          headRevision: target.headRevision,
          numericValue: fact.content.availability.numericValue,
          coverageNumerator: fact.content.coverageNumerator,
          coverageDenominator: fact.content.coverageDenominator,
          effectiveThrough: fact.content.effectiveThrough,
          recordedAt: fact.content.recordedAt,
        });
      })
      .sort((left, right) => left.metricCode.localeCompare(right.metricCode));
    if (metrics.length !== 4 || metricMembers.size !== 4) {
      throw new RangeError('Every model observation requires four exact source-native metrics.');
    }
    const outcome = aflTradeSourceNativePlayerOutcomeSchema.parse({
      schemaVersion: 'afl-trade-source-native-player-outcome/v1',
      grain: 'player_acquisition_spell_prediction',
      outcomeObservedAt: metrics.reduce(
        (latest, metric) => (metric.recordedAt > latest ? metric.recordedAt : latest),
        metrics[0]!.recordedAt
      ),
      metrics,
    });
    if (Date.parse(outcome.outcomeObservedAt) < Date.parse(row.content.targetThrough)) {
      throw new RangeError('The authenticated outcome is not mature through the target window.');
    }
    const observationContent = aflTradeAdmittedPlayerObservationContentSchema.parse({
      datasetRowId: row.rowId,
      rowOrdinal: row.content.ordinal,
      rowKey: row.content.rowKey,
      playerId: row.content.identity.playerId,
      clubId: row.content.identity.clubId,
      season: row.content.seasonYear,
      eventId: row.content.lineage.eventId,
      eventVersionId: row.content.lineage.eventVersionId,
      acquisitionSpellId: row.content.lineage.acquisitionSpellId,
      acquisitionSpellVersionId: row.content.lineage.acquisitionSpellVersionId,
      partition: row.content.splitRole,
      predictionCutoffAt: row.content.predictionOriginAt,
      featureKnownThrough: row.content.featureKnownThrough,
      targetFrom: row.content.targetFrom,
      targetThrough: row.content.targetThrough,
      featureInputs: [...row.content.featureInputs].sort((left, right) =>
        left.memberId.localeCompare(right.memberId)
      ),
      outcome,
    });
    return aflTradeAdmittedPlayerObservationSchema.parse({
      observationId: createAflTradeContentAddress('player-observation', observationContent),
      ...observationContent,
    });
  });
  const content = aflTradePlayerObservationSetV2ContentSchema.parse({
    schemaVersion: AFL_TRADE_PLAYER_OBSERVATION_SET_SCHEMA_VERSION_V2,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    authorityBoundary:
      'deterministic_admitted_dataset_projection_no_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    observationGrain: 'player_acquisition_spell_prediction',
    outcomeVector: ['brownlow_votes', 'coaches_votes', 'games', 'goals'],
    datasetId: candidate.datasetId,
    datasetRowSetSha256: candidate.content.rowSetSha256,
    datasetAdmissionId: input.datasetAdmissionId,
    modelProtocolId: input.modelProtocolId,
    observations,
  });
  return aflTradePlayerObservationSetV2Schema.parse({
    observationSetId: createAflTradeContentAddress('player-observation-set', content),
    content,
  });
}
