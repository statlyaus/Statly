// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
  AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
  AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
  AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
  aflTradeJointOutcomeBoundsSchema,
  aflTradeJointOutcomeComparisonInputSchema,
  aflTradeJointOutcomeComparisonSchema,
  aflTradeJointOutcomeProbabilitiesSchema,
  calculateAflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparisonInput,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparison';

const CLUB_IDS = ['club-a', 'club-b', 'club-c'] as const;
type PathSegment = string | number;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setAtPath(target: unknown, path: readonly PathSegment[], replacement: unknown): void {
  let cursor: unknown = target;
  for (const segment of path.slice(0, -1)) {
    if (cursor === null || typeof cursor !== 'object') {
      throw new Error(`Cannot traverse contract fixture path ${path.join('.')}.`);
    }
    cursor = (cursor as Record<PathSegment, unknown>)[segment];
  }
  if (cursor === null || typeof cursor !== 'object') {
    throw new Error(`Cannot mutate contract fixture path ${path.join('.')}.`);
  }
  (cursor as Record<PathSegment, unknown>)[path.at(-1)!] = replacement;
}

function availableInput(): AflTradeJointOutcomeComparisonInput {
  return {
    inputSchemaVersion: AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
    outcomeDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
    valueUnitId: 'fixture-contribution-unit',
    valueScale: {
      definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
      decimalPlaces: 2,
    },
    aflClubIds: [...CLUB_IDS],
    clearLeaderToleranceQuanta: 10,
    draws: [
      {
        drawKey: 'draw-a',
        probabilityWeight: 1,
        parties: [
          { aflClubId: 'club-a', observation: { status: 'available', valueQuanta: 100 } },
          { aflClubId: 'club-b', observation: { status: 'available', valueQuanta: 80 } },
          { aflClubId: 'club-c', observation: { status: 'available', valueQuanta: 0 } },
        ],
      },
    ],
  };
}

function unavailableInput(): AflTradeJointOutcomeComparisonInput {
  const input = availableInput();
  return {
    ...input,
    draws: [
      { ...input.draws[0], probabilityWeight: 0.6 },
      {
        drawKey: 'draw-b',
        probabilityWeight: 0.4,
        parties: [
          { aflClubId: 'club-a', observation: { status: 'available', valueQuanta: 90 } },
          { aflClubId: 'club-b', observation: { status: 'available', valueQuanta: 70 } },
          {
            aflClubId: 'club-c',
            observation: { status: 'unavailable', reasonCodes: ['source-missing'] },
          },
        ],
      },
    ],
  };
}

const availableResult = (): AflTradeJointOutcomeComparison =>
  calculateAflTradeJointOutcomeComparison(availableInput());
const unavailableResult = (): AflTradeJointOutcomeComparison =>
  calculateAflTradeJointOutcomeComparison(unavailableInput());

