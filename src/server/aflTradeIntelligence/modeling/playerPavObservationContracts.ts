import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { AFL_TRADE_MODEL_PARTITIONS } from './playerContributionContracts';

export const AFL_TRADE_PLAYER_PAV_POLICY_SCHEMA_VERSION =
  'afl-trade-player-pav-policy/v1' as const;
export const AFL_TRADE_PLAYER_PAV_OBSERVATION_SET_SCHEMA_VERSION =
  'afl-trade-player-pav-observation-set/v1' as const;
export const AFL_TRADE_PLAYER_PAV_AUTHORITY_BOUNDARY =
  'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership' as const;

const FLOAT_TOLERANCE = 1e-9;
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const finite = z.number().finite();
const publicId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const shaReference = (prefix: string) =>
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

const partitionSchema = z
  .object({
    role: z.enum(AFL_TRADE_MODEL_PARTITIONS),
    fromPredictionSeason: z.number().int().min(1998).max(2200),
    throughPredictionSeason: z.number().int().min(1998).max(2200),
  })
  .strict();

const policyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PLAYER_PAV_POLICY_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PLAYER_PAV_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    policyVersion: publicId,
    featureHistorySeasons: z.number().int().min(1).max(10),
    fixedHorizonSeasons: z.number().int().min(1).max(15),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    sourceValueUnit: z.literal('season_pav'),
    outcomeValueUnit: z.literal('fixed_horizon_pav'),
    partitions: z.array(partitionSchema).length(AFL_TRADE_MODEL_PARTITIONS.length),
    approvalDecision: shaReference('review-decision'),
    createdAt: instant,
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.partitions.some(
        (partition, index) =>
          partition.role !== AFL_TRADE_MODEL_PARTITIONS[index] ||
          partition.throughPredictionSeason < partition.fromPredictionSeason ||
          (index > 0 &&
            partition.fromPredictionSeason <=
              policy.partitions[index - 1]!.throughPredictionSeason)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['partitions'],
        message: 'Player-PAV partitions must be ordered, disjoint prediction-season ranges.',
      });
    }
  });

export const aflTradePlayerPavPolicySchema = z
  .object({
    policyId: aflTradeContentAddressedIdSchema('player-pav-policy'),
    content: policyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue('player-pav-policy', policy.policyId, policy.content, context, [
      'policyId',
    ]);
  });

const acquisitionSpellSchema = z
  .object({
    spellId: publicId,
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    clubId: publicId,
    effectiveFrom: date,
    effectiveThrough: date.nullable(),
    recordedAt: instant,
  })
  .strict()
  .superRefine((spell, context) => {
    if (
      spell.effectiveThrough !== null &&
      Date.parse(spell.effectiveThrough) < Date.parse(spell.effectiveFrom)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'An acquisition spell cannot end before it begins.',
      });
    }
  });

export const aflTradePlayerPavValueSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    calculationSha256: aflTradeSha256Schema,
    seasonYear: z.number().int().min(1998).max(2200),
    effectiveThrough: instant,
    calculatedAt: instant,
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    playerId: publicId,
    playerSha256: aflTradeSha256Schema,
    clubId: publicId,
    sourceRowIds: z.array(publicId).min(1).max(1_000),
    gamesPlayed: z.number().int().positive().max(30),
    offensivePav: finite,
    midfieldPav: finite,
    defensivePav: finite,
    totalPav: finite,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.calculationId !== `hpn-pav-season:${value.calculationSha256}` ||
      value.gamesPlayed !== value.sourceRowIds.length ||
      new Set(value.sourceRowIds).size !== value.sourceRowIds.length ||
      Math.abs(
        value.offensivePav + value.midfieldPav + value.defensivePav - value.totalPav
      ) > FLOAT_TOLERANCE ||
      value.effectiveThrough.slice(0, 4) !== String(value.seasonYear) ||
      Date.parse(value.calculatedAt) < Date.parse(value.effectiveThrough)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Player PAV values must bind one exact finalized calculation and reconcile their component total and game rows.',
      });
    }
  });

const calculationMembershipSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    calculationSha256: aflTradeSha256Schema,
    inputSetId: aflTradeContentAddressedIdSchema('hpn-pav-input-set'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    seasonYear: z.number().int().min(1998).max(2200),
    effectiveThrough: instant,
    calculatedAt: instant,
  })
  .strict()
  .superRefine((membership, context) => {
    if (
      membership.calculationId !== `hpn-pav-season:${membership.calculationSha256}` ||
      membership.effectiveThrough.slice(0, 4) !== String(membership.seasonYear) ||
      Date.parse(membership.calculatedAt) < Date.parse(membership.effectiveThrough)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Player-PAV calculation membership must authenticate one finalized season.',
      });
    }
  });

const matureOutcomeSchema = z
  .object({
    state: z.literal('mature_observed'),
    contribution: finite,
    gamesPlayed: z.number().int().nonnegative().max(500),
    seasonsObserved: z.number().int().positive().max(15),
  })
  .strict();

const censoredOutcomeSchema = z
  .object({
    state: z.literal('right_censored'),
    contributionObservedToDate: finite,
    gamesObservedToDate: z.number().int().nonnegative().max(500),
    seasonsObserved: z.number().int().positive().max(15),
    censoredAt: instant,
  })
  .strict();

const unavailableOutcomeSchema = z
  .object({
    state: z.literal('unavailable'),
    reason: z.enum([
      'source_missing',
      'player_identity_unresolved',
      'acquisition_spell_unresolved',
      'feature_history_incomplete',
      'horizon_calculation_missing',
    ]),
  })
  .strict();

const observationShape = {
  ordinal: z.number().int().positive().max(100_000),
  partition: z.enum(AFL_TRADE_MODEL_PARTITIONS),
  predictionSeason: z.number().int().min(1998).max(2200),
  predictionCutoffAt: instant,
  outcomeHorizonEndsAt: instant,
  outcomeObservedAt: instant,
  releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
  playerId: publicId,
  acquisitionSpell: acquisitionSpellSchema,
  featureCalculationSeasons: z.array(z.number().int().min(1998).max(2200)).min(1).max(10),
  featureValues: z.array(aflTradePlayerPavValueSchema).max(50),
  targetCalculationSeasons: z.array(z.number().int().min(1998).max(2200)).min(1).max(15),
  targetValues: z.array(aflTradePlayerPavValueSchema).max(100),
  outcome: z.discriminatedUnion('state', [
    matureOutcomeSchema,
    censoredOutcomeSchema,
    unavailableOutcomeSchema,
  ]),
} as const;

const observationContentSchema = z.object(observationShape).strict();

export const aflTradePlayerPavObservationSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('player-pav-observation'),
    ...observationShape,
  })
  .strict()
  .superRefine((observation, context) => {
    const { observationId, ...content } = observation;
    addAflTradeContentAddressIssue('player-pav-observation', observationId, content, context, [
      'observationId',
    ]);
    const featureSeasons = observation.featureCalculationSeasons;
    const targetSeasons = observation.targetCalculationSeasons;
    const featureValueSeasons = observation.featureValues.map(({ seasonYear }) => seasonYear);
    const targetValueSeasons = observation.targetValues.map(({ seasonYear }) => seasonYear);
    const featureValueKeys = observation.featureValues.map(
      ({ seasonYear, spellVersionId }) => `${seasonYear}|${spellVersionId}`
    );
    const canonicalFeatureValueKeys = [...featureValueKeys].sort((left, right) =>
      left.localeCompare(right)
    );
    const featureValueSeasonSet = [...new Set(featureValueSeasons)];
    const featureCoverageComplete =
      featureValueSeasonSet.length === featureSeasons.length &&
      featureValueSeasonSet.every((season, index) => season === featureSeasons[index]);
    const targetContribution = observation.targetValues.reduce(
      (sum, value) => sum + value.totalPav,
      0
    );
    const targetGames = observation.targetValues.reduce(
      (sum, value) => sum + value.gamesPlayed,
      0
    );
    const spellEndSeason =
      observation.acquisitionSpell.effectiveThrough === null
        ? null
        : Number(observation.acquisitionSpell.effectiveThrough.slice(0, 4));
    const measuredTargetSeasons = targetSeasons.filter(
      (season) => spellEndSeason === null || season <= spellEndSeason
    );
    const expectedPredictionCutoff = `${observation.predictionSeason}-12-31T23:59:59.999Z`;
    if (
      observation.predictionCutoffAt !== expectedPredictionCutoff ||
      Date.parse(observation.acquisitionSpell.recordedAt) >
        Date.parse(observation.predictionCutoffAt) ||
      Date.parse(observation.outcomeHorizonEndsAt) <=
        Date.parse(observation.predictionCutoffAt) ||
      Date.parse(observation.outcomeObservedAt) <= Date.parse(observation.predictionCutoffAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['predictionCutoffAt'],
        message: 'Player prediction, spell evidence, and outcome chronology is invalid.',
      });
    }
    if (
      featureSeasons.some(
        (season, index) =>
          season > observation.predictionSeason ||
          (index > 0 && season !== featureSeasons[index - 1]! + 1)
      ) ||
      targetSeasons.some(
        (season, index) =>
          season <= observation.predictionSeason ||
          (index > 0 && season !== targetSeasons[index - 1]! + 1)
      ) ||
      featureValueSeasons.some((season) => !featureSeasons.includes(season)) ||
      new Set(featureValueKeys).size !== featureValueKeys.length ||
      featureValueKeys.some((key, index) => key !== canonicalFeatureValueKeys[index]) ||
      targetValueSeasons.some(
        (season, index) => season !== targetSeasons[index] || index >= targetSeasons.length
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['featureCalculationSeasons'],
        message: 'Feature and target seasons must be unique, contiguous, and temporally separated.',
      });
    }
    if (
      (observation.outcome.state === 'unavailable' &&
        observation.outcome.reason === 'feature_history_incomplete' &&
        featureCoverageComplete) ||
      (observation.outcome.state !== 'unavailable' && !featureCoverageComplete)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['featureValues'],
        message:
          'Measurable player outcomes require every feature season; incomplete feature history must remain explicitly unavailable.',
      });
    }
    if (
      observation.featureValues.some(
        (value) =>
          value.playerId !== observation.playerId ||
          Date.parse(value.effectiveThrough) > Date.parse(observation.predictionCutoffAt)
      ) ||
      observation.targetValues.some(
        (value) =>
          value.playerId !== observation.playerId ||
          value.clubId !== observation.acquisitionSpell.clubId ||
          value.spellVersionId !== observation.acquisitionSpell.spellVersionId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetValues'],
        message:
          'Feature evidence must be known at prediction time and target PAV must remain on the exact receiving-club acquisition spell.',
      });
    }
    if (
      observation.outcome.state === 'mature_observed' &&
      (observation.targetValues.length !== measuredTargetSeasons.length ||
        targetValueSeasons.some((season, index) => season !== measuredTargetSeasons[index]) ||
        observation.outcome.seasonsObserved !== observation.targetCalculationSeasons.length ||
        Math.abs(observation.outcome.contribution - targetContribution) > FLOAT_TOLERANCE ||
        observation.outcome.gamesPlayed !== targetGames ||
        Date.parse(observation.outcomeObservedAt) < Date.parse(observation.outcomeHorizonEndsAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Mature player outcomes must exactly sum a complete fixed-horizon PAV path.',
      });
    }
    if (
      observation.outcome.state === 'right_censored' &&
      (observation.targetValues.length === 0 ||
        observation.targetValues.length >= observation.targetCalculationSeasons.length ||
        observation.outcome.seasonsObserved !== observation.targetValues.length ||
        observation.outcome.censoredAt !== observation.outcomeObservedAt ||
        Math.abs(observation.outcome.contributionObservedToDate - targetContribution) >
          FLOAT_TOLERANCE ||
        observation.outcome.gamesObservedToDate !== targetGames ||
        Date.parse(observation.outcomeObservedAt) >= Date.parse(observation.outcomeHorizonEndsAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Censored player outcomes must exactly sum the partial path observed by the cutoff.',
      });
    }
    if (
      observation.outcome.state === 'unavailable' &&
      observation.targetValues.length !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetValues'],
        message: 'Unavailable player outcomes cannot carry an unreviewed partial value.',
      });
    }
  });

