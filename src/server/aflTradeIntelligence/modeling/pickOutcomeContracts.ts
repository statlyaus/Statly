import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
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
  'midseason',
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

export const AFL_TRADE_PICK_PAV_POLICY_SCHEMA_VERSION = 'afl-trade-pick-pav-policy/v1' as const;
export const AFL_TRADE_PICK_PAV_OBSERVATION_SET_SCHEMA_VERSION =
  'afl-trade-pick-pav-observation-set/v1' as const;
export const AFL_TRADE_PICK_PAV_AUTHORITY_BOUNDARY =
  'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership' as const;

const shaReferenceSchema = (prefix: string) =>
  z
    .object({ id: aflTradeContentAddressedIdSchema(prefix), sha256: aflTradeSha256Schema })
    .strict()
    .superRefine((reference, context) => {
      if (reference.id !== `${prefix}:${reference.sha256}`) {
        context.addIssue({
          code: 'custom',
          path: ['id'],
          message: `${prefix} identity must equal its exact content digest.`,
        });
      }
    });

const pickPavPartitionSchema = z
  .object({
    role: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    fromDraftYear: z.number().int().min(1897).max(2200),
    throughDraftYear: z.number().int().min(1897).max(2200),
  })
  .strict();

const pickPavCategoryMinimumsSchema = z
  .object({
    replacementLevel: finiteNumberSchema.positive(),
    regularContributor: finiteNumberSchema.positive(),
    highQuality: finiteNumberSchema.positive(),
    elite: finiteNumberSchema.positive(),
  })
  .strict()
  .superRefine((minimums, context) => {
    const values = [
      minimums.replacementLevel,
      minimums.regularContributor,
      minimums.highQuality,
      minimums.elite,
    ];
    if (values.some((value, index) => index > 0 && value <= values[index - 1]!)) {
      context.addIssue({
        code: 'custom',
        message: 'Pick-outcome PAV category minimums must be strictly increasing.',
      });
    }
  });

const pickPavPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PICK_PAV_POLICY_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PICK_PAV_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    policyVersion: publicIdSchema,
    supportedPathway: z.literal('national'),
    supportedAccess: z.literal('open'),
    firstOutcomeSeasonOffset: z.literal(1),
    fixedHorizonSeasons: z.number().int().min(1).max(15),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    sourceValueUnit: z.literal('season_pav'),
    outcomeValueUnit: z.literal('fixed_horizon_pav'),
    categoryMinimums: pickPavCategoryMinimumsSchema,
    partitions: z.array(pickPavPartitionSchema).length(AFL_TRADE_MODEL_PARTITIONS.length),
    approvalDecision: shaReferenceSchema('review-decision'),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.partitions.some(
        (partition, index) =>
          partition.role !== AFL_TRADE_MODEL_PARTITIONS[index] ||
          partition.throughDraftYear < partition.fromDraftYear ||
          (index > 0 && partition.fromDraftYear <= policy.partitions[index - 1]!.throughDraftYear)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['partitions'],
        message: 'Pick-outcome partitions must be ordered, disjoint whole-draft-year ranges.',
      });
    }
  });

export const aflTradePickPavPolicySchema = z
  .object({
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    content: pickPavPolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue('pick-pav-policy', policy.policyId, policy.content, context, [
      'policyId',
    ]);
  });

const selectionAccessSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('open'),
      decision: shaReferenceSchema('review-decision'),
      recordedAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('restricted'),
      restriction: z.enum(['father_son_bid_match', 'academy_bid_match', 'other_restricted']),
      bidSelectionNumber: z.number().int().positive().max(500).nullable(),
      decision: shaReferenceSchema('review-decision'),
      recordedAt: isoDateTimeSchema,
    })
    .strict(),
  z.object({ state: z.literal('unresolved'), reason: publicIdSchema }).strict(),
]);

