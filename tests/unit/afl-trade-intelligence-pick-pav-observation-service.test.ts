import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const draftYears = [2000, 2004, 2008, 2012] as const;

function policy(calibrationYear = 2004) {
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
    fixedHorizonSeasons: 2,
    methodId: addressed('hpn-pav-method', 'hpn-v1'),
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 10,
      regularContributor: 30,
      highQuality: 60,
      elite: 90,
    },
    partitions: ['train', 'calibration', 'validation', 'final_test'].map((role, index) => {
      const year = index === 1 ? calibrationYear : draftYears[index]!;
      return {
        role: role as 'train' | 'calibration' | 'validation' | 'final_test',
        fromDraftYear: year,
        throughDraftYear: year,
      };
    }),
    approvalDecision: {
      id: addressed('review-decision', 'pick-pav-policy'),
      sha256: sha('pick-pav-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function selection(draftYear: number, access: 'open' | 'unresolved' = 'open') {
  const selectionNumber = draftYear === 2000 ? 14 : 20 + draftYears.indexOf(draftYear as never);
  return {
    releaseId: addressed('outcome-release', 'released-draft-history'),
    selectionId: addressed('draft-selection', `${draftYear}:${selectionNumber}`),
    eventId: `draft:${draftYear}:national`,
    eventVersionId: addressed('event-version', `draft:${draftYear}:national`),
    eventDate: `${draftYear}-11-20`,
    recordedAt: `${draftYear}-11-21T00:00:00.000Z`,
    draftYear,
    pathway: 'national' as const,
    actualSelectionNumber: selectionNumber,
    nominalSelectionNumber: selectionNumber,
    draftRound: selectionNumber <= 20 ? 1 : 2,
    pickId: `pick:${draftYear}:national:${selectionNumber}`,
    playerId: `player:${draftYear}`,
    clubId: `club:${draftYear}`,
    access:
      access === 'open'
        ? {
            state: 'open' as const,
            decision: {
              id: addressed('review-decision', `access:${draftYear}`),
              sha256: sha(`access:${draftYear}`),
            },
            recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
          }
        : { state: 'unresolved' as const, reason: 'selection-access-not-reviewed' },
  };
}

function calculation(draftYear: number, seasonOffset: number, totalPav: number) {
  const seasonYear = draftYear + seasonOffset;
  const calculationSha256 = sha(`calculation:${seasonYear}`);
  return {
    calculation: {
      calculationId: `hpn-pav-season:${calculationSha256}`,
      calculationSha256,
      inputSetId: addressed('hpn-pav-input-set', `input:${seasonYear}`),
      methodId: addressed('hpn-pav-method', 'hpn-v1'),
      seasonYear,
      effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
      calculatedAt: `${seasonYear + 1}-01-01T00:00:00.000Z`,
    },
    playerValues: [
      {
        calculationId: `hpn-pav-season:${calculationSha256}`,
        calculationSha256,
        seasonYear,
        spellVersionId: addressed('acquisition-spell-version', `${draftYear}:${seasonYear}:spell`),
        playerId: `player:${draftYear}`,
        playerSha256: sha(`${draftYear}:${seasonYear}:player`),
        clubId: `club:${draftYear}`,
        sourceRowIds: [
          `decoded-row:${draftYear}:${seasonYear}:1`,
          `decoded-row:${draftYear}:${seasonYear}:2`,
        ],
        gamesPlayed: 2,
        totalPav,
      },
    ],
  };
}

function request(
  overrides: {
    selections?: ReturnType<typeof selection>[];
    calculations?: ReturnType<typeof calculation>[];
    knowledgeCutoffAt?: string;
    policy?: ReturnType<typeof policy>;
  } = {}
) {
  const selections = overrides.selections ?? draftYears.map((year) => selection(year));
  const calculations =
    overrides.calculations ??
    draftYears.flatMap((year) => [calculation(year, 1, 35), calculation(year, 2, 25)]);
  return {
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    createdAt: '2015-01-02T00:00:00.000Z',
    knowledgeCutoffAt: overrides.knowledgeCutoffAt ?? '2015-01-01T00:00:00.000Z',
    releaseId: addressed('outcome-release', 'released-draft-history'),
    policy: overrides.policy ?? policy(),
    selections,
    calculations,
  };
}

describe('AFL trade pick-PAV observation materializer', () => {
  it('materializes exact-pick mature outcomes from finalized season PAV', () => {
    const set = materializeAflTradePickPavObservationSet(request());
    const pick14 = set.content.observations.find(
      ({ selection: item }) => item.actualSelectionNumber === 14
    );

    expect(pick14?.selection.playerId).toBe('player:2000');
    expect(pick14?.calculationIds).toHaveLength(2);
    expect(pick14?.playerValues.map(({ totalPav }) => totalPav)).toEqual([35, 25]);
    expect(pick14?.outcome).toEqual({
      state: 'mature_observed',
      contribution: 60,
      gamesPlayed: 4,
      category: 'high_quality',
    });
    expect(set.content.draftClasses).toHaveLength(4);
    expect(set.content.publicationEligible).toBe(false);
  });

  it('uses only a contiguous observed prefix for right-censored outcomes', () => {
    const set = materializeAflTradePickPavObservationSet(
      request({ knowledgeCutoffAt: '2014-06-01T00:00:00.000Z' })
    );
    const first = set.content.observations.find(({ selection: item }) => item.draftYear === 2012);

    expect(first?.outcome).toEqual({
      state: 'right_censored',
      contributionObservedToDate: 35,
      gamesObservedToDate: 2,
      censoredAt: '2014-06-01T00:00:00.000Z',
    });
  });

  it('fails closed for a missing matured horizon and unresolved selection access', () => {
    const missing = request().calculations.filter(
      ({ calculation: item }) => item.seasonYear !== 2002
    );
    const missingSet = materializeAflTradePickPavObservationSet(request({ calculations: missing }));
    const unresolvedSet = materializeAflTradePickPavObservationSet(
      request({
        selections: draftYears.map((year) =>
          selection(year, year === 2000 ? 'unresolved' : 'open')
        ),
      })
    );

    expect(
      missingSet.content.observations.find(({ selection: item }) => item.draftYear === 2000)
        ?.outcome
    ).toEqual({ state: 'unavailable', reason: 'horizon_calculation_missing' });
    expect(
      unresolvedSet.content.observations.find(({ selection: item }) => item.draftYear === 2000)
        ?.outcome
    ).toEqual({ state: 'unavailable', reason: 'selection_access_unresolved' });
  });

  it('rejects duplicate selections and cross-calculation PAV evidence', () => {
    expect(() =>
      materializeAflTradePickPavObservationSet(
        request({ selections: [...request().selections, request().selections[0]!] })
      )
    ).toThrow();
    const calculations = request().calculations.map((item, index) =>
      index === 0
        ? {
            ...item,
            playerValues: item.playerValues.map((value) => ({
              ...value,
              calculationId: addressed('hpn-pav-season', 'substituted-calculation'),
            })),
          }
        : item
    );
    expect(() => materializeAflTradePickPavObservationSet(request({ calculations }))).toThrow();
  });

  it('rejects a split whose training horizon overlaps the first held-out prediction', () => {
    const years = [2000, 2002, 2008, 2012];
    expect(() =>
      materializeAflTradePickPavObservationSet(
        request({
          policy: policy(2002),
          selections: years.map((year) => selection(year)),
          calculations: years.flatMap((year) => [
            calculation(year, 1, 35),
            calculation(year, 2, 25),
          ]),
        })
      )
    ).toThrow(/label-purged|training horizon|held-out prediction/i);
  });
});
