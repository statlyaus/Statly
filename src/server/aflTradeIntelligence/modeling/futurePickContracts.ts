import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_PICK_OUTCOME_CATEGORIES } from './pickOutcomeContracts';

const FLOAT_TOLERANCE = 1e-10;
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const positiveProbabilitySchema = z.number().finite().positive().max(1);

function isCanonicallyOrdered(ids: readonly string[]): boolean {
  const sorted = [...ids].sort();
  return ids.every((id, index) => id === sorted[index]);
}

function isCompleteMonotoneSelectionMap(
  mappings: readonly { nominalSelectionNumber: number; actualSelectionNumber: number }[],
  expectedSelections: number
): boolean {
  if (mappings.length !== expectedSelections) return false;
  let previousActual = 0;
  for (const [index, mapping] of mappings.entries()) {
    if (
      mapping.nominalSelectionNumber !== index + 1 ||
      mapping.actualSelectionNumber < mapping.nominalSelectionNumber ||
      mapping.actualSelectionNumber <= previousActual
    ) {
      return false;
    }
    previousActual = mapping.actualSelectionNumber;
  }
  return true;
}

const ladderClubPositionSchema = z
  .object({
    aflClubId: publicIdSchema,
    finishingPosition: z.number().int().positive().max(30),
  })
  .strict();

const ladderStateSchema = z
  .object({
    ladderStateId: publicIdSchema,
    probability: positiveProbabilitySchema,
    clubPositions: z.array(ladderClubPositionSchema).min(2).max(30),
  })
  .strict();

const nominalActualSelectionSchema = z
  .object({
    nominalSelectionNumber: z.number().int().positive().max(500),
    actualSelectionNumber: z.number().int().positive().max(500),
  })
  .strict();

const ruleResolutionStateSchema = z
  .object({
    ruleResolutionStateId: publicIdSchema,
    probability: positiveProbabilitySchema,
    nominalToActualSelections: z.array(nominalActualSelectionSchema).min(2).max(500),
  })
  .strict();

const futurePickRuleVintageSchema = z
  .object({
    ruleVintageArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    knownAt: isoDateTimeSchema,
    effectiveDraftYearFrom: z.number().int().min(1897).max(2100),
    effectiveDraftYearTo: z.number().int().min(1897).max(2100),
    aflClubCount: z.number().int().min(2).max(30),
    supportedRounds: z.number().int().positive().max(20),
    nominalOrderRule: z.literal('reverse_final_ladder_within_round'),
    adjustmentResolution: z.literal('joint_monotone_nominal_to_actual_state_distribution'),
    supportedSelectionAccess: z.literal('open_only'),
    resolutionStates: z.array(ruleResolutionStateSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((rule, context) => {
    const expectedSelections = rule.aflClubCount * rule.supportedRounds;
    const stateIds = rule.resolutionStates.map(
      ({ ruleResolutionStateId }) => ruleResolutionStateId
    );
    if (
      rule.effectiveDraftYearFrom > rule.effectiveDraftYearTo ||
      new Set(stateIds).size !== stateIds.length ||
      !isCanonicallyOrdered(stateIds) ||
      Math.abs(rule.resolutionStates.reduce((sum, state) => sum + state.probability, 0) - 1) >
        FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resolutionStates'],
        message: 'Rule-vintage years, state identities, and state probabilities must be coherent.',
      });
    }
    for (const [stateIndex, state] of rule.resolutionStates.entries()) {
      if (!isCompleteMonotoneSelectionMap(state.nominalToActualSelections, expectedSelections)) {
        context.addIssue({
          code: 'custom',
          path: ['resolutionStates', stateIndex, 'nominalToActualSelections'],
          message:
            'Every rule state must map the complete nominal order to a strictly increasing actual order.',
        });
      }
    }
  });

const futurePickEntitlementSchema = z
  .object({
    futurePickAssetId: publicIdSchema,
    aflClubEntitlementHolderId: publicIdSchema,
    ladderLinkedAflClubId: publicIdSchema,
    draftYear: z.number().int().min(1897).max(2100),
    round: z.number().int().positive().max(20),
    selectionPathway: z.literal('national'),
    selectionAccess: z.literal('open'),
    bidSelectionNumber: z.null(),
  })
  .strict();

const draftClassEffectStateSchema = z
  .object({
    draftClassEffectStateId: publicIdSchema,
    probability: positiveProbabilitySchema,
    contributionMultiplier: z.number().finite().positive().max(10),
  })
  .strict();

const productiveDelayStateSchema = z
  .object({
    productiveDelaySeasons: z.number().int().nonnegative().max(30),
    probability: positiveProbabilitySchema,
  })
  .strict();

const categoryDelayDistributionSchema = z
  .object({
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    delayStates: z.array(productiveDelayStateSchema).min(1).max(31),
  })
  .strict()
  .superRefine((distribution, context) => {
    const delays = distribution.delayStates.map(
      ({ productiveDelaySeasons }) => productiveDelaySeasons
    );
    if (
      new Set(delays).size !== delays.length ||
      delays.some(
        (delay, index) => delay !== [...delays].sort((left, right) => left - right)[index]
      ) ||
      Math.abs(distribution.delayStates.reduce((sum, state) => sum + state.probability, 0) - 1) >
        FLOAT_TOLERANCE ||
      (distribution.category === 'no_afl_game' &&
        (distribution.delayStates.length !== 1 || delays[0] !== 0))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['delayStates'],
        message:
          'Category delay states must be ordered, unique, normalized, and zero for no-game outcomes.',
      });
    }
  });

