import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  categoryForAflTradePickPav,
  createAflTradePickPavObservation,
  createAflTradePickPavObservationSet,
  createAflTradePickPavPolicy,
  aflTradePickPavObservationSetSchema,
  aflTradePickOutcomeObservationSchema,
  aflTradePickOutcomeObservationSetContentSchema,
  aflTradePickOutcomeObservationSetSchema,
  createAflTradePickOutcomeObservationSet,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSetContent,
  type AflTradePickPavObservation,
} from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);
const partitionYears = {
  train: 2000,
  calibration: 2004,
  validation: 2008,
  final_test: 2012,
} as const;

function observation(
  partition: keyof typeof partitionYears,
  overrides: Partial<AflTradePickOutcomeObservation> = {}
): AflTradePickOutcomeObservation {
  const draftYear = partitionYears[partition];
  const outcomeHorizonEndsAt = `${draftYear + 2}-12-31T00:00:00.000Z`;
  return {
    observationId: `fixture-pick-observation-${partition}`,
    playerId: `fixture-draftee-${partition}`,
    draftClassId: `fixture-draft-class-${draftYear}`,
    draftYear,
    partition,
    predictionCutoffAt: `${draftYear}-01-01T00:00:00.000Z`,
    selectionKnownAt: `${draftYear - 1}-12-31T00:00:00.000Z`,
    outcomeHorizonEndsAt,
    outcomeObservedAt: `${draftYear + 3}-01-01T00:00:00.000Z`,
    selection: {
      pathway: 'national',
      access: 'open',
      nominalSelectionNumber: 10,
      actualSelectionNumber: 12,
      bidSelectionNumber: null,
      draftRound: 1,
    },
    era: 'fixture-era',
    playerPosition: 'midfielder',
    ageAtDraft: 18.5,
    evidenceQuality: 'high',
    outcome: {
      state: 'mature_observed',
      contribution: 25,
      gamesPlayed: 30,
      category: 'regular_contributor',
    },
    ...overrides,
  };
}

