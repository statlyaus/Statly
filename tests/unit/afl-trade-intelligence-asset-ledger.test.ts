import { describe, expect, it } from 'vitest';

import { createAflTradeAssetLedger } from '@/server/aflTradeIntelligence/valuation/assetLedger';
import type { AflTradeAssetLedgerLabels } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';
import {
  gradeAflTradesOnRealizedValue,
  type AflTradeRealizedTradeGradeInputs,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';

const hex = (digit: string) => digit.repeat(64);
type Candidate = AflTradeRealizedTradeGradeInputs['candidate'];
type Transfer = Candidate['transfers'][number];
type Outcome = NonNullable<Candidate['pickOutcomes']>[number];
type Selection = NonNullable<Candidate['draftSelections']>[number];
type Custody = NonNullable<Candidate['pickCustody']>[number];

const PICK_TRADED = `draft-pick:${hex('1')}`;
const PICK_PASSED = `draft-pick:${hex('2')}`;
const PICK_MATCHED = `draft-pick:${hex('3')}`;
const PICK_NOT_USED = `draft-pick:${hex('4')}`;
const PICK_FUTURE = `draft-pick:${hex('5')}`;
const PICK_UNSEEN = `draft-pick:${hex('6')}`;
const PICK_DARCY = `draft-pick:${hex('7')}`;
const BOARD_PASSED = `external-draft-board-pick:${hex('8')}`;
const BOARD_MATCHED = `external-draft-board-pick:${hex('9')}`;

const trade = (transactionId: string, seasonYear: number) =>
  ({
    transactionId,
    seasonYear,
    transactionType: 'trade',
  }) as unknown as Candidate['transactions'][number];
const player = (
  transferId: string,
  transactionId: string,
  from: string,
  to: string,
  playerId: string
) =>
  ({
    transferId,
    transactionId,
    fromClubId: from,
    toClubId: to,
    asset: { kind: 'player', playerId, recordedName: playerId },
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Transfer;
const pick = (
  transferId: string,
  transactionId: string,
  from: string,
  to: string,
  pickId: string,
  draftYear: number,
  originalClubId = from
) =>
  ({
    transferId,
    transactionId,
    fromClubId: from,
    toClubId: to,
    asset: {
      kind: 'pick_entitlement',
      pickId,
      draftYear,
      draftType: 'national',
      nominalRound: 1,
      nominalPick: null,
      originalClubId,
      recordedLabel: null,
    },
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Transfer;
const outcome = (transferId: string, fields: Partial<Outcome>) =>
  ({
    outcomeId: `outcome-${transferId}`,
    transferId,
    disposition: 'not_used',
    outcomeStatus: 'stated',
    selectionId: null,
    playerId: null,
    evidenceIds: [],
    ...fields,
  }) as unknown as Outcome;
const selection = (
  selectionId: string,
  pickId: string,
  playerId: string,
  clubId: string,
  number: number
) =>
  ({
    selectionId,
    draftYear: 2021,
    draftType: 'national',
    selectionNumber: number,
    roundNumber: 1,
    pickId,
    playerId,
    clubId,
    status: 'single_source',
    supportingProviders: ['draftguru'],
    evidenceIds: [],
  }) as unknown as Selection;
const custody = (
  custodyId: string,
  pickId: string,
  draftYear: number,
  recordedPickNumber: number
) =>
  ({
    custodyId,
    pickId,
    observedAt: { precision: 'day', date: `${draftYear}-11-01` },
    draftYear,
    draftType: 'national',
    roundNumber: 1,
    recordedPickNumber,
    originalClubId: 'adelaide',
    currentClubId: 'adelaide',
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Custody;

// p1: Collingwood 2019-2021, traded to Carlton for 2022-2023, Essendon 2024, back at Carlton 2025.
// p2 (a father-son nominee): drafted by the Western Bulldogs at 2 in 2021, there from 2022.
// p3: drafted by Collingwood with the pick traded GWS -> Carlton -> Collingwood.
const candidate = (): Candidate => ({
  transactions: [
    trade('tx-0', 2021),
    trade('tx-1', 2020),
    trade('tx-2', 2021),
    trade('tx-3', 2021),
  ],
  transfers: [
    player('tr-0', 'tx-0', 'collingwood', 'carlton', 'p1'),
    pick('tr-1', 'tx-1', 'gws', 'carlton', PICK_TRADED, 2021),
    pick('tr-2', 'tx-2', 'carlton', 'collingwood', PICK_TRADED, 2021, 'gws'),
    pick('tr-3', 'tx-3', 'geelong', 'carlton', PICK_PASSED, 2021),
    pick('tr-4', 'tx-3', 'essendon', 'western_bulldogs', PICK_MATCHED, 2021),
    pick('tr-5', 'tx-3', 'carlton', 'geelong', PICK_NOT_USED, 2021),
  ],
  pickOutcomes: [
    outcome('tr-1', { disposition: 'traded_on' }),
    outcome('tr-2', { disposition: 'selected', selectionId: 'sel-3', playerId: 'p3' }),
    outcome('tr-3', { nominationBasis: 'board_pick_passed_or_removed', boardPickId: BOARD_PASSED }),
    outcome('tr-4', {
      nominationBasis: 'club_took_nominated_player',
      receivingClubNominatedSelections: 1,
      matchedBidBoardPickIds: [BOARD_MATCHED],
    }),
    outcome('tr-5', {
      nominationBasis: 'club_took_no_nominated_player',
      receivingClubNominatedSelections: 0,
    }),
  ],
  draftSelections: [
    selection('sel-2', PICK_DARCY, 'p2', 'western_bulldogs', 2),
    selection('sel-3', PICK_TRADED, 'p3', 'collingwood', 9),
  ],
  pickCustody: [custody('cu-1', PICK_FUTURE, 2026, 7), custody('cu-2', PICK_UNSEEN, 2021, 12)],
});

const seasons = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const spells = (playerId: string, rows: Array<[number, string]>) =>
  rows.map(([season, clubId]) => ({ playerId, season, clubId }));
const pav = (playerId: string, rows: Array<[number, string, number]>) =>
  rows.map(([season, clubId, value]) => ({ playerId, season, clubId, value }));

const inputs = (): AflTradeRealizedTradeGradeInputs => ({
  candidateId: `external-reconciliation:${hex('a')}`,
  candidate: candidate(),
  pavCalculations: seasons.map((season) => ({
    season,
    calculationId: `hpn-pav-season:${season}`,
    official: season < 2025,
  })),
  pav: [
    ...pav('p1', [
      [2019, 'collingwood', 4],
      [2020, 'collingwood', 6],
      [2021, 'collingwood', 8],
      [2022, 'carlton', 12],
      [2023, 'carlton', -2],
      [2024, 'essendon', 5],
      [2025, 'carlton', 50],
    ]),
    ...pav('p2', [
      [2022, 'western_bulldogs', 3],
      [2023, 'western_bulldogs', 9],
      [2024, 'western_bulldogs', 15],
      [2025, 'western_bulldogs', 20],
    ]),
    ...pav('p3', [[2023, 'collingwood', 1.5]]),
  ],
  seasonSpells: [
    ...spells('p1', [
      [2019, 'collingwood'],
      [2020, 'collingwood'],
      [2021, 'collingwood'],
      [2022, 'carlton'],
      [2023, 'carlton'],
      [2024, 'essendon'],
      [2025, 'carlton'],
    ]),
    ...spells('p2', [
      [2022, 'western_bulldogs'],
      [2023, 'western_bulldogs'],
      [2024, 'western_bulldogs'],
      [2025, 'western_bulldogs'],
    ]),
    ...spells('p3', [[2023, 'collingwood']]),
  ],
  spellSeasons: seasons,
  reviewedArrivals: [
    { playerId: 'p1', clubId: 'carlton', season: 2022 },
    { playerId: 'p2', clubId: 'western_bulldogs', season: 2022 },
  ],
  pickProjectionBenchmarkId: `hpn-pick-benchmark:${hex('b')}`,
  spellCutoffAt: '2026-10-17T00:00:00.000Z',
  gradedAt: '2026-10-17T01:00:00.000Z',
});

const labels: AflTradeAssetLedgerLabels = {
  players: [
    { playerId: 'p1', name: 'Player One' },
    { playerId: 'p2', name: 'Sam Darcy' },
    { playerId: 'p9', name: 'Never Played' },
  ],
  clubs: [{ clubId: 'western_bulldogs', name: 'Western Bulldogs' }],
};

const build = () => createAflTradeAssetLedger(inputs(), labels);
const playerOf = (playerId: string) =>
  build().ledger.content.players.find((row) => row.playerId === playerId)!;
const pickOf = (pickId: string) =>
  build().ledger.content.picks.find((row) => row.pickId === pickId)!;

describe('asset ledger players', () => {
  it('lists a traded player’s stints, with the return to Carlton a stint of its own', () => {
    expect(playerOf('p1')).toMatchObject({
      name: 'Player One',
      stints: [
        {
          clubId: 'collingwood',
          startSeason: 2019,
          endSeason: 2021,
          status: 'closed',
          arrivalReviewed: false,
          beganBeforeCoverage: true,
          total: 18,
          value: 18,
        },
        {
          clubId: 'carlton',
          startSeason: 2022,
          endSeason: 2023,
          status: 'closed',
          arrivalReviewed: true,
          beganBeforeCoverage: false,
          seasons: [
            { season: 2022, pav: 12, official: true },
            { season: 2023, pav: -2, official: true },
          ],
          total: 10,
          value: 10,
        },
        { clubId: 'essendon', startSeason: 2024, endSeason: 2024, status: 'closed', total: 5 },
        {
          clubId: 'carlton',
          startSeason: 2025,
          endSeason: null,
          status: 'open',
          seasons: [{ season: 2025, pav: 50, official: false }],
        },
      ],
    });
  });

  it('includes every labelled player, and names a player without an approved row as null', () => {
    const { content } = build().ledger;
    expect(content.players.map(({ playerId }) => playerId)).toEqual(['p1', 'p2', 'p3', 'p9']);
    expect(playerOf('p9').stints).toEqual([]);
    expect(playerOf('p3').name).toBeNull();
    expect(content.summary).toMatchObject({ players: 4, playersWithoutName: 1 });
  });
});

describe('asset ledger stint values', () => {
  it('values a drafted player’s first stint at the drafting club (Sam Darcy at the Bulldogs)', () => {
    expect(build().pickOutcome(PICK_DARCY)).toMatchObject({
      kind: 'selected',
      selectionId: 'sel-2',
      playerId: 'p2',
      clubId: 'western_bulldogs',
      selectionNumber: 2,
      firstStint: {
        startSeason: 2022,
        status: 'open',
        arrivalReviewed: true,
        total: 47,
        value: 47,
      },
    });
  });

  it('answers any player at any club from any season, by the grader’s own stint rule', () => {
    const ledger = build();
    expect(ledger.stintValue('p1', 'carlton', 2022)).toMatchObject({ total: 10, endSeason: 2023 });
    expect(ledger.stintValue('p1', 'carlton', 2025)).toMatchObject({ total: 50, status: 'open' });
    const graded = gradeAflTradesOnRealizedValue(inputs())
      .content.trades.flatMap(({ legs }) => legs)
      .find(({ transferId }) => transferId === 'tr-0')!;
    expect(graded).toMatchObject({ realizedValue: ledger.stintValue('p1', 'carlton', 2022).value });
  });
});

describe('asset ledger picks', () => {
  it('follows a traded pick through each club that held it to the player it was used on', () => {
    expect(pickOf(PICK_TRADED)).toMatchObject({
      draftYear: 2021,
      round: 1,
      originalClubId: 'gws',
      hopOrder: 'trail',
      hops: [
        { transactionId: 'tx-1', seasonYear: 2020, fromClubId: 'gws', toClubId: 'carlton' },
        { transactionId: 'tx-2', seasonYear: 2021, fromClubId: 'carlton', toClubId: 'collingwood' },
      ],
      outcome: {
        kind: 'selected',
        playerId: 'p3',
        clubId: 'collingwood',
        selectionNumber: 9,
        firstStint: { startSeason: 2022, total: 1.5 },
      },
    });
  });

  it('shows a passed pick, a not-used pick and a matched-bid pick pending', () => {
    const ledger = build();
    expect(ledger.pickOutcome(PICK_PASSED)).toEqual({ kind: 'passed', boardPickId: BOARD_PASSED });
    expect(ledger.pickOutcome(PICK_NOT_USED)).toEqual({ kind: 'not_used' });
    expect(ledger.pickOutcome(PICK_MATCHED)).toEqual({
      kind: 'matched_bid',
      status: 'pending',
      matchedBidBoardPickIds: [BOARD_MATCHED],
    });
  });

  it('projects a pick of a draft not yet in evidence and leaves a drafted-year gap unresolved', () => {
    const ledger = build();
    expect(ledger.pickOutcome(PICK_FUTURE)).toEqual({
      kind: 'future',
      projectedSlot: { selectionNumber: 7, custodyId: 'cu-1', orderDraftYear: 2026, proxy: false },
    });
    expect(ledger.pickOutcome(PICK_UNSEEN)).toEqual({
      kind: 'unresolved',
      reason: 'no_outcome_evidence',
    });
    expect(ledger.pickOutcome(`draft-pick:${hex('f')}`)).toBeUndefined();
  });

  it('never reads a not-used pick without access evidence as 0', () => {
    const base = inputs();
    const pickOutcomes = base.candidate.pickOutcomes!.map((row) =>
      row.transferId === 'tr-5' ? outcome('tr-5', {}) : row
    );
    const ledger = createAflTradeAssetLedger(
      { ...base, candidate: { ...base.candidate, pickOutcomes } },
      labels
    );
    expect(ledger.pickOutcome(PICK_NOT_USED)).toEqual({
      kind: 'unresolved',
      reason: 'not_used_no_access_evidence',
    });
  });
});

describe('asset ledger seal', () => {
  it('is private, content-addressed and reproducible, and counts its outcomes', () => {
    const first = build().ledger;
    expect(first.ledgerId).toMatch(/^asset-ledger:[a-f0-9]{64}$/);
    expect(build().ledger.ledgerId).toBe(first.ledgerId);
    expect(first.content).toMatchObject({
      publicationEligible: false,
      publicationProhibited: true,
      summary: {
        picks: 7,
        outcomes: { selected: 2, not_used: 1, matched_bid: 1, passed: 1, future: 1, unresolved: 1 },
      },
    });
  });
});