const releasedDraftSelectionSchema = z
  .object({
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    selectionId: aflTradeContentAddressedIdSchema('draft-selection'),
    eventId: publicIdSchema,
    eventVersionId: aflTradeContentAddressedIdSchema('event-version'),
    eventDate: z.iso.date(),
    recordedAt: isoDateTimeSchema,
    draftYear: z.number().int().min(1897).max(2200),
    pathway: z.enum(AFL_TRADE_DRAFT_PATHWAYS),
    actualSelectionNumber: z.number().int().positive().max(500),
    nominalSelectionNumber: z.number().int().positive().max(500).nullable(),
    draftRound: z.number().int().positive().max(30).nullable(),
    pickId: publicIdSchema,
    playerId: publicIdSchema,
    clubId: publicIdSchema,
    access: selectionAccessSchema,
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.eventDate.slice(0, 4) !== String(selection.draftYear)) {
      context.addIssue({
        code: 'custom',
        path: ['draftYear'],
        message: 'Draft selection year must match the released draft event date.',
      });
    }
    if (
      selection.access.state !== 'unresolved' &&
      Date.parse(selection.access.recordedAt) < Date.parse(selection.recordedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['access', 'recordedAt'],
        message: 'Selection access classification cannot predate the canonical selection.',
      });
    }
  });

const pickPavPlayerValueSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    calculationSha256: aflTradeSha256Schema,
    seasonYear: z.number().int().min(1998).max(2200),
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    playerId: publicIdSchema,
    playerSha256: aflTradeSha256Schema,
    clubId: publicIdSchema,
    sourceRowIds: z.array(publicIdSchema).min(1).max(1_000),
    gamesPlayed: z.number().int().positive().max(30),
    totalPav: finiteNumberSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.calculationId !== `hpn-pav-season:${value.calculationSha256}` ||
      value.gamesPlayed !== value.sourceRowIds.length ||
      new Set(value.sourceRowIds).size !== value.sourceRowIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pick PAV player values must bind one exact calculation and unique game rows.',
      });
    }
  });

const pickPavCalculationMembershipSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    calculationSha256: aflTradeSha256Schema,
    inputSetId: aflTradeContentAddressedIdSchema('hpn-pav-input-set'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    seasonYear: z.number().int().min(1998).max(2200),
    effectiveThrough: isoDateTimeSchema,
    calculatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((membership, context) => {
    if (membership.calculationId !== `hpn-pav-season:${membership.calculationSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['calculationId'],
        message: 'PAV calculation identity must equal its exact digest.',
      });
    }
  });

const observedPickPavOutcomeSchema = z
  .object({
    state: z.literal('mature_observed'),
    contribution: finiteNumberSchema,
    gamesPlayed: z.number().int().nonnegative().max(500),
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
  })
  .strict();

const censoredPickPavOutcomeSchema = z
  .object({
    state: z.literal('right_censored'),
    contributionObservedToDate: finiteNumberSchema,
    gamesObservedToDate: z.number().int().nonnegative().max(500),
    censoredAt: isoDateTimeSchema,
  })
  .strict();

const unavailablePickPavOutcomeSchema = z
  .object({
    state: z.literal('unavailable'),
    reason: z.enum([
      'selection_access_unresolved',
      'restricted_access',
      'pathway_unsupported',
      'horizon_calculation_missing',
      'player_identity_unresolved',
      'pick_lineage_unresolved',
    ]),
  })
  .strict();

export const aflTradePickPavObservationSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
    ordinal: z.number().int().positive().max(100_000),
    partition: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    predictionCutoffAt: isoDateTimeSchema,
    outcomeHorizonEndsAt: isoDateTimeSchema,
    outcomeObservedAt: isoDateTimeSchema,
    selection: releasedDraftSelectionSchema,
    requiredCalculationSeasons: z.array(z.number().int().min(1998).max(2200)).min(1).max(15),
    calculationIds: z.array(aflTradeContentAddressedIdSchema('hpn-pav-season')).max(15),
    playerValues: z.array(pickPavPlayerValueSchema).max(100),
    outcome: z.discriminatedUnion('state', [
      observedPickPavOutcomeSchema,
      censoredPickPavOutcomeSchema,
      unavailablePickPavOutcomeSchema,
    ]),
  })
  .strict()
  .superRefine((observation, context) => {
    const { observationId, ...content } = observation;
    addAflTradeContentAddressIssue('pick-pav-observation', observationId, content, context, [
      'observationId',
    ]);
    if (
      observation.requiredCalculationSeasons.some(
        (season, index) =>
          index > 0 && season !== observation.requiredCalculationSeasons[index - 1]! + 1
      ) ||
      new Set(observation.calculationIds).size !== observation.calculationIds.length ||
      observation.playerValues.some(
        (value) =>
          !observation.calculationIds.includes(value.calculationId) ||
          value.playerId !== observation.selection.playerId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculationIds'],
        message: 'Observation calculation evidence must be unique and inside its fixed horizon.',
      });
    }
    const contribution = observation.playerValues.reduce((sum, value) => sum + value.totalPav, 0);
    const games = observation.playerValues.reduce((sum, value) => sum + value.gamesPlayed, 0);
    const expectedPredictionCutoff = `${observation.selection.eventDate}T23:59:59.999Z`;
    if (
      observation.predictionCutoffAt !== expectedPredictionCutoff ||
      Date.parse(observation.outcomeHorizonEndsAt) <= Date.parse(observation.predictionCutoffAt) ||
      Date.parse(observation.outcomeObservedAt) <= Date.parse(observation.predictionCutoffAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['predictionCutoffAt'],
        message: 'Pick prediction, outcome horizon, and knowledge chronology is invalid.',
      });
    }
    if (
      observation.outcome.state === 'mature_observed' &&
      (observation.calculationIds.length !== observation.requiredCalculationSeasons.length ||
        Math.abs(observation.outcome.contribution - contribution) > 1e-9 ||
        observation.outcome.gamesPlayed !== games)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Mature pick outcomes must exactly sum the complete fixed-horizon PAV evidence.',
      });
    }
    if (
      observation.outcome.state === 'right_censored' &&
      (observation.outcome.censoredAt !== observation.outcomeObservedAt ||
        Math.abs(observation.outcome.contributionObservedToDate - contribution) > 1e-9 ||
        observation.outcome.gamesObservedToDate !== games)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Censored pick outcomes must exactly sum evidence observed by the cutoff.',
      });
    }
  });

function pickPavObservationPreimages(
  observations: readonly z.infer<typeof aflTradePickPavObservationSchema>[]
) {
  return observations.map(({ observationId: _observationId, ...content }) => content);
}

const pickPavObservationSetContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PICK_PAV_OBSERVATION_SET_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PICK_PAV_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    createdAt: isoDateTimeSchema,
    knowledgeCutoffAt: isoDateTimeSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policy: aflTradePickPavPolicySchema,
    calculations: z.array(pickPavCalculationMembershipSchema).max(500),
    draftClasses: z
      .array(
        z
          .object({
            draftYear: z.number().int().min(1897).max(2200),
            pathway: z.enum(AFL_TRADE_DRAFT_PATHWAYS),
            expectedSelectionCount: z.number().int().positive().max(500),
            observationCount: z.number().int().positive().max(500),
          })
          .strict()
      )
      .min(4)
      .max(500),
    observations: z.array(aflTradePickPavObservationSchema).min(4).max(100_000),
    observationCount: z.number().int().positive().max(100_000),
    observationSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((set, context) => {
    if (
      set.environment !== set.policy.content.environment ||
      set.competition !== set.policy.content.competition ||
      Date.parse(set.knowledgeCutoffAt) > Date.parse(set.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pick-outcome set must match policy scope and cannot use a future cutoff.',
      });
    }
    const calculations = [...set.calculations].sort(
      (left, right) =>
        left.seasonYear - right.seasonYear || left.calculationId.localeCompare(right.calculationId)
    );
    const observations = [...set.observations].sort((left, right) =>
      left.selection.selectionId.localeCompare(right.selection.selectionId)
    );
    if (
      calculations.some(
        (value, index) => value.calculationId !== set.calculations[index]?.calculationId
      ) ||
      new Set(calculations.map(({ seasonYear }) => seasonYear)).size !== calculations.length ||
      observations.some(
        (value, index) =>
          value.observationId !== set.observations[index]?.observationId ||
          value.ordinal !== index + 1
      ) ||
      set.observationCount !== observations.length ||
      set.observationSetSha256 !==
        sha256AflTradeCanonicalJson(pickPavObservationPreimages(observations))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Pick observations and calculations must be canonical, complete, and exactly sealed.',
      });
    }
    const observationCounts = new Map<string, number>();
    const calculationsById = new Map(
      set.calculations.map((calculation) => [calculation.calculationId, calculation])
    );
    const methodIds = new Set(set.calculations.map(({ methodId }) => methodId));
    if (
      methodIds.size > 1 ||
      [...methodIds].some((methodId) => methodId !== set.policy.content.methodId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculations'],
        message: 'One pick observation set must use one exact PAV method.',
      });
    }
    for (const observation of observations) {
      if (observation.selection.releaseId !== set.releaseId) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Every pick observation must belong to the exact factual release.',
        });
        break;
      }
      const partition = set.policy.content.partitions.find(
        ({ role }) => role === observation.partition
      );
      const calculationSeasons = observation.calculationIds.map(
        (calculationId) => calculationsById.get(calculationId)?.seasonYear
      );
      const expectedCalculationSeasons = Array.from(
        { length: set.policy.content.fixedHorizonSeasons },
        (_, index) =>
          observation.selection.draftYear + set.policy.content.firstOutcomeSeasonOffset + index
      );
      const selectedCalculations = observation.calculationIds.map((calculationId) =>
        calculationsById.get(calculationId)
      );
      const playerValueKeys = observation.playerValues.map(
        ({ calculationId, spellVersionId }) => `${calculationId}|${spellVersionId}`
      );
      const outcomeCategory =
        observation.outcome.state === 'mature_observed'
          ? categoryForAflTradePickPav(
              observation.outcome.contribution,
              observation.outcome.gamesPlayed,
              set.policy.content.categoryMinimums
            )
          : null;
      const expectedUnavailableReason =
        observation.selection.pathway !== set.policy.content.supportedPathway
          ? 'pathway_unsupported'
          : observation.selection.access.state === 'unresolved'
            ? 'selection_access_unresolved'
            : observation.selection.access.state === 'restricted'
              ? 'restricted_access'
              : null;
      if (
        !partition ||
        observation.selection.draftYear < partition.fromDraftYear ||
        observation.selection.draftYear > partition.throughDraftYear ||
        calculationSeasons.some((season) => season === undefined) ||
        observation.requiredCalculationSeasons.length !== expectedCalculationSeasons.length ||
        observation.requiredCalculationSeasons.some(
          (season, index) => season !== expectedCalculationSeasons[index]
        ) ||
        calculationSeasons.some(
          (season, index) => season !== observation.requiredCalculationSeasons[index]
        ) ||
        new Set(playerValueKeys).size !== playerValueKeys.length ||
        observation.playerValues.some((value) => {
          const calculation = calculationsById.get(value.calculationId);
          return (
            value.playerId !== observation.selection.playerId ||
            calculation === undefined ||
            value.calculationSha256 !== calculation.calculationSha256 ||
            value.seasonYear !== calculation.seasonYear
          );
        }) ||
        selectedCalculations.some(
          (calculation) =>
            calculation === undefined ||
            Date.parse(calculation.calculatedAt) > Date.parse(observation.outcomeObservedAt)
        ) ||
        Date.parse(observation.outcomeObservedAt) > Date.parse(set.knowledgeCutoffAt) ||
        Date.parse(observation.selection.recordedAt) > Date.parse(set.knowledgeCutoffAt) ||
        (observation.selection.access.state !== 'unresolved' &&
          Date.parse(observation.selection.access.recordedAt) >
            Date.parse(set.knowledgeCutoffAt)) ||
        (expectedUnavailableReason !== null &&
          (observation.outcome.state !== 'unavailable' ||
            observation.outcome.reason !== expectedUnavailableReason)) ||
        (expectedUnavailableReason === null &&
          observation.outcome.state === 'unavailable' &&
          ![
            'horizon_calculation_missing',
            'player_identity_unresolved',
            'pick_lineage_unresolved',
          ].includes(observation.outcome.reason)) ||
        (observation.outcome.state === 'mature_observed' &&
          observation.outcome.category !== outcomeCategory)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message:
            'Pick observation partition, authority state, calculations, category, or cutoff does not match policy.',
        });
        break;
      }
      const key = `${observation.selection.draftYear}|${observation.selection.pathway}`;
      observationCounts.set(key, (observationCounts.get(key) ?? 0) + 1);
    }
    for (let index = 1; index < AFL_TRADE_MODEL_PARTITIONS.length; index += 1) {
      const previousPartition = AFL_TRADE_MODEL_PARTITIONS[index - 1]!;
      const currentPartition = AFL_TRADE_MODEL_PARTITIONS[index]!;
      const previousHorizons = observations
        .filter(({ partition }) => partition === previousPartition)
        .map(({ outcomeHorizonEndsAt }) => Date.parse(outcomeHorizonEndsAt));
      const currentPredictionCutoffs = observations
        .filter(({ partition }) => partition === currentPartition)
        .map(({ predictionCutoffAt }) => Date.parse(predictionCutoffAt));
      if (
        previousHorizons.length === 0 ||
        currentPredictionCutoffs.length === 0 ||
        Math.max(...previousHorizons) >= Math.min(...currentPredictionCutoffs)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message:
            'Whole draft-class partitions must be chronological and label-purged by fixed-horizon valid time.',
        });
        break;
      }
    }
    if (
      set.draftClasses.some(
        (draftClass, index) =>
          index > 0 &&
          `${draftClass.draftYear}|${draftClass.pathway}` <=
            `${set.draftClasses[index - 1]!.draftYear}|${set.draftClasses[index - 1]!.pathway}`
      ) ||
      set.draftClasses.some(
        (draftClass) =>
          draftClass.observationCount !==
            observationCounts.get(`${draftClass.draftYear}|${draftClass.pathway}`) ||
          draftClass.expectedSelectionCount !== draftClass.observationCount
      ) ||
      observationCounts.size !== set.draftClasses.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['draftClasses'],
        message: 'Whole released draft classes must reconcile exactly with observation membership.',
      });
    }
    if (
      set.calculations.some(
        (calculation) =>
          Date.parse(calculation.calculatedAt) > Date.parse(set.knowledgeCutoffAt) ||
          Date.parse(calculation.effectiveThrough) > Date.parse(set.knowledgeCutoffAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculations'],
        message: 'PAV calculation evidence must exist by the observation-set cutoff.',
      });
    }
  });

export const aflTradePickPavObservationSetSchema = z
  .object({
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    content: pickPavObservationSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-observation-set',
      set.observationSetId,
      set.content,
      context,
      ['observationSetId']
    );
  });

export type AflTradePickPavPolicy = z.infer<typeof aflTradePickPavPolicySchema>;
export type AflTradePickPavObservation = z.infer<typeof aflTradePickPavObservationSchema>;
export type AflTradePickPavObservationSet = z.infer<typeof aflTradePickPavObservationSetSchema>;

export function createAflTradePickPavPolicy(
  content: z.input<typeof pickPavPolicyContentSchema>
): AflTradePickPavPolicy {
  const parsed = pickPavPolicyContentSchema.parse(content);
  return aflTradePickPavPolicySchema.parse({
    policyId: createAflTradeContentAddress('pick-pav-policy', parsed),
    content: parsed,
  });
}

export function categoryForAflTradePickPav(
  contribution: number,
  gamesPlayed: number,
  minimums: z.infer<typeof pickPavCategoryMinimumsSchema>
): (typeof AFL_TRADE_PICK_OUTCOME_CATEGORIES)[number] {
  if (gamesPlayed === 0) return 'no_afl_game';
  if (contribution < minimums.replacementLevel) return 'short_career';
  if (contribution < minimums.regularContributor) return 'replacement_level';
  if (contribution < minimums.highQuality) return 'regular_contributor';
  if (contribution < minimums.elite) return 'high_quality';
  return 'elite';
}

export function createAflTradePickPavObservation(
  content: Omit<z.input<typeof aflTradePickPavObservationSchema>, 'observationId'>
): AflTradePickPavObservation {
  return aflTradePickPavObservationSchema.parse({
    observationId: createAflTradeContentAddress('pick-pav-observation', content),
    ...content,
  });
}

export function createAflTradePickPavObservationSet(
  input: z.input<typeof pickPavObservationSetContentSchema>
): AflTradePickPavObservationSet {
  const calculations = [...input.calculations].sort(
    (left, right) =>
      left.seasonYear - right.seasonYear || left.calculationId.localeCompare(right.calculationId)
  );
  const observations = [...input.observations]
    .sort((left, right) => left.selection.selectionId.localeCompare(right.selection.selectionId))
    .map((observation, index) => {
      const { observationId: _observationId, ordinal: _ordinal, ...content } = observation;
      return createAflTradePickPavObservation({ ...content, ordinal: index + 1 });
    });
  const content = pickPavObservationSetContentSchema.parse({
    ...input,
    calculations,
    observations,
    observationCount: observations.length,
    observationSetSha256: sha256AflTradeCanonicalJson(pickPavObservationPreimages(observations)),
  });
  return aflTradePickPavObservationSetSchema.parse({
    observationSetId: createAflTradeContentAddress('pick-pav-observation-set', content),
    content,
  });
}
