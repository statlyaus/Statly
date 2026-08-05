import { z } from 'zod';

import {
  AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE,
  addAflTradeCompensatedTerm,
  compareAflTradeCodeUnits,
  createAflTradeCompensatedAccumulator,
  doAflTradeProbabilityMassesReconcile,
  readAflTradeCompensatedValue,
  sumAflTradeFiniteNumbers,
  type AflTradeCompensatedAccumulator,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

const MAX_REASON_CODES = 100;

export const AFL_TRADE_JOINT_OUTCOME_SCHEMA_VERSION =
  'afl-trade-joint-outcome-comparison/v1' as const;
export const AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION =
  'afl-trade-joint-outcome-comparison-input/v1' as const;
export const AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION =
  'unique_maximum_exceeds_runner_up_by_more_than_integer_tolerance_v1' as const;
export const AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION =
  'base_10_safe_integer_quanta_v1' as const;
export const AFL_TRADE_JOINT_OUTCOME_BOUNDS_DEFINITION_VERSION =
  'missing_probability_mass_may_belong_to_any_single_outcome_v1' as const;
export const AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE =
  'caller_supplied_governed_universal_value_quanta_only' as const;

const probabilitySchema = z.number().finite().min(0).max(1);

function addResultIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string
): void {
  context.addIssue({ code: 'custom', path, message });
}

function usesCanonicalIds(
  candidateIds: readonly string[],
  expectedIds: readonly string[]
): boolean {
  return (
    candidateIds.length === expectedIds.length &&
    candidateIds.every((candidateId, index) => candidateId === expectedIds[index])
  );
}

function usesCanonicalUniqueIds(candidateIds: readonly string[]): boolean {
  return usesCanonicalIds(candidateIds, [...new Set(candidateIds)].sort(compareAflTradeCodeUnits));
}
const valueScaleSchema = z
  .object({
    definitionVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION),
    decimalPlaces: z.number().int().min(0).max(9),
  })
  .strict();

const availableObservationSchema = z
  .object({ status: z.literal('available'), valueQuanta: z.number().int().safe() })
  .strict();

const unavailableObservationSchema = z
  .object({
    status: z.literal('unavailable'),
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(MAX_REASON_CODES),
  })
  .strict()
  .superRefine((observation, context) => {
    const canonical = [...new Set(observation.reasonCodes)].sort(compareAflTradeCodeUnits);
    if (
      canonical.length !== observation.reasonCodes.length ||
      canonical.some((reasonCode, index) => reasonCode !== observation.reasonCodes[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCodes'],
        message: 'Unavailable reason codes must be unique and use canonical order.',
      });
    }
  });

const partyObservationSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    observation: z.discriminatedUnion('status', [
      availableObservationSchema,
      unavailableObservationSchema,
    ]),
  })
  .strict();

const jointDrawSchema = z
  .object({
    drawKey: aflTradePublicIdSchema,
    probabilityWeight: z.number().finite().positive().max(1),
    parties: z.array(partyObservationSchema).min(2).max(18),
  })
  .strict();

