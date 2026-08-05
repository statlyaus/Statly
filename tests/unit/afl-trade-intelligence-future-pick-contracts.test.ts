import { describe, expect, it } from 'vitest';

import {
  aflTradeFuturePickScenarioContentSchema,
  aflTradeFuturePickScenarioSchema,
  createAflTradeFuturePickScenario,
  type AflTradeFuturePickScenarioContent,
} from '@/server/aflTradeIntelligence/modeling/futurePickContracts';
import { AFL_TRADE_PICK_OUTCOME_CATEGORIES } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);

function scenarioContent(): AflTradeFuturePickScenarioContent {
  return {
    schemaVersion: 'afl-trade-future-pick-scenario/v1',
    publicAssetBoundary: 'afl_club_entitlements_no_user_or_fantasy_ownership',
    datasetId: `dataset:${digest('1')}`,
    modelProtocolId: `model-protocol:${digest('2')}`,
    pickBenchmarkFitId: `pick-benchmark-fit:${digest('3')}`,
    valueUnitId: 'fixture-contribution-unit',
    effectiveAt: '2026-08-01T00:00:00.000Z',
    draftYear: 2027,
    ladderInputArtifactId: `artifact:${digest('4')}`,
    ladderInputKnownAt: '2026-07-31T00:00:00.000Z',
    pickCurveMinimumSelection: 1,
    pickCurveMaximumSelection: 5,
    ladderStates: [
      {
        ladderStateId: 'ladder-a',
        probability: 0.6,
        clubPositions: [
          { aflClubId: 'afl-club-a', finishingPosition: 1 },
          { aflClubId: 'afl-club-b', finishingPosition: 2 },
        ],
      },
      {
        ladderStateId: 'ladder-b',
        probability: 0.4,
        clubPositions: [
          { aflClubId: 'afl-club-a', finishingPosition: 2 },
          { aflClubId: 'afl-club-b', finishingPosition: 1 },
        ],
      },
    ],
    ruleVintage: {
      ruleVintageArtifactId: `artifact:${digest('5')}`,
      knownAt: '2026-07-01T00:00:00.000Z',
      effectiveDraftYearFrom: 2027,
      effectiveDraftYearTo: 2027,
      aflClubCount: 2,
      supportedRounds: 2,
      nominalOrderRule: 'reverse_final_ladder_within_round',
      adjustmentResolution: 'joint_monotone_nominal_to_actual_state_distribution',
      supportedSelectionAccess: 'open_only',
      resolutionStates: [
        {
          ruleResolutionStateId: 'resolution-base',
          probability: 0.75,
          nominalToActualSelections: [1, 2, 3, 4].map((selection) => ({
            nominalSelectionNumber: selection,
            actualSelectionNumber: selection,
          })),
        },
        {
          ruleResolutionStateId: 'resolution-inserted-pick',
          probability: 0.25,
          nominalToActualSelections: [
            { nominalSelectionNumber: 1, actualSelectionNumber: 1 },
            { nominalSelectionNumber: 2, actualSelectionNumber: 3 },
            { nominalSelectionNumber: 3, actualSelectionNumber: 4 },
            { nominalSelectionNumber: 4, actualSelectionNumber: 5 },
          ],
        },
      ],
    },
    futurePickEntitlements: [
      {
        futurePickAssetId: 'future-pick-a',
        aflClubEntitlementHolderId: 'afl-club-b',
        ladderLinkedAflClubId: 'afl-club-a',
        draftYear: 2027,
        round: 1,
        selectionPathway: 'national',
        selectionAccess: 'open',
        bidSelectionNumber: null,
      },
      {
        futurePickAssetId: 'future-pick-b',
        aflClubEntitlementHolderId: 'afl-club-a',
        ladderLinkedAflClubId: 'afl-club-b',
        draftYear: 2027,
        round: 2,
        selectionPathway: 'national',
        selectionAccess: 'open',
        bidSelectionNumber: null,
      },
    ],
    draftClassEffectModelArtifactId: `artifact:${digest('6')}`,
    draftClassEffectStates: [
      {
        draftClassEffectStateId: 'class-effect-low',
        probability: 0.5,
        contributionMultiplier: 0.8,
      },
      {
        draftClassEffectStateId: 'class-effect-high',
        probability: 0.5,
        contributionMultiplier: 1.2,
      },
    ].sort((left, right) =>
      left.draftClassEffectStateId.localeCompare(right.draftClassEffectStateId)
    ),
    productiveDelayPolicy: {
      productiveDelayModelArtifactId: `artifact:${digest('7')}`,
      footballTimingPolicyArtifactId: `artifact:${digest('8')}`,
      seasonsUntilDraft: 1,
      timingInterpretation: 'football_productivity_timing_only_no_market_impatience',
      categoryDelayDistributions: AFL_TRADE_PICK_OUTCOME_CATEGORIES.map((category) => ({
        category,
        delayStates:
          category === 'no_afl_game'
            ? [{ productiveDelaySeasons: 0, probability: 1 }]
            : category === 'short_career'
              ? [
                  { productiveDelaySeasons: 1, probability: 0.5 },
                  { productiveDelaySeasons: 2, probability: 0.5 },
                ]
              : [
                  {
                    productiveDelaySeasons: category === 'regular_contributor' ? 1 : 0,
                    probability: 1,
                  },
                ],
      })),
      footballTimingWeights: [
        { totalDelaySeasons: 0, footballTimingWeight: 1 },
        { totalDelaySeasons: 1, footballTimingWeight: 0.9 },
        { totalDelaySeasons: 2, footballTimingWeight: 0.8 },
        { totalDelaySeasons: 3, footballTimingWeight: 0.7 },
      ],
    },
    simulationOrder: [
      'joint_ladder_state',
      'rule_vintage_selection_resolution',
      'shared_draft_class_effect',
      'player_outcome',
      'productive_delay',
    ],
    limitation:
      'Scenario contracts provide no source-rights approval, model approval, or deployment approval.',
  };
}