const footballTimingWeightSchema = z
  .object({
    totalDelaySeasons: z.number().int().nonnegative().max(60),
    footballTimingWeight: z.number().finite().min(0).max(1),
  })
  .strict();

const productiveDelayPolicySchema = z
  .object({
    productiveDelayModelArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    footballTimingPolicyArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    seasonsUntilDraft: z.number().int().nonnegative().max(10),
    timingInterpretation: z.literal('football_productivity_timing_only_no_market_impatience'),
    categoryDelayDistributions: z
      .array(categoryDelayDistributionSchema)
      .length(AFL_TRADE_PICK_OUTCOME_CATEGORIES.length),
    footballTimingWeights: z.array(footballTimingWeightSchema).min(1).max(61),
  })
  .strict()
  .superRefine((policy, context) => {
    const categories = policy.categoryDelayDistributions.map(({ category }) => category);
    const maximumProductiveDelay = Math.max(
      ...policy.categoryDelayDistributions.flatMap(({ delayStates }) =>
        delayStates.map(({ productiveDelaySeasons }) => productiveDelaySeasons)
      )
    );
    const requiredMaximumDelay = policy.seasonsUntilDraft + maximumProductiveDelay;
    const weightsAreCompleteAndMonotone = policy.footballTimingWeights.every(
      (weight, index) =>
        weight.totalDelaySeasons === index &&
        (index !== 0 || weight.footballTimingWeight === 1) &&
        (index === 0 ||
          weight.footballTimingWeight <=
            policy.footballTimingWeights[index - 1].footballTimingWeight + FLOAT_TOLERANCE)
    );
    if (
      categories.some((category, index) => category !== AFL_TRADE_PICK_OUTCOME_CATEGORIES[index]) ||
      policy.footballTimingWeights.length !== requiredMaximumDelay + 1 ||
      !weightsAreCompleteAndMonotone
    ) {
      context.addIssue({
        code: 'custom',
        path: ['footballTimingWeights'],
        message:
          'Productive-delay categories and complete non-increasing football timing weights are required.',
      });
    }
  });

export const aflTradeFuturePickScenarioContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-future-pick-scenario/v1'),
    publicAssetBoundary: z.literal('afl_club_entitlements_no_user_or_fantasy_ownership'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    pickBenchmarkFitId: aflTradeContentAddressedIdSchema('pick-benchmark-fit'),
    valueUnitId: publicIdSchema,
    effectiveAt: isoDateTimeSchema,
    draftYear: z.number().int().min(1897).max(2100),
    ladderInputArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    ladderInputKnownAt: isoDateTimeSchema,
    pickCurveMinimumSelection: z.number().int().positive().max(500),
    pickCurveMaximumSelection: z.number().int().positive().max(500),
    ladderStates: z.array(ladderStateSchema).min(1).max(10_000),
    ruleVintage: futurePickRuleVintageSchema,
    futurePickEntitlements: z.array(futurePickEntitlementSchema).min(1).max(100),
    draftClassEffectModelArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    draftClassEffectStates: z.array(draftClassEffectStateSchema).min(1).max(100),
    productiveDelayPolicy: productiveDelayPolicySchema,
    simulationOrder: z.tuple([
      z.literal('joint_ladder_state'),
      z.literal('rule_vintage_selection_resolution'),
      z.literal('shared_draft_class_effect'),
      z.literal('player_outcome'),
      z.literal('productive_delay'),
    ]),
    limitation: z.literal(
      'Scenario contracts provide no source-rights approval, model approval, or deployment approval.'
    ),
  })
  .strict()
  .superRefine((scenario, context) => {
    const effectiveAt = Date.parse(scenario.effectiveAt);
    const clubUniverse = scenario.ladderStates[0]?.clubPositions
      .map(({ aflClubId }) => aflClubId)
      .sort();
    const ladderStateIds = scenario.ladderStates.map(({ ladderStateId }) => ladderStateId);
    if (
      scenario.pickCurveMinimumSelection > scenario.pickCurveMaximumSelection ||
      Date.parse(scenario.ladderInputKnownAt) > effectiveAt ||
      Date.parse(scenario.ruleVintage.knownAt) > effectiveAt ||
      scenario.draftYear < scenario.ruleVintage.effectiveDraftYearFrom ||
      scenario.draftYear > scenario.ruleVintage.effectiveDraftYearTo ||
      new Set(ladderStateIds).size !== ladderStateIds.length ||
      !isCanonicallyOrdered(ladderStateIds) ||
      Math.abs(scenario.ladderStates.reduce((sum, state) => sum + state.probability, 0) - 1) >
        FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ladderStates'],
        message:
          'Scenario dates, curve domain, ladder identities, and probabilities must be coherent.',
      });
    }
    for (const [stateIndex, state] of scenario.ladderStates.entries()) {
      const clubs = state.clubPositions.map(({ aflClubId }) => aflClubId).sort();
      const positions = state.clubPositions
        .map(({ finishingPosition }) => finishingPosition)
        .sort((left, right) => left - right);
      if (
        state.clubPositions.length !== scenario.ruleVintage.aflClubCount ||
        new Set(clubs).size !== clubs.length ||
        clubs.some((club, index) => club !== clubUniverse[index]) ||
        positions.some((position, index) => position !== index + 1) ||
        state.clubPositions.some(
          (position, index) =>
            position.aflClubId !==
            [...state.clubPositions].sort((left, right) =>
              left.aflClubId.localeCompare(right.aflClubId)
            )[index].aflClubId
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['ladderStates', stateIndex, 'clubPositions'],
          message:
            'Every joint ladder state must contain the same ordered club-position permutation.',
        });
      }
    }

    const assetIds = scenario.futurePickEntitlements.map(
      ({ futurePickAssetId }) => futurePickAssetId
    );
    const entitlementKeys = scenario.futurePickEntitlements.map(
      ({ ladderLinkedAflClubId, round, draftYear }) =>
        `${draftYear}:${round}:${ladderLinkedAflClubId}`
    );
    if (
      new Set(assetIds).size !== assetIds.length ||
      new Set(entitlementKeys).size !== entitlementKeys.length ||
      !isCanonicallyOrdered(assetIds) ||
      scenario.futurePickEntitlements.some(
        (entitlement) =>
          entitlement.draftYear !== scenario.draftYear ||
          entitlement.round > scenario.ruleVintage.supportedRounds ||
          !clubUniverse.includes(entitlement.aflClubEntitlementHolderId) ||
          !clubUniverse.includes(entitlement.ladderLinkedAflClubId)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['futurePickEntitlements'],
        message:
          'Future-pick AFL-club entitlements must be unique, in-vintage, supported, and use ladder clubs.',
      });
    }

    const effectIds = scenario.draftClassEffectStates.map(
      ({ draftClassEffectStateId }) => draftClassEffectStateId
    );
    if (
      new Set(effectIds).size !== effectIds.length ||
      !isCanonicallyOrdered(effectIds) ||
      Math.abs(
        scenario.draftClassEffectStates.reduce((sum, state) => sum + state.probability, 0) - 1
      ) > FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['draftClassEffectStates'],
        message: 'Shared draft-class effect states must be unique and normalized.',
      });
    }

    const actualByResolutionState = scenario.ruleVintage.resolutionStates.map(
      (resolutionState) =>
        new Map(
          resolutionState.nominalToActualSelections.map((mapping) => [
            mapping.nominalSelectionNumber,
            mapping.actualSelectionNumber,
          ])
        )
    );
    for (const entitlement of scenario.futurePickEntitlements) {
      for (const ladderState of scenario.ladderStates) {
        const finishingPosition = ladderState.clubPositions.find(
          ({ aflClubId }) => aflClubId === entitlement.ladderLinkedAflClubId
        )?.finishingPosition;
        if (finishingPosition === undefined) continue;
        const nominalSelectionNumber =
          (entitlement.round - 1) * scenario.ruleVintage.aflClubCount +
          (scenario.ruleVintage.aflClubCount - finishingPosition + 1);
        for (const actualMap of actualByResolutionState) {
          const actualSelectionNumber = actualMap.get(nominalSelectionNumber);
          if (
            actualSelectionNumber === undefined ||
            actualSelectionNumber < scenario.pickCurveMinimumSelection ||
            actualSelectionNumber > scenario.pickCurveMaximumSelection
          ) {
            context.addIssue({
              code: 'custom',
              path: ['futurePickEntitlements'],
              message:
                'Every reachable actual selection must remain inside the non-extrapolating pick-curve domain.',
            });
            return;
          }
        }
      }
    }
  });