export const aflTradeJointOutcomeComparisonInputSchema = z
  .object({
    inputSchemaVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    comparisonValueScope: z.literal(AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE),
    outcomeDefinitionVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION),
    valueUnitId: aflTradePublicIdSchema,
    valueScale: valueScaleSchema,
    aflClubIds: z.array(aflTradePublicIdSchema).min(2).max(18),
    clearLeaderToleranceQuanta: z.number().int().safe().nonnegative(),
    draws: z.array(jointDrawSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((input, context) => {
    const canonicalClubIds = [...new Set(input.aflClubIds)].sort(compareAflTradeCodeUnits);
    if (
      canonicalClubIds.length !== input.aflClubIds.length ||
      canonicalClubIds.some((aflClubId, index) => aflClubId !== input.aflClubIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['aflClubIds'],
        message: 'Comparison AFL clubs must be unique and use canonical order.',
      });
    }

    const drawKeys = input.draws.map((draw) => draw.drawKey);
    if (new Set(drawKeys).size !== drawKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['draws'],
        message: 'Joint comparison draw keys must be unique.',
      });
    }

    const totalWeight = sumAflTradeFiniteNumbers(
      [...input.draws]
        .sort((left, right) => compareAflTradeCodeUnits(left.drawKey, right.drawKey))
        .map((draw) => draw.probabilityWeight)
    );
    if (Math.abs(totalWeight - 1) > AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE) {
      context.addIssue({
        code: 'custom',
        path: ['draws'],
        message: 'Joint comparison draw weights must sum to one.',
      });
    }

    for (const [drawIndex, draw] of input.draws.entries()) {
      const drawClubIds = draw.parties.map((party) => party.aflClubId);
      if (
        drawClubIds.length !== input.aflClubIds.length ||
        drawClubIds.some((aflClubId, index) => aflClubId !== input.aflClubIds[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['draws', drawIndex, 'parties'],
          message: 'Every joint draw must contain each comparison AFL club in canonical order.',
        });
      }
    }
  });

export type AflTradeJointOutcomeComparisonInput = z.infer<
  typeof aflTradeJointOutcomeComparisonInputSchema
>;

const clubProbabilitySchema = z
  .object({ aflClubId: aflTradePublicIdSchema, probability: probabilitySchema })
  .strict();

export const aflTradeJointOutcomeProbabilitiesSchema = z
  .object({
    clubClearLeaderProbabilities: z.array(clubProbabilitySchema).min(2).max(18),
    noClearLeaderProbability: probabilitySchema,
  })
  .strict()
  .superRefine((probabilities, context) => {
    const clubIds = probabilities.clubClearLeaderProbabilities.map(
      (probability) => probability.aflClubId
    );
    if (!usesCanonicalUniqueIds(clubIds)) {
      addResultIssue(
        context,
        ['clubClearLeaderProbabilities'],
        'Probability AFL clubs must be unique and use canonical order.'
      );
    }

    const totalProbability = sumAflTradeFiniteNumbers([
      ...probabilities.clubClearLeaderProbabilities.map((item) => item.probability),
      probabilities.noClearLeaderProbability,
    ]);
    if (!doAflTradeProbabilityMassesReconcile(totalProbability, 1)) {
      addResultIssue(context, [], 'Joint outcome probabilities must sum to one.');
    }
  });

const clubBoundsSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    lower: probabilitySchema,
    upper: probabilitySchema,
  })
  .strict();
const probabilityBoundsSchema = z
  .object({ lower: probabilitySchema, upper: probabilitySchema })
  .strict();

export const aflTradeJointOutcomeBoundsSchema = z
  .object({
    clubClearLeaderBounds: z.array(clubBoundsSchema).min(2).max(18),
    noClearLeaderBounds: probabilityBoundsSchema,
  })
  .strict()
  .superRefine((bounds, context) => {
    const clubIds = bounds.clubClearLeaderBounds.map((bound) => bound.aflClubId);
    if (!usesCanonicalUniqueIds(clubIds)) {
      addResultIssue(
        context,
        ['clubClearLeaderBounds'],
        'Bounded AFL clubs must be unique and use canonical order.'
      );
    }

    for (const [index, bound] of bounds.clubClearLeaderBounds.entries()) {
      if (bound.lower > bound.upper) {
        addResultIssue(
          context,
          ['clubClearLeaderBounds', index],
          'A lower probability bound cannot exceed its upper bound.'
        );
      }
    }
    if (bounds.noClearLeaderBounds.lower > bounds.noClearLeaderBounds.upper) {
      addResultIssue(
        context,
        ['noClearLeaderBounds'],
        'A lower probability bound cannot exceed its upper bound.'
      );
    }
  });