describe('AFL trade-intelligence future-pick scenario contracts', () => {
  it('creates a canonical public-AFL scenario independent of input ordering', () => {
    const content = scenarioContent();
    const forward = createAflTradeFuturePickScenario(content);
    const reverse = createAflTradeFuturePickScenario({
      ...content,
      ladderStates: [...content.ladderStates]
        .reverse()
        .map((state) => ({ ...state, clubPositions: [...state.clubPositions].reverse() })),
      ruleVintage: {
        ...content.ruleVintage,
        resolutionStates: [...content.ruleVintage.resolutionStates].reverse().map((state) => ({
          ...state,
          nominalToActualSelections: [...state.nominalToActualSelections].reverse(),
        })),
      },
      futurePickEntitlements: [...content.futurePickEntitlements].reverse(),
      draftClassEffectStates: [...content.draftClassEffectStates].reverse(),
      productiveDelayPolicy: {
        ...content.productiveDelayPolicy,
        categoryDelayDistributions: [...content.productiveDelayPolicy.categoryDelayDistributions]
          .reverse()
          .map((distribution) => ({
            ...distribution,
            delayStates: [...distribution.delayStates].reverse(),
          })),
        footballTimingWeights: [...content.productiveDelayPolicy.footballTimingWeights].reverse(),
      },
    });

    expect(forward).toEqual(reverse);
    expect(forward.futurePickScenarioId).toMatch(/^future-pick-scenario:[a-f0-9]{64}$/);
    expect(forward.content.publicAssetBoundary).toBe(
      'afl_club_entitlements_no_user_or_fantasy_ownership'
    );
  });

  it('rejects non-joint, incomplete, duplicate, and unnormalized ladder states', () => {
    const content = scenarioContent();
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        ladderStates: [
          ...content.ladderStates.slice(0, 1),
          {
            ...content.ladderStates[1],
            clubPositions: [
              { aflClubId: 'afl-club-a', finishingPosition: 1 },
              { aflClubId: 'afl-club-b', finishingPosition: 1 },
            ],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        ladderStates: content.ladderStates.map((state) => ({ ...state, probability: 0.6 })),
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        ladderStates: content.ladderStates.map((state) => ({
          ...state,
          ladderStateId: 'duplicate',
        })),
      }).success
    ).toBe(false);
  });

  it('rejects incomplete, colliding, backwards, and unnormalized rule-vintage mappings', () => {
    const content = scenarioContent();
    const firstState = content.ruleVintage.resolutionStates[0];
    for (const nominalToActualSelections of [
      firstState.nominalToActualSelections.slice(0, 3),
      [
        { nominalSelectionNumber: 1, actualSelectionNumber: 1 },
        { nominalSelectionNumber: 2, actualSelectionNumber: 1 },
        { nominalSelectionNumber: 3, actualSelectionNumber: 3 },
        { nominalSelectionNumber: 4, actualSelectionNumber: 4 },
      ],
      [
        { nominalSelectionNumber: 1, actualSelectionNumber: 1 },
        { nominalSelectionNumber: 2, actualSelectionNumber: 2 },
        { nominalSelectionNumber: 3, actualSelectionNumber: 2 },
        { nominalSelectionNumber: 4, actualSelectionNumber: 4 },
      ],
    ]) {
      expect(
        aflTradeFuturePickScenarioContentSchema.safeParse({
          ...content,
          ruleVintage: {
            ...content.ruleVintage,
            resolutionStates: [
              { ...firstState, nominalToActualSelections },
              content.ruleVintage.resolutionStates[1],
            ],
          },
        }).success
      ).toBe(false);
    }
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        ruleVintage: {
          ...content.ruleVintage,
          resolutionStates: content.ruleVintage.resolutionStates.map((state) => ({
            ...state,
            probability: 0.75,
          })),
        },
      }).success
    ).toBe(false);
  });

  it('keeps nominal, actual, and bid positions distinct and fails closed on unsupported access', () => {
    const content = scenarioContent();
    expect(content.ruleVintage.resolutionStates[1].nominalToActualSelections[1]).toEqual({
      nominalSelectionNumber: 2,
      actualSelectionNumber: 3,
    });
    expect(
      content.futurePickEntitlements.every(({ bidSelectionNumber }) => bidSelectionNumber === null)
    ).toBe(true);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        futurePickEntitlements: content.futurePickEntitlements.map((entitlement, index) =>
          index === 0
            ? { ...entitlement, selectionAccess: 'academy_bid_match', bidSelectionNumber: 1 }
            : entitlement
        ),
      }).success
    ).toBe(false);
  });

  it('rejects duplicate, wrong-year, unsupported-round, and unknown-club entitlements', () => {
    const content = scenarioContent();
    for (const changedEntitlement of [
      { ...content.futurePickEntitlements[1], futurePickAssetId: 'future-pick-a' },
      { ...content.futurePickEntitlements[1], draftYear: 2028 },
      { ...content.futurePickEntitlements[1], round: 3 },
      { ...content.futurePickEntitlements[1], aflClubEntitlementHolderId: 'unknown-club' },
    ]) {
      expect(
        aflTradeFuturePickScenarioContentSchema.safeParse({
          ...content,
          futurePickEntitlements: [content.futurePickEntitlements[0], changedEntitlement],
        }).success
      ).toBe(false);
    }
  });

  it('prohibits curve extrapolation for every reachable ladder and rule state', () => {
    const content = scenarioContent();
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        pickCurveMaximumSelection: 4,
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        pickCurveMinimumSelection: 2,
      }).success
    ).toBe(false);
  });

  it('rejects incoherent shared effects and market impatience disguised as productive delay', () => {
    const content = scenarioContent();
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        draftClassEffectStates: content.draftClassEffectStates.map((state) => ({
          ...state,
          probability: 0.75,
        })),
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        productiveDelayPolicy: {
          ...content.productiveDelayPolicy,
          timingInterpretation: 'market_discount_rate',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        productiveDelayPolicy: {
          ...content.productiveDelayPolicy,
          footballTimingWeights: content.productiveDelayPolicy.footballTimingWeights.map(
            (weight, index) => (index === 2 ? { ...weight, footballTimingWeight: 0.95 } : weight)
          ),
        },
      }).success
    ).toBe(false);
  });

  it('requires complete category delays with no-game zero delay and normalized probabilities', () => {
    const content = scenarioContent();
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        productiveDelayPolicy: {
          ...content.productiveDelayPolicy,
          categoryDelayDistributions:
            content.productiveDelayPolicy.categoryDelayDistributions.slice(1),
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        productiveDelayPolicy: {
          ...content.productiveDelayPolicy,
          categoryDelayDistributions: content.productiveDelayPolicy.categoryDelayDistributions.map(
            (distribution, index) =>
              index === 0
                ? {
                    ...distribution,
                    delayStates: [{ productiveDelaySeasons: 1, probability: 1 }],
                  }
                : distribution
          ),
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        productiveDelayPolicy: {
          ...content.productiveDelayPolicy,
          categoryDelayDistributions: content.productiveDelayPolicy.categoryDelayDistributions.map(
            (distribution, index) =>
              index === 1
                ? {
                    ...distribution,
                    delayStates: distribution.delayStates.map((state) => ({
                      ...state,
                      probability: 0.6,
                    })),
                  }
                : distribution
          ),
        },
      }).success
    ).toBe(false);
  });

  it('rejects hindsight inputs, reordered causal stages, mutation, and fantasy ownership fields', () => {
    const content = scenarioContent();
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        ladderInputKnownAt: '2026-08-02T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        simulationOrder: [...content.simulationOrder].reverse(),
      }).success
    ).toBe(false);
    expect(
      aflTradeFuturePickScenarioContentSchema.safeParse({
        ...content,
        userId: 'fantasy-user',
        fantasyLeagueId: 'fantasy-league',
      }).success
    ).toBe(false);

    const scenario = createAflTradeFuturePickScenario(content);
    expect(
      aflTradeFuturePickScenarioSchema.safeParse({
        ...scenario,
        content: { ...scenario.content, draftYear: 2028 },
      }).success
    ).toBe(false);
  });
});