function content(): AflTradePickOutcomeObservationSetContent {
  return {
    schemaVersion: 'afl-trade-pick-observation-set/v1',
    publicAssetBoundary: 'source_native_afl_draft_selection_no_fantasy_ownership',
    datasetId: `dataset:${digest('1')}`,
    modelProtocolId: `model-protocol:${digest('2')}`,
    valueUnitId: 'fixture-contribution-unit',
    fixedHorizonSeasons: 2,
    fixedHorizonDefinitionArtifactId: `artifact:${digest('3')}`,
    outcomeDefinitionArtifactId: `artifact:${digest('4')}`,
    curveEligibility: 'open_access_national_draft_actual_selection_only',
    observations: [
      observation('train'),
      observation('calibration'),
      observation('validation'),
      observation('final_test', {
        outcomeObservedAt: '2013-01-01T00:00:00.000Z',
        outcome: {
          state: 'right_censored',
          contributionObservedToDate: 8,
          gamesObservedToDate: 12,
          censoredAt: '2013-01-01T00:00:00.000Z',
        },
      }),
    ],
  };
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;

function pavPolicy() {
  return createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'fixture-v1',
    supportedPathway: 'national',
    supportedAccess: 'open',
    firstOutcomeSeasonOffset: 1,
    fixedHorizonSeasons: 1,
    methodId: addressed('hpn-pav-method', 'e'),
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 10,
      regularContributor: 30,
      highQuality: 60,
      elite: 90,
    },
    partitions: (
      Object.entries(partitionYears) as Array<[keyof typeof partitionYears, number]>
    ).map(([role, year]) => ({ role, fromDraftYear: year, throughDraftYear: year })),
    approvalDecision: { id: addressed('review-decision', 'a'), sha256: sha('a') },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function pavObservation(
  partition: keyof typeof partitionYears,
  ordinal: number,
  overrides: Partial<AflTradePickPavObservation> = {}
): AflTradePickPavObservation {
  const draftYear = partitionYears[partition];
  const calculationId = addressed('hpn-pav-season', String(ordinal));
  const selectionId = addressed('draft-selection', String.fromCharCode(96 + ordinal));
  const base = {
    ordinal,
    partition,
    predictionCutoffAt: `${draftYear}-11-20T23:59:59.999Z`,
    outcomeHorizonEndsAt: `${draftYear + 1}-12-31T23:59:59.000Z`,
    outcomeObservedAt: `${draftYear + 2}-01-01T00:00:00.000Z`,
    selection: {
      releaseId: addressed('outcome-release', 'f'),
      selectionId,
      eventId: `draft:${draftYear}:national`,
      eventVersionId: addressed('event-version', String.fromCharCode(64 + ordinal)),
      eventDate: `${draftYear}-11-20`,
      recordedAt: `${draftYear}-11-21T00:00:00.000Z`,
      draftYear,
      pathway: 'national' as const,
      actualSelectionNumber: ordinal === 1 ? 14 : ordinal + 20,
      nominalSelectionNumber: ordinal === 1 ? 14 : ordinal + 20,
      draftRound: ordinal === 1 ? 1 : 2,
      pickId: `pick:${draftYear}:national:${ordinal === 1 ? 14 : ordinal + 20}`,
      playerId: `player:${partition}`,
      clubId: `club:${partition}`,
      access: {
        state: 'open' as const,
        decision: {
          id: addressed('review-decision', String.fromCharCode(102 + ordinal)),
          sha256: sha(String.fromCharCode(102 + ordinal)),
        },
        recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
      },
    },
    requiredCalculationSeasons: [draftYear + 1],
    calculationIds: [calculationId],
    playerValues: [
      {
        calculationId,
        calculationSha256: calculationId.split(':')[1]!,
        seasonYear: draftYear + 1,
        spellVersionId: addressed('acquisition-spell-version', String.fromCharCode(106 + ordinal)),
        playerId: `player:${partition}`,
        playerSha256: sha(String.fromCharCode(110 + ordinal)),
        clubId: `club:${partition}`,
        sourceRowIds: [`decoded-row:${partition}:1`, `decoded-row:${partition}:2`],
        gamesPlayed: 2,
        totalPav: ordinal === 1 ? 66 : 40,
      },
    ],
    outcome: {
      state: 'mature_observed' as const,
      contribution: ordinal === 1 ? 66 : 40,
      gamesPlayed: 2,
      category: ordinal === 1 ? ('high_quality' as const) : ('regular_contributor' as const),
    },
    ...overrides,
  };
  return createAflTradePickPavObservation(base);
}

function pavSet() {
  const policy = pavPolicy();
  const observations = (Object.keys(partitionYears) as Array<keyof typeof partitionYears>).map(
    (partition, index) => pavObservation(partition, index + 1)
  );
  const calculations = observations.map((item) => ({
    calculationId: item.calculationIds[0]!,
    calculationSha256: item.calculationIds[0]!.split(':')[1]!,
    inputSetId: addressed('hpn-pav-input-set', String.fromCharCode(114 + item.ordinal)),
    methodId: addressed('hpn-pav-method', 'e'),
    seasonYear: item.requiredCalculationSeasons[0]!,
    effectiveThrough: item.outcomeHorizonEndsAt,
    calculatedAt: item.outcomeObservedAt,
  }));
  return createAflTradePickPavObservationSet({
    schemaVersion: 'afl-trade-pick-pav-observation-set/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2014-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2014-01-01T00:00:00.000Z',
    releaseId: addressed('outcome-release', 'f'),
    policy,
    calculations,
    draftClasses: observations.map((item) => ({
      draftYear: item.selection.draftYear,
      pathway: item.selection.pathway,
      expectedSelectionCount: 1,
      observationCount: 1,
    })),
    observations,
    observationCount: observations.length,
    observationSetSha256: digest('0'),
  });
}

describe('AFL trade-intelligence pick-outcome contracts', () => {
  it('creates an order-normalized public fixed-horizon observation set', () => {
    const forward = createAflTradePickOutcomeObservationSet(content());
    const reverse = createAflTradePickOutcomeObservationSet({
      ...content(),
      observations: [...content().observations].reverse(),
    });

    expect(forward).toEqual(reverse);
    expect(forward.observationSetId).toMatch(/^pick-observation-set:[a-f0-9]{64}$/);
    expect(forward.content.publicAssetBoundary).toContain('no_fantasy_ownership');
    expect(AFL_TRADE_PICK_OUTCOME_CATEGORIES).toEqual([
      'no_afl_game',
      'short_career',
      'replacement_level',
      'regular_contributor',
      'high_quality',
      'elite',
    ]);
  });

  it('rejects selection hindsight and labels observed before maturity', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selectionKnownAt: '2000-02-01T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcomeObservedAt: '2002-01-01T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: {
          state: 'right_censored',
          contributionObservedToDate: 1,
          gamesObservedToDate: 1,
          censoredAt: '2003-01-01T00:00:00.000Z',
        },
      }).success
    ).toBe(false);
  });

  it('keeps no-game, zero, unavailable, and other outcomes distinct', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: {
          state: 'mature_observed',
          contribution: 1,
          gamesPlayed: 0,
          category: 'no_afl_game',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: {
          state: 'mature_observed',
          contribution: 0,
          gamesPlayed: 0,
          category: 'replacement_level',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: { state: 'unavailable', reason: 'source_missing' },
      }).success
    ).toBe(true);
  });

  it('enforces national, bid-matched, and pathway position semantics', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: { ...base.selection, actualSelectionNumber: null },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: { ...base.selection, bidSelectionNumber: 8 },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: {
          ...base.selection,
          access: 'father_son_bid_match',
          bidSelectionNumber: null,
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: {
          ...base.selection,
          pathway: 'rookie',
          access: 'father_son_bid_match',
          bidSelectionNumber: 8,
        },
      }).success
    ).toBe(false);
  });

  it('rejects duplicate identities and non-bijective draft-class years', () => {
    const set = content();
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: [
          set.observations[0],
          { ...set.observations[1], observationId: set.observations[0].observationId },
          set.observations[2],
          set.observations[3],
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.map((item) =>
          item.partition === 'calibration'
            ? { ...item, draftClassId: set.observations[0].draftClassId }
            : item
        ),
      }).success
    ).toBe(false);
  });

  it('partitions and censors whole draft classes rather than selected players', () => {
    const set = content();
    const extra = observation('train', {
      observationId: 'fixture-pick-observation-train-extra',
      playerId: 'fixture-draftee-train-extra',
      outcome: {
        state: 'right_censored',
        contributionObservedToDate: 3,
        gamesObservedToDate: 4,
        censoredAt: '2001-01-01T00:00:00.000Z',
      },
      outcomeObservedAt: '2001-01-01T00:00:00.000Z',
    });
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: [...set.observations, extra],
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: [
          ...set.observations,
          {
            ...observation('train'),
            observationId: 'fixture-pick-observation-split',
            playerId: 'fixture-draftee-split',
            partition: 'calibration',
          },
        ],
      }).success
    ).toBe(false);
  });

  it('requires every chronological partition and purges labels before the next cohort', () => {
    const set = content();
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.filter(({ partition }) => partition !== 'calibration'),
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.map((item) =>
          item.partition === 'train'
            ? { ...item, outcomeObservedAt: '2004-01-01T00:00:00.000Z' }
            : item
        ),
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership fields and detects content mutation', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...content(),
        ownerId: 'fixture-owner',
        rosterId: 'fixture-roster',
      }).success
    ).toBe(false);

    const set = createAflTradePickOutcomeObservationSet(content());
    expect(
      aflTradePickOutcomeObservationSetSchema.safeParse({
        ...set,
        content: { ...set.content, fixedHorizonSeasons: 3 },
      }).success
    ).toBe(false);
  });

  it('seals exact released selections and finalized PAV evidence without pick buckets', () => {
    const set = pavSet();
    const reversed = createAflTradePickPavObservationSet({
      ...set.content,
      observations: [...set.content.observations].reverse(),
    });
    const pick14 = set.content.observations.find(
      ({ selection }) => selection.actualSelectionNumber === 14
    );

    expect(pick14?.selection.nominalSelectionNumber).toBe(14);
    expect(pick14?.outcome).toEqual({
      state: 'mature_observed',
      contribution: 66,
      gamesPlayed: 2,
      category: 'high_quality',
    });
    expect(set.content.policy.content.outcomeValueUnit).toBe('fixed_horizon_pav');
    expect(set.content.policy.content).not.toHaveProperty('hpnCareerPav');
    expect(set.observationSetId).toMatch(/^pick-pav-observation-set:[a-f0-9]{64}$/);
    expect(reversed).toEqual(set);

    if (!pick14 || pick14.selection.access.state !== 'open') {
      throw new Error('Fixture pick 14 must have open selection access.');
    }
    const { observationId: _observationId, ...historicalContent } = pick14;
    const historicalAccess = pick14.selection.access;
    const modernCustody = createAflTradePickPavObservation({
      ...historicalContent,
      outcomeObservedAt: '2026-08-10T00:00:00.000Z',
      selection: {
        ...historicalContent.selection,
        recordedAt: '2026-08-09T00:00:00.000Z',
        access: {
          ...historicalAccess,
          recordedAt: '2026-08-09T01:00:00.000Z',
        },
      },
    });
    expect(modernCustody.predictionCutoffAt).toBe('2000-11-20T23:59:59.999Z');
  });

  it('keeps HPN career-PAV comparison separate and applies reviewed Statly categories', () => {
    const minimums = pavPolicy().content.categoryMinimums;
    expect(categoryForAflTradePickPav(0, 0, minimums)).toBe('no_afl_game');
    expect(categoryForAflTradePickPav(9, 1, minimums)).toBe('short_career');
    expect(categoryForAflTradePickPav(66, 2, minimums)).toBe('high_quality');
  });

  it('rejects incomplete mature horizons and selected-player value substitution', () => {
    const set = pavSet();
    const first = set.content.observations[0]!;
    expect(
      aflTradePickPavObservationSetSchema.safeParse({
        ...set,
        content: {
          ...set.content,
          observations: [
            {
              ...first,
              calculationIds: [],
              playerValues: [],
              outcome: { ...first.outcome, contribution: 0, gamesPlayed: 0 },
            },
            ...set.content.observations.slice(1),
          ],
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickPavObservationSetSchema.safeParse({
        ...set,
        content: {
          ...set.content,
          observations: [
            {
              ...first,
              playerValues: first.playerValues.map((value) => ({
                ...value,
                totalPav: value.totalPav + 20,
              })),
            },
            ...set.content.observations.slice(1),
          ],
        },
      }).success
    ).toBe(false);
    const { observationId: _observationId, ...firstContent } = first;
    expect(() =>
      createAflTradePickPavObservation({
        ...firstContent,
        playerValues: first.playerValues.map((value) => ({
          ...value,
          playerId: 'player:substituted',
        })),
      })
    ).toThrow();
  });

  it('rejects unresolved access masquerading as an eligible mature observation', () => {
    const set = pavSet();
    const first = set.content.observations[0]!;
    expect(
      aflTradePickPavObservationSetSchema.safeParse({
        ...set,
        content: {
          ...set.content,
          observations: [
            {
              ...first,
              selection: {
                ...first.selection,
                access: { state: 'unresolved', reason: 'not-reviewed' },
              },
            },
            ...set.content.observations.slice(1),
          ],
        },
      }).success
    ).toBe(false);
  });
});