const resultMetadataShape = {
  schemaVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_SCHEMA_VERSION),
  publicAssetBoundary: z.literal(AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY),
  comparisonValueScope: z.literal(AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE),
  outcomeDefinitionVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION),
  boundsDefinitionVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_BOUNDS_DEFINITION_VERSION),
  valueUnitId: aflTradePublicIdSchema,
  valueScale: valueScaleSchema,
  aflClubIds: z.array(aflTradePublicIdSchema).min(2).max(18),
  clearLeaderToleranceQuanta: z.number().int().safe().nonnegative(),
  drawCount: z.number().int().positive().max(100_000),
  availableDrawCount: z.number().int().nonnegative().max(100_000),
  unavailableDrawCount: z.number().int().nonnegative().max(100_000),
  availableProbabilityMass: probabilitySchema,
  unavailableProbabilityMass: probabilitySchema,
  unconditionalBounds: aflTradeJointOutcomeBoundsSchema,
} as const;

const availableComparisonSchema = z
  .object({
    ...resultMetadataShape,
    status: z.literal('available'),
    availableProbabilityMass: z.literal(1),
    unavailableProbabilityMass: z.literal(0),
    probabilities: aflTradeJointOutcomeProbabilitiesSchema,
    conditionalOnAvailableProbabilities: z.null(),
    reasonCodes: z.array(aflTradePublicIdSchema).length(0),
  })
  .strict();

const unavailableComparisonSchema = z
  .object({
    ...resultMetadataShape,
    status: z.literal('unavailable'),
    probabilities: z.null(),
    conditionalOnAvailableProbabilities: aflTradeJointOutcomeProbabilitiesSchema.nullable(),
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(MAX_REASON_CODES),
  })
  .strict();