function observationPreimages(observations: readonly AflTradePlayerPavObservation[]) {
  return observations.map(({ observationId: _observationId, ...content }) => content);
}

const observationSetContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PLAYER_PAV_OBSERVATION_SET_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PLAYER_PAV_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    createdAt: instant,
    knowledgeCutoffAt: instant,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policy: aflTradePlayerPavPolicySchema,
    calculations: z.array(calculationMembershipSchema).min(1).max(1_000),
    observations: z.array(aflTradePlayerPavObservationSchema).min(4).max(100_000),
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
        message: 'Player-PAV set must match policy scope and cannot use a future cutoff.',
      });
    }
    const observations = [...set.observations].sort(
      (left, right) =>
        left.predictionSeason - right.predictionSeason ||
        left.playerId.localeCompare(right.playerId) ||
        left.acquisitionSpell.spellVersionId.localeCompare(
          right.acquisitionSpell.spellVersionId
        )
    );
    const calculations = [...set.calculations].sort(
      (left, right) =>
        left.seasonYear - right.seasonYear || left.calculationId.localeCompare(right.calculationId)
    );
    if (
      observations.some(
        (observation, index) =>
          observation.observationId !== set.observations[index]?.observationId ||
          observation.ordinal !== index + 1
      ) ||
      calculations.some(
        (calculation, index) =>
          calculation.calculationId !== set.calculations[index]?.calculationId
      ) ||
      new Set(calculations.map(({ calculationId }) => calculationId)).size !==
        calculations.length ||
      set.observationCount !== observations.length ||
      set.observationSetSha256 !== sha256AflTradeCanonicalJson(observationPreimages(observations))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Player-PAV observations and calculations must be canonical and exactly sealed.',
      });
    }
    const calculationsById = new Map(
      calculations.map((calculation) => [calculation.calculationId, calculation])
    );
    const referencedCalculationIds = new Set<string>();
    for (const observation of observations) {
      const partition = set.policy.content.partitions.find(
        ({ role }) => role === observation.partition
      );
      const expectedFeatureSeasons = Array.from(
        { length: set.policy.content.featureHistorySeasons },
        (_, offset) =>
          observation.predictionSeason - set.policy.content.featureHistorySeasons + 1 + offset
      );
      const expectedTargetSeasons = Array.from(
        { length: set.policy.content.fixedHorizonSeasons },
        (_, offset) => observation.predictionSeason + 1 + offset
      );
      const values = [...observation.featureValues, ...observation.targetValues];
      values.forEach(({ calculationId }) => referencedCalculationIds.add(calculationId));
      if (
        observation.releaseId !== set.releaseId ||
        !partition ||
        observation.predictionSeason < partition.fromPredictionSeason ||
        observation.predictionSeason > partition.throughPredictionSeason ||
        expectedFeatureSeasons.some(
          (season, index) => season !== observation.featureCalculationSeasons[index]
        ) ||
        expectedTargetSeasons.some(
          (season, index) => season !== observation.targetCalculationSeasons[index]
        ) ||
        values.some((value) => {
          const calculation = calculationsById.get(value.calculationId);
          return (
            !calculation ||
            calculation.seasonYear !== value.seasonYear ||
            calculation.calculationSha256 !== value.calculationSha256 ||
            calculation.methodId !== set.policy.content.methodId ||
            calculation.effectiveThrough !== value.effectiveThrough ||
            calculation.calculatedAt !== value.calculatedAt
          );
        })
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message:
            'Every player observation must match its release, policy partition, fixed windows, and exact finalized calculations.',
        });
        break;
      }
    }
    if (
      calculations.some(({ calculationId }) => !referencedCalculationIds.has(calculationId)) ||
      referencedCalculationIds.size !== calculations.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calculations'],
        message: 'Calculation membership must equal the exact set referenced by player observations.',
      });
    }
    for (const partition of AFL_TRADE_MODEL_PARTITIONS) {
      if (!observations.some((observation) => observation.partition === partition)) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: `Player-PAV observations must contain the ${partition} partition.`,
        });
      }
    }
    for (let index = 1; index < AFL_TRADE_MODEL_PARTITIONS.length; index += 1) {
      const previous = AFL_TRADE_MODEL_PARTITIONS[index - 1]!;
      const current = AFL_TRADE_MODEL_PARTITIONS[index]!;
      const previousLabels = observations
        .filter(({ partition }) => partition === previous)
        .map(({ outcomeObservedAt }) => Date.parse(outcomeObservedAt));
      const currentCutoffs = observations
        .filter(({ partition }) => partition === current)
        .map(({ predictionCutoffAt }) => Date.parse(predictionCutoffAt));
      if (Math.max(...previousLabels) >= Math.min(...currentCutoffs)) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Player-PAV partitions must be chronological and label-purged.',
        });
        break;
      }
    }
  });