export const aflTradeFuturePickScenarioSchema = z
  .object({
    futurePickScenarioId: aflTradeContentAddressedIdSchema('future-pick-scenario'),
    content: aflTradeFuturePickScenarioContentSchema,
  })
  .strict()
  .superRefine((scenario, context) => {
    addAflTradeContentAddressIssue(
      'future-pick-scenario',
      scenario.futurePickScenarioId,
      scenario.content,
      context,
      ['futurePickScenarioId']
    );
  });

export type AflTradeFuturePickScenarioContent = z.infer<
  typeof aflTradeFuturePickScenarioContentSchema
>;
export type AflTradeFuturePickScenario = z.infer<typeof aflTradeFuturePickScenarioSchema>;

export function createAflTradeFuturePickScenario(
  unparsedContent: AflTradeFuturePickScenarioContent
): AflTradeFuturePickScenario {
  const content = aflTradeFuturePickScenarioContentSchema.parse({
    ...unparsedContent,
    ladderStates: [...unparsedContent.ladderStates]
      .map((state) => ({
        ...state,
        clubPositions: [...state.clubPositions].sort((left, right) =>
          left.aflClubId.localeCompare(right.aflClubId)
        ),
      }))
      .sort((left, right) => left.ladderStateId.localeCompare(right.ladderStateId)),
    ruleVintage: {
      ...unparsedContent.ruleVintage,
      resolutionStates: [...unparsedContent.ruleVintage.resolutionStates]
        .map((state) => ({
          ...state,
          nominalToActualSelections: [...state.nominalToActualSelections].sort(
            (left, right) => left.nominalSelectionNumber - right.nominalSelectionNumber
          ),
        }))
        .sort((left, right) =>
          left.ruleResolutionStateId.localeCompare(right.ruleResolutionStateId)
        ),
    },
    futurePickEntitlements: [...unparsedContent.futurePickEntitlements].sort((left, right) =>
      left.futurePickAssetId.localeCompare(right.futurePickAssetId)
    ),
    draftClassEffectStates: [...unparsedContent.draftClassEffectStates].sort((left, right) =>
      left.draftClassEffectStateId.localeCompare(right.draftClassEffectStateId)
    ),
    productiveDelayPolicy: {
      ...unparsedContent.productiveDelayPolicy,
      categoryDelayDistributions: [
        ...unparsedContent.productiveDelayPolicy.categoryDelayDistributions,
      ]
        .map((distribution) => ({
          ...distribution,
          delayStates: [...distribution.delayStates].sort(
            (left, right) => left.productiveDelaySeasons - right.productiveDelaySeasons
          ),
        }))
        .sort(
          (left, right) =>
            AFL_TRADE_PICK_OUTCOME_CATEGORIES.indexOf(left.category) -
            AFL_TRADE_PICK_OUTCOME_CATEGORIES.indexOf(right.category)
        ),
      footballTimingWeights: [...unparsedContent.productiveDelayPolicy.footballTimingWeights].sort(
        (left, right) => left.totalDelaySeasons - right.totalDelaySeasons
      ),
    },
  });
  return aflTradeFuturePickScenarioSchema.parse({
    futurePickScenarioId: createAflTradeContentAddress('future-pick-scenario', content),
    content,
  });
}