export const aflTradeJointOutcomeComparisonSchema = z
  .discriminatedUnion('status', [availableComparisonSchema, unavailableComparisonSchema])
  .superRefine((result, context) => {
    const canonicalClubIds = [...new Set(result.aflClubIds)].sort(compareAflTradeCodeUnits);
    if (!usesCanonicalIds(result.aflClubIds, canonicalClubIds)) {
      addResultIssue(
        context,
        ['aflClubIds'],
        'Result AFL clubs must be unique and use canonical order.'
      );
    }

    const boundClubIds = result.unconditionalBounds.clubClearLeaderBounds.map(
      (bound) => bound.aflClubId
    );
    if (!usesCanonicalIds(boundClubIds, result.aflClubIds)) {
      addResultIssue(
        context,
        ['unconditionalBounds', 'clubClearLeaderBounds'],
        'Result bounds must contain every AFL club in canonical order.'
      );
    }

    if (result.availableDrawCount + result.unavailableDrawCount !== result.drawCount) {
      addResultIssue(
        context,
        ['drawCount'],
        'Available and unavailable draw counts must reconcile.'
      );
    }
    if (
      !doAflTradeProbabilityMassesReconcile(
        result.availableProbabilityMass + result.unavailableProbabilityMass,
        1
      )
    ) {
      addResultIssue(
        context,
        ['availableProbabilityMass'],
        'Available and unavailable probability mass must sum to one.'
      );
    }

    const validateProbabilityClubs = (
      probabilities: AflTradeJointOutcomeProbabilities,
      path: Array<string | number>
    ) => {
      const probabilityClubIds = probabilities.clubClearLeaderProbabilities.map(
        (probability) => probability.aflClubId
      );
      if (!usesCanonicalIds(probabilityClubIds, result.aflClubIds)) {
        addResultIssue(
          context,
          path,
          'Result probabilities must contain every AFL club in canonical order.'
        );
      }
    };

    const expectedBounds = (
      probabilities: AflTradeJointOutcomeProbabilities | null,
      availableMass: number,
      missingMass: number
    ) => ({
      clubClearLeaderBounds: result.aflClubIds.map((aflClubId, index) => {
        const conditionalProbability =
          probabilities?.clubClearLeaderProbabilities[index]?.probability ?? 0;
        const lower = conditionalProbability * availableMass;
        return { aflClubId, lower, upper: Math.min(1, lower + missingMass) };
      }),
      noClearLeaderBounds: (() => {
        const lower = (probabilities?.noClearLeaderProbability ?? 0) * availableMass;
        return { lower, upper: Math.min(1, lower + missingMass) };
      })(),
    });

    const validateBounds = (expected: AflTradeJointOutcomeBounds) => {
      expected.clubClearLeaderBounds.forEach((expectedBound, index) => {
        const actualBound = result.unconditionalBounds.clubClearLeaderBounds[index];
        if (
          actualBound === undefined ||
          !doAflTradeProbabilityMassesReconcile(actualBound.lower, expectedBound.lower) ||
          !doAflTradeProbabilityMassesReconcile(actualBound.upper, expectedBound.upper)
        ) {
          addResultIssue(
            context,
            ['unconditionalBounds', 'clubClearLeaderBounds', index],
            'Club outcome bounds must reconcile with available and missing probability mass.'
          );
        }
      });
      if (
        !doAflTradeProbabilityMassesReconcile(
          result.unconditionalBounds.noClearLeaderBounds.lower,
          expected.noClearLeaderBounds.lower
        ) ||
        !doAflTradeProbabilityMassesReconcile(
          result.unconditionalBounds.noClearLeaderBounds.upper,
          expected.noClearLeaderBounds.upper
        )
      ) {
        addResultIssue(
          context,
          ['unconditionalBounds', 'noClearLeaderBounds'],
          'No-clear-leader bounds must reconcile with available and missing probability mass.'
        );
      }
    };

    if (result.status === 'available') {
      validateProbabilityClubs(result.probabilities, ['probabilities']);
      if (result.availableDrawCount !== result.drawCount || result.unavailableDrawCount !== 0) {
        addResultIssue(
          context,
          ['availableDrawCount'],
          'An available result must have no unavailable draws.'
        );
      }
      validateBounds(expectedBounds(result.probabilities, 1, 0));
      return;
    }

    const canonicalReasonCodes = [...new Set(result.reasonCodes)].sort(compareAflTradeCodeUnits);
    if (!usesCanonicalIds(result.reasonCodes, canonicalReasonCodes)) {
      addResultIssue(
        context,
        ['reasonCodes'],
        'Unavailable reason codes must be unique and use canonical order.'
      );
    }
    if (result.unavailableDrawCount === 0 || result.unavailableProbabilityMass === 0) {
      addResultIssue(
        context,
        ['unavailableDrawCount'],
        'An unavailable result must contain positive unavailable draw count and probability mass.'
      );
    }

    if (result.availableDrawCount === 0) {
      if (
        result.availableProbabilityMass !== 0 ||
        result.conditionalOnAvailableProbabilities !== null
      ) {
        addResultIssue(
          context,
          ['conditionalOnAvailableProbabilities'],
          'A wholly unavailable result cannot contain conditional probabilities.'
        );
      }
    } else if (
      result.availableProbabilityMass === 0 ||
      result.conditionalOnAvailableProbabilities === null
    ) {
      addResultIssue(
        context,
        ['conditionalOnAvailableProbabilities'],
        'A partially available result must contain conditional probabilities.'
      );
    }

    if (result.conditionalOnAvailableProbabilities !== null) {
      validateProbabilityClubs(result.conditionalOnAvailableProbabilities, [
        'conditionalOnAvailableProbabilities',
      ]);
    }
    validateBounds(
      expectedBounds(
        result.conditionalOnAvailableProbabilities,
        result.availableProbabilityMass,
        result.unavailableProbabilityMass
      )
    );
  });

export type AflTradeJointOutcomeProbabilities = z.infer<
  typeof aflTradeJointOutcomeProbabilitiesSchema
>;
export type AflTradeJointOutcomeBounds = z.infer<typeof aflTradeJointOutcomeBoundsSchema>;
export type AflTradeJointOutcomeComparison = z.infer<typeof aflTradeJointOutcomeComparisonSchema>;

type ClassifiedOutcome =
  { kind: 'club_clear_leader'; aflClubId: string } | { kind: 'no_clear_leader' };