export const aflTradePlayerPavObservationSetSchema = z
  .object({
    observationSetId: aflTradeContentAddressedIdSchema('player-pav-observation-set'),
    content: observationSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'player-pav-observation-set',
      set.observationSetId,
      set.content,
      context,
      ['observationSetId']
    );
  });

export type AflTradePlayerPavPolicy = z.infer<typeof aflTradePlayerPavPolicySchema>;
export type AflTradePlayerPavObservation = z.infer<
  typeof aflTradePlayerPavObservationSchema
>;
export type AflTradePlayerPavObservationSet = z.infer<
  typeof aflTradePlayerPavObservationSetSchema
>;
export type AflTradePlayerPavObservationSetContent = z.infer<
  typeof observationSetContentSchema
>;

export function createAflTradePlayerPavPolicy(
  unparsedContent: z.input<typeof policyContentSchema>
): AflTradePlayerPavPolicy {
  const content = policyContentSchema.parse(unparsedContent);
  return aflTradePlayerPavPolicySchema.parse({
    policyId: createAflTradeContentAddress('player-pav-policy', content),
    content,
  });
}

export function createAflTradePlayerPavObservation(
  unparsed: z.input<typeof observationContentSchema> | AflTradePlayerPavObservation
): AflTradePlayerPavObservation {
  const { observationId: _observationId, ...candidate } = unparsed as AflTradePlayerPavObservation;
  const content = observationContentSchema.parse(candidate);
  return aflTradePlayerPavObservationSchema.parse({
    observationId: createAflTradeContentAddress('player-pav-observation', content),
    ...content,
  });
}

export function createAflTradePlayerPavObservationSet(
  unparsed: z.input<typeof observationSetContentSchema>
): AflTradePlayerPavObservationSet {
  const observations = [...unparsed.observations]
    .map((observation) => aflTradePlayerPavObservationSchema.parse(observation))
    .sort(
      (left, right) =>
        left.predictionSeason - right.predictionSeason ||
        left.playerId.localeCompare(right.playerId) ||
        left.acquisitionSpell.spellVersionId.localeCompare(
          right.acquisitionSpell.spellVersionId
        )
    );
  const calculations = [...unparsed.calculations].sort(
    (left, right) =>
      left.seasonYear - right.seasonYear || left.calculationId.localeCompare(right.calculationId)
  );
  const content = observationSetContentSchema.parse({
    ...unparsed,
    calculations,
    observations,
    observationSetSha256: sha256AflTradeCanonicalJson(observationPreimages(observations)),
  });
  return aflTradePlayerPavObservationSetSchema.parse({
    observationSetId: createAflTradeContentAddress('player-pav-observation-set', content),
    content,
  });
}