describe('AFL trade-intelligence joint-outcome comparison contracts', () => {
  it('accepts canonical available and structurally unavailable inputs and results', () => {
    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(availableInput()).success).toBe(
      true
    );
    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(unavailableInput()).success).toBe(
      true
    );
    expect(aflTradeJointOutcomeComparisonSchema.safeParse(availableResult()).success).toBe(true);
    expect(aflTradeJointOutcomeComparisonSchema.safeParse(unavailableResult()).success).toBe(true);
  });

  it('rejects the former ambiguous leader-margin field in input and result contracts', () => {
    const legacyInput = clone(availableInput()) as unknown as Record<string, unknown>;
    delete legacyInput.clearLeaderToleranceQuanta;
    legacyInput.minimumClearLeaderMarginQuanta = 10;

    const legacyResult = clone(availableResult()) as unknown as Record<string, unknown>;
    delete legacyResult.clearLeaderToleranceQuanta;
    legacyResult.minimumClearLeaderMarginQuanta = 10;

    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(legacyInput).success).toBe(false);
    expect(aflTradeJointOutcomeComparisonSchema.safeParse(legacyResult).success).toBe(false);
  });

  it.each([
    {
      name: 'input schema version',
      make: availableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['inputSchemaVersion'], 'input/v2'),
    },
    {
      name: 'public AFL asset boundary',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['publicAssetBoundary'], 'fantasy-owned-assets'),
    },
    {
      name: 'universal-value scope',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['comparisonValueScope'], 'club-utility'),
    },
    {
      name: 'outcome definition version',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['outcomeDefinitionVersion'], 'unversioned-comparison'),
    },
    {
      name: 'value-scale definition',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['valueScale', 'definitionVersion'], 'floating-point-values'),
    },
    {
      name: 'value-scale decimal-place ceiling',
      make: availableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['valueScale', 'decimalPlaces'], 10),
    },
    {
      name: 'canonical AFL club ordering',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['aflClubIds'], ['club-b', 'club-a', 'club-c']),
    },
    {
      name: 'unique AFL clubs',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['aflClubIds'], ['club-a', 'club-a', 'club-c']),
    },
    {
      name: 'at least two AFL clubs',
      make: availableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['aflClubIds'], ['club-a']),
    },
    {
      name: 'no more than eighteen AFL clubs',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(
          candidate,
          ['aflClubIds'],
          Array.from({ length: 19 }, (_, index) => `club-${String(index).padStart(2, '0')}`)
        ),
    },
    {
      name: 'unique draw keys',
      make: unavailableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['draws', 1, 'drawKey'], 'draw-a'),
    },
    {
      name: 'positive draw weights',
      make: availableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['draws', 0, 'probabilityWeight'], 0),
    },
    {
      name: 'draw weights summing to one',
      make: availableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['draws', 0, 'probabilityWeight'], 0.99),
    },
    {
      name: 'complete party coverage',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(
          candidate,
          ['draws', 0, 'parties'],
          availableInput().draws[0].parties.slice(0, 2)
        ),
    },
    {
      name: 'canonical party ordering',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(
          candidate,
          ['draws', 0, 'parties'],
          [...availableInput().draws[0].parties].reverse()
        ),
    },
    {
      name: 'safe-integer observation quanta',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(
          candidate,
          ['draws', 0, 'parties', 0, 'observation', 'valueQuanta'],
          Number.MAX_SAFE_INTEGER + 1
        ),
    },
    {
      name: 'integer observation quanta',
      make: availableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['draws', 0, 'parties', 0, 'observation', 'valueQuanta'], 1.5),
    },
    {
      name: 'nonnegative clear-leader tolerance',
      make: availableInput,
      mutate: (candidate: unknown) => setAtPath(candidate, ['clearLeaderToleranceQuanta'], -1),
    },
    {
      name: 'canonical unavailable reasons',
      make: unavailableInput,
      mutate: (candidate: unknown) =>
        setAtPath(
          candidate,
          ['draws', 1, 'parties', 2, 'observation', 'reasonCodes'],
          ['reason-b', 'reason-a']
        ),
    },
    {
      name: 'unique unavailable reasons',
      make: unavailableInput,
      mutate: (candidate: unknown) =>
        setAtPath(
          candidate,
          ['draws', 1, 'parties', 2, 'observation', 'reasonCodes'],
          ['reason-a', 'reason-a']
        ),
    },
    {
      name: 'at least one unavailable reason',
      make: unavailableInput,
      mutate: (candidate: unknown) =>
        setAtPath(candidate, ['draws', 1, 'parties', 2, 'observation', 'reasonCodes'], []),
    },
  ])('rejects an invalid $name', ({ make, mutate }) => {
    const candidate = clone(make());
    mutate(candidate);
    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(candidate).success).toBe(false);
  });

  it('accepts and rejects total draw weights on the intended side of the normalization tolerance', () => {
    const candidate = unavailableInput();
    candidate.draws[0].probabilityWeight = 0.5;
    candidate.draws[1].probabilityWeight = 0.500000009;
    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(candidate).success).toBe(true);

    candidate.draws[1].probabilityWeight = 0.500000011;
    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    { location: 'input root', path: ['userId'], value: 'user-1' },
    { location: 'value scale', path: ['valueScale', 'ownerId'], value: 'owner-1' },
    { location: 'draw', path: ['draws', 0, 'fantasyLeagueId'], value: 'league-1' },
    {
      location: 'party',
      path: ['draws', 0, 'parties', 0, 'fantasyTeamId'],
      value: 'fantasy-team-1',
    },
    {
      location: 'observation',
      path: ['draws', 0, 'parties', 0, 'observation', 'rosterOwnerId'],
      value: 'roster-owner-1',
    },
    {
      location: 'unavailable observation',
      path: ['draws', 1, 'parties', 2, 'observation', 'ownership'],
      value: { userId: 'user-1' },
      make: unavailableInput,
    },
  ])('rejects fantasy or user ownership data at the $location', ({ path, value, make }) => {
    const candidate = clone(make ? make() : availableInput());
    setAtPath(candidate, path, value);
    expect(aflTradeJointOutcomeComparisonInputSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    { location: 'result root', path: ['userId'], value: 'user-1' },
    { location: 'result value scale', path: ['valueScale', 'ownerId'], value: 'owner-1' },
    {
      location: 'probability group',
      path: ['probabilities', 'fantasyLeagueId'],
      value: 'league-1',
    },
    {
      location: 'club probability',
      path: ['probabilities', 'clubClearLeaderProbabilities', 0, 'fantasyTeamId'],
      value: 'fantasy-team-1',
    },
    {
      location: 'bounds group',
      path: ['unconditionalBounds', 'rosterOwnerId'],
      value: 'roster-owner-1',
    },
    {
      location: 'club bound',
      path: ['unconditionalBounds', 'clubClearLeaderBounds', 0, 'ownership'],
      value: { userId: 'user-1' },
    },
    {
      location: 'no-clear-leader bound',
      path: ['unconditionalBounds', 'noClearLeaderBounds', 'ownerId'],
      value: 'owner-1',
    },
  ])('rejects fantasy or user ownership data at the $location', ({ path, value }) => {
    const candidate = clone(availableResult());
    setAtPath(candidate, path, value);
    expect(aflTradeJointOutcomeComparisonSchema.safeParse(candidate).success).toBe(false);
  });

  it('validates exported probability and bounds fragments independently', () => {
    const result = availableResult();
    if (result.status !== 'available') throw new Error('Expected an available fixture result.');

    expect(aflTradeJointOutcomeProbabilitiesSchema.parse(result.probabilities)).toEqual(
      result.probabilities
    );
    expect(aflTradeJointOutcomeBoundsSchema.parse(result.unconditionalBounds)).toEqual(
      result.unconditionalBounds
    );

    const duplicateProbabilities = clone(result.probabilities);
    duplicateProbabilities.clubClearLeaderProbabilities[1].aflClubId = 'club-a';
    expect(aflTradeJointOutcomeProbabilitiesSchema.safeParse(duplicateProbabilities).success).toBe(
      false
    );

    const reversedProbabilities = clone(result.probabilities);
    reversedProbabilities.clubClearLeaderProbabilities.reverse();
    expect(aflTradeJointOutcomeProbabilitiesSchema.safeParse(reversedProbabilities).success).toBe(
      false
    );

    const duplicateBounds = clone(result.unconditionalBounds);
    duplicateBounds.clubClearLeaderBounds[1].aflClubId = 'club-a';
    expect(aflTradeJointOutcomeBoundsSchema.safeParse(duplicateBounds).success).toBe(false);

    const reversedBounds = clone(result.unconditionalBounds);
    reversedBounds.clubClearLeaderBounds.reverse();
    expect(aflTradeJointOutcomeBoundsSchema.safeParse(reversedBounds).success).toBe(false);

    expect(
      aflTradeJointOutcomeProbabilitiesSchema.safeParse({
        ...result.probabilities,
        fantasyLeagueId: 'league-1',
      }).success
    ).toBe(false);
    expect(
      aflTradeJointOutcomeBoundsSchema.safeParse({
        ...result.unconditionalBounds,
        ownerId: 'owner-1',
      }).success
    ).toBe(false);
  });

  it.each([
    {
      name: 'available input',
      schema: aflTradeJointOutcomeComparisonInputSchema,
      make: availableInput,
    },
    {
      name: 'unavailable input',
      schema: aflTradeJointOutcomeComparisonInputSchema,
      make: unavailableInput,
    },
    {
      name: 'available result',
      schema: aflTradeJointOutcomeComparisonSchema,
      make: availableResult,
    },
    {
      name: 'unavailable result',
      schema: aflTradeJointOutcomeComparisonSchema,
      make: unavailableResult,
    },
  ])('round-trips a canonical $name through JSON and runtime validation', ({ schema, make }) => {
    const original = make();
    const serialized = JSON.stringify(original);
    const roundTripped: unknown = JSON.parse(serialized);
    expect(schema.parse(roundTripped)).toEqual(original);
  });

  it.each([
    {
      state: 'available',
      name: 'result schema version',
      make: availableResult,
      path: ['schemaVersion'],
      value: 'afl-trade-joint-outcome-comparison/v2',
    },
    {
      state: 'available',
      name: 'public asset boundary',
      make: availableResult,
      path: ['publicAssetBoundary'],
      value: 'fantasy-owned-assets',
    },
    {
      state: 'available',
      name: 'comparison value scope',
      make: availableResult,
      path: ['comparisonValueScope'],
      value: 'club-utility',
    },
    {
      state: 'available',
      name: 'outcome definition version',
      make: availableResult,
      path: ['outcomeDefinitionVersion'],
      value: 'unversioned-comparison',
    },
    {
      state: 'available',
      name: 'bounds definition version',
      make: availableResult,
      path: ['boundsDefinitionVersion'],
      value: 'unbounded-missingness',
    },
    {
      state: 'available',
      name: 'value-unit identifier',
      make: availableResult,
      path: ['valueUnitId'],
      value: 'not a valid identifier',
    },
    {
      state: 'available',
      name: 'value-scale version',
      make: availableResult,
      path: ['valueScale', 'definitionVersion'],
      value: 'floating-point-values',
    },
    {
      state: 'available',
      name: 'value-scale precision',
      make: availableResult,
      path: ['valueScale', 'decimalPlaces'],
      value: 10,
    },
    {
      state: 'available',
      name: 'clear-leader tolerance',
      make: availableResult,
      path: ['clearLeaderToleranceQuanta'],
      value: -1,
    },
    {
      state: 'available',
      name: 'canonical result clubs',
      make: availableResult,
      path: ['aflClubIds'],
      value: ['club-b', 'club-a', 'club-c'],
    },
    {
      state: 'available',
      name: 'draw-count reconciliation',
      make: availableResult,
      path: ['drawCount'],
      value: 2,
    },
    {
      state: 'available',
      name: 'available draw count',
      make: availableResult,
      path: ['availableDrawCount'],
      value: 0,
    },
    {
      state: 'available',
      name: 'unavailable draw count',
      make: availableResult,
      path: ['unavailableDrawCount'],
      value: 1,
    },
    {
      state: 'available',
      name: 'available probability mass',
      make: availableResult,
      path: ['availableProbabilityMass'],
      value: 0.9,
    },
    {
      state: 'available',
      name: 'unavailable probability mass',
      make: availableResult,
      path: ['unavailableProbabilityMass'],
      value: 0.1,
    },
    {
      state: 'available',
      name: 'exhaustive probability sum',
      make: availableResult,
      path: ['probabilities', 'clubClearLeaderProbabilities', 0, 'probability'],
      value: 0.9,
    },
    {
      state: 'available',
      name: 'probability club alignment',
      make: availableResult,
      path: ['probabilities', 'clubClearLeaderProbabilities', 0, 'aflClubId'],
      value: 'club-z',
    },
    {
      state: 'available',
      name: 'conditional-probability null rule',
      make: availableResult,
      path: ['conditionalOnAvailableProbabilities'],
      value: {
        clubClearLeaderProbabilities: [
          { aflClubId: 'club-a', probability: 1 },
          { aflClubId: 'club-b', probability: 0 },
          { aflClubId: 'club-c', probability: 0 },
        ],
        noClearLeaderProbability: 0,
      },
    },
    {
      state: 'available',
      name: 'club probability bounds',
      make: availableResult,
      path: ['unconditionalBounds', 'clubClearLeaderBounds', 0, 'lower'],
      value: 0.9,
    },
    {
      state: 'available',
      name: 'available reason-code rule',
      make: availableResult,
      path: ['reasonCodes'],
      value: ['unexpected-reason'],
    },
    {
      state: 'unavailable',
      name: 'probability-mass reconciliation',
      make: unavailableResult,
      path: ['availableProbabilityMass'],
      value: 0.5,
    },
    {
      state: 'unavailable',
      name: 'positive unavailable mass',
      make: unavailableResult,
      path: ['unavailableProbabilityMass'],
      value: 0,
    },
    {
      state: 'unavailable',
      name: 'positive unavailable draw count',
      make: unavailableResult,
      path: ['unavailableDrawCount'],
      value: 0,
    },
    {
      state: 'unavailable',
      name: 'partial conditional probabilities',
      make: unavailableResult,
      path: ['conditionalOnAvailableProbabilities'],
      value: null,
    },
    {
      state: 'unavailable',
      name: 'unconditional complete probabilities',
      make: unavailableResult,
      path: ['probabilities'],
      value: {
        clubClearLeaderProbabilities: [
          { aflClubId: 'club-a', probability: 1 },
          { aflClubId: 'club-b', probability: 0 },
          { aflClubId: 'club-c', probability: 0 },
        ],
        noClearLeaderProbability: 0,
      },
    },
    {
      state: 'unavailable',
      name: 'unavailable reason presence',
      make: unavailableResult,
      path: ['reasonCodes'],
      value: [],
    },
    {
      state: 'unavailable',
      name: 'canonical unavailable reasons',
      make: unavailableResult,
      path: ['reasonCodes'],
      value: ['reason-b', 'reason-a'],
    },
    {
      state: 'unavailable',
      name: 'unique unavailable reasons',
      make: unavailableResult,
      path: ['reasonCodes'],
      value: ['reason-a', 'reason-a'],
    },
    {
      state: 'unavailable',
      name: 'unavailable reason ceiling',
      make: unavailableResult,
      path: ['reasonCodes'],
      value: Array.from({ length: 101 }, (_, index) => `reason-${String(index).padStart(3, '0')}`),
    },
    {
      state: 'unavailable',
      name: 'club missing-mass bounds',
      make: unavailableResult,
      path: ['unconditionalBounds', 'clubClearLeaderBounds', 1, 'upper'],
      value: 0.3,
    },
    {
      state: 'unavailable',
      name: 'no-clear-leader missing-mass bounds',
      make: unavailableResult,
      path: ['unconditionalBounds', 'noClearLeaderBounds', 'upper'],
      value: 0.3,
    },
  ])('rejects a tampered $state result with invalid $name', ({ make, path, value }) => {
    const candidate = clone(make());
    setAtPath(candidate, path, value);
    expect(aflTradeJointOutcomeComparisonSchema.safeParse(candidate).success).toBe(false);
  });
});