function classifyDraw(
  parties: readonly z.infer<typeof partyObservationSchema>[],
  clearLeaderToleranceQuanta: number
): ClassifiedOutcome | null {
  let leader: { aflClubId: string; valueQuanta: number } | null = null;
  let runnerUp: { aflClubId: string; valueQuanta: number } | null = null;

  for (const party of parties) {
    if (party.observation.status === 'unavailable') return null;
    const candidate = { aflClubId: party.aflClubId, valueQuanta: party.observation.valueQuanta };
    const ranksBeforeLeader =
      leader === null ||
      candidate.valueQuanta > leader.valueQuanta ||
      (candidate.valueQuanta === leader.valueQuanta &&
        compareAflTradeCodeUnits(candidate.aflClubId, leader.aflClubId) < 0);
    if (ranksBeforeLeader) {
      runnerUp = leader;
      leader = candidate;
      continue;
    }

    const ranksBeforeRunnerUp =
      runnerUp === null ||
      candidate.valueQuanta > runnerUp.valueQuanta ||
      (candidate.valueQuanta === runnerUp.valueQuanta &&
        compareAflTradeCodeUnits(candidate.aflClubId, runnerUp.aflClubId) < 0);
    if (ranksBeforeRunnerUp) runnerUp = candidate;
  }

  if (leader === null || runnerUp === null) {
    throw new Error('A joint outcome draw requires at least two available AFL clubs.');
  }
  const uniqueMaximum = leader.valueQuanta !== runnerUp.valueQuanta;

  return uniqueMaximum &&
    BigInt(leader.valueQuanta) - BigInt(runnerUp.valueQuanta) > BigInt(clearLeaderToleranceQuanta)
    ? { kind: 'club_clear_leader', aflClubId: leader.aflClubId }
    : { kind: 'no_clear_leader' };
}

function normalizeProbabilities(
  aflClubIds: readonly string[],
  clubMass: ReadonlyMap<string, number>,
  noClearLeaderMass: number,
  denominator: number
): AflTradeJointOutcomeProbabilities {
  return {
    clubClearLeaderProbabilities: aflClubIds.map((aflClubId) => ({
      aflClubId,
      probability: (clubMass.get(aflClubId) ?? 0) / denominator,
    })),
    noClearLeaderProbability: noClearLeaderMass / denominator,
  };
}

function createBounds(
  aflClubIds: readonly string[],
  clubMass: ReadonlyMap<string, number>,
  noClearLeaderMass: number,
  missingMass: number
): AflTradeJointOutcomeBounds {
  return {
    clubClearLeaderBounds: aflClubIds.map((aflClubId) => {
      const lower = clubMass.get(aflClubId) ?? 0;
      return { aflClubId, lower, upper: Math.min(1, lower + missingMass) };
    }),
    noClearLeaderBounds: {
      lower: noClearLeaderMass,
      upper: Math.min(1, noClearLeaderMass + missingMass),
    },
  };
}

function createDegenerateBounds(
  probabilities: AflTradeJointOutcomeProbabilities
): AflTradeJointOutcomeBounds {
  return {
    clubClearLeaderBounds: probabilities.clubClearLeaderProbabilities.map(
      ({ aflClubId, probability }) => ({ aflClubId, lower: probability, upper: probability })
    ),
    noClearLeaderBounds: {
      lower: probabilities.noClearLeaderProbability,
      upper: probabilities.noClearLeaderProbability,
    },
  };
}

export function calculateAflTradeJointOutcomeComparison(
  unparsedInput: AflTradeJointOutcomeComparisonInput
): AflTradeJointOutcomeComparison {
  const input = aflTradeJointOutcomeComparisonInputSchema.parse(unparsedInput);
  const draws = [...input.draws].sort((left, right) =>
    compareAflTradeCodeUnits(left.drawKey, right.drawKey)
  );
  const totalWeight = sumAflTradeFiniteNumbers(draws.map((draw) => draw.probabilityWeight));
  const clubWeight = new Map<string, AflTradeCompensatedAccumulator>(
    input.aflClubIds.map((aflClubId) => [aflClubId, createAflTradeCompensatedAccumulator()])
  );
  const reasonCodes = new Set<string>();
  const availableWeight = createAflTradeCompensatedAccumulator();
  const missingWeight = createAflTradeCompensatedAccumulator();
  const noClearLeaderWeight = createAflTradeCompensatedAccumulator();
  let hasUnavailableDraw = false;
  let availableDrawCount = 0;
  let unavailableDrawCount = 0;

  for (const draw of draws) {
    const outcome = classifyDraw(draw.parties, input.clearLeaderToleranceQuanta);
    if (outcome === null) {
      hasUnavailableDraw = true;
      unavailableDrawCount += 1;
      addAflTradeCompensatedTerm(missingWeight, draw.probabilityWeight);
      for (const party of draw.parties) {
        if (party.observation.status === 'unavailable') {
          party.observation.reasonCodes.forEach((reasonCode) => reasonCodes.add(reasonCode));
          if (reasonCodes.size > MAX_REASON_CODES) {
            throw new Error(
              `Joint outcome unavailable reason-code union exceeds ${MAX_REASON_CODES}.`
            );
          }
        }
      }
      continue;
    }

    availableDrawCount += 1;
    addAflTradeCompensatedTerm(availableWeight, draw.probabilityWeight);
    if (outcome.kind === 'no_clear_leader') {
      addAflTradeCompensatedTerm(noClearLeaderWeight, draw.probabilityWeight);
    } else {
      addAflTradeCompensatedTerm(clubWeight.get(outcome.aflClubId)!, draw.probabilityWeight);
    }
  }

  const availableWeightValue = readAflTradeCompensatedValue(availableWeight);
  const missingWeightValue = readAflTradeCompensatedValue(missingWeight);
  const availableProbabilityMass = availableWeightValue / totalWeight;
  const missingProbabilityMass = missingWeightValue / totalWeight;
  const clubMass = new Map<string, number>(
    input.aflClubIds.map((aflClubId) => [
      aflClubId,
      readAflTradeCompensatedValue(clubWeight.get(aflClubId)!) / totalWeight,
    ])
  );
  const noClearLeaderMass = readAflTradeCompensatedValue(noClearLeaderWeight) / totalWeight;

  const resultMetadata = {
    schemaVersion: AFL_TRADE_JOINT_OUTCOME_SCHEMA_VERSION,
    publicAssetBoundary: input.publicAssetBoundary,
    comparisonValueScope: input.comparisonValueScope,
    outcomeDefinitionVersion: input.outcomeDefinitionVersion,
    boundsDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_BOUNDS_DEFINITION_VERSION,
    valueUnitId: input.valueUnitId,
    valueScale: input.valueScale,
    aflClubIds: input.aflClubIds,
    clearLeaderToleranceQuanta: input.clearLeaderToleranceQuanta,
    drawCount: draws.length,
    availableDrawCount,
    unavailableDrawCount,
  } as const;

  if (!hasUnavailableDraw) {
    const probabilities = normalizeProbabilities(
      input.aflClubIds,
      clubMass,
      noClearLeaderMass,
      availableProbabilityMass
    );
    return aflTradeJointOutcomeComparisonSchema.parse({
      ...resultMetadata,
      status: 'available',
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
      probabilities,
      conditionalOnAvailableProbabilities: null,
      unconditionalBounds: createDegenerateBounds(probabilities),
      reasonCodes: [],
    });
  }

  return aflTradeJointOutcomeComparisonSchema.parse({
    ...resultMetadata,
    status: 'unavailable',
    availableProbabilityMass,
    unavailableProbabilityMass: missingProbabilityMass,
    probabilities: null,
    conditionalOnAvailableProbabilities:
      availableProbabilityMass === 0
        ? null
        : normalizeProbabilities(
            input.aflClubIds,
            clubMass,
            noClearLeaderMass,
            availableProbabilityMass
          ),
    unconditionalBounds: createBounds(
      input.aflClubIds,
      clubMass,
      noClearLeaderMass,
      missingProbabilityMass
    ),
    reasonCodes: [...reasonCodes].sort(compareAflTradeCodeUnits),
  });
}
