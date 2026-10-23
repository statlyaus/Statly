import { describe, expect, it } from 'vitest';

import { createAflTradeAssetLedger } from '@/server/aflTradeIntelligence/valuation/assetLedger';
import {
  aflTradeAssetLedgerBidMatches,
  aflTradeAssetLedgerShareMatchedBid,
} from '@/server/aflTradeIntelligence/valuation/assetLedgerBidMatches';
import { AFL_TRADE_ASSET_LEDGER_REVIEWED_BID_SPENDS } from '@/server/aflTradeIntelligence/valuation/assetLedgerReviewedBidSpends';
import {
  AFL_TRADE_ASSET_LEDGER_REVIEWED_PASSED,
  AFL_TRADE_ASSET_LEDGER_REVIEWED_SAME_PICKS,
} from '@/server/aflTradeIntelligence/valuation/assetLedgerReviewedPickLinks';
import { createAflTradeAssetLedgerStintValue } from '@/server/aflTradeIntelligence/valuation/assetLedgerStints';
import type { AflTradeAssetLedgerLabels } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';
import type { AflTradeGradingInputs } from '@/server/aflTradeIntelligence/valuation/gradingInputs';
import {
  aflTradeArrivalReviewed,
  aflTradeFirstStint,
  indexAflTradeStintInputs,
} from '@/server/aflTradeIntelligence/valuation/stints';
import { buildAflTradeStructure } from '@/server/aflTradeIntelligence/valuation/tradeStructure';

const hex = (digit: string) => digit.repeat(64);
type Candidate = AflTradeGradingInputs['candidate'];
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

const inputs = (): AflTradeGradingInputs => ({
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
const withCandidate = (change: (candidate: Candidate) => Candidate) => {
  const base = inputs();
  return createAflTradeAssetLedger({ ...base, candidate: change(base.candidate) }, labels);
};
const withOutcomes = (change: (rows: Outcome[]) => Outcome[]) =>
  withCandidate((candidate) => ({ ...candidate, pickOutcomes: change(candidate.pickOutcomes!) }));
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

  it('answers any player at any club from any season, by the shared stint rule', () => {
    const ledger = build();
    expect(ledger.stintValue('p1', 'carlton', 2022)).toMatchObject({ total: 10, endSeason: 2023 });
    expect(ledger.stintValue('p1', 'carlton', 2025)).toMatchObject({ total: 50, status: 'open' });
    // tr-0: Collingwood traded p1 to Carlton in 2021, so his first stint there starts in 2022.
    const index = indexAflTradeStintInputs(inputs());
    const reviewed = aflTradeArrivalReviewed(index, 'p1', 'carlton', 2021, 2022);
    expect(reviewed).toBe(true);
    const stint = aflTradeFirstStint(index, 'p1', 'carlton', 2022, reviewed);
    expect(stint).toMatchObject({ status: 'closed', seasonsValued: [2022, 2023], pavSum: 10 });
    expect(ledger.stintValue('p1', 'carlton', 2022)).toMatchObject({
      total: stint.pavSum,
      value: Math.max(0, stint.pavSum),
    });
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
      basis: 'board_matched_bid',
      matchedBidBoardPickIds: [BOARD_MATCHED],
      pendingReason: 'no_bid_spend',
    });
  });

  it('says when a matched bid rests only on a nominee count', () => {
    const ledger = withOutcomes((rows) =>
      rows.map((row) =>
        row.transferId === 'tr-4'
          ? outcome('tr-4', {
              nominationBasis: 'club_took_nominated_player',
              receivingClubNominatedSelections: 1,
            })
          : row
      )
    );
    expect(ledger.pickOutcome(PICK_MATCHED)).toEqual({
      kind: 'matched_bid',
      status: 'pending',
      basis: 'nominee_count',
      matchedBidBoardPickIds: [],
      pendingReason: 'no_bid_spend',
    });
  });

  it('values a traded pick’s draftee by the shared first-stint rule from the season after the draft', () => {
    // tr-2: Collingwood received the 2021 pick and used it on p3, whose stint there starts in 2022.
    const index = indexAflTradeStintInputs(inputs());
    const reviewed = aflTradeArrivalReviewed(index, 'p3', 'collingwood', 2021, 2022);
    const stint = aflTradeFirstStint(index, 'p3', 'collingwood', 2022, reviewed);
    const outcome = build().pickOutcome(PICK_TRADED);
    expect(outcome?.kind === 'selected' && outcome.firstStint).toMatchObject({
      startSeason: 2022,
      status: stint.status,
      arrivalReviewed: reviewed,
      total: stint.pavSum,
      value: Math.max(0, stint.pavSum),
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

describe('asset ledger picks without a clear outcome', () => {
  const PICK_ROOKIE = `draft-pick:${hex('c')}`;

  it('leaves a traded pick of a draft already run unresolved when no hop states an outcome', () => {
    const ledger = withCandidate((candidate) => ({
      ...candidate,
      transfers: [
        ...candidate.transfers,
        pick('tr-6', 'tx-3', 'gws', 'carlton', PICK_ROOKIE, 2020),
      ],
    }));
    expect(ledger.pickOutcome(PICK_ROOKIE)).toEqual({
      kind: 'unresolved',
      reason: 'no_outcome_evidence',
    });
  });

  it('refuses a selection in a draft before the trade', () => {
    const ledger = withCandidate((candidate) => ({
      ...candidate,
      transfers: [
        ...candidate.transfers,
        pick('tr-6', 'tx-4', 'gws', 'carlton', PICK_ROOKIE, 2021),
      ],
      transactions: [...candidate.transactions, trade('tx-4', 2022)],
      pickOutcomes: [
        ...candidate.pickOutcomes!,
        outcome('tr-6', { disposition: 'selected', playerId: 'p1' }),
      ],
    }));
    expect(ledger.pickOutcome(PICK_ROOKIE)).toEqual({
      kind: 'unresolved',
      reason: 'pick_outcome_unresolved',
    });
  });

  it('lists a hop whose club is unresolved, and never puts it on a trail', () => {
    const ledger = withCandidate((candidate) => ({
      ...candidate,
      transfers: candidate.transfers.map((transfer) =>
        transfer.transferId === 'tr-1' ? ({ ...transfer, fromClubId: null } as Transfer) : transfer
      ),
    }));
    expect(ledger.ledger.content.picks.find(({ pickId }) => pickId === PICK_TRADED)).toMatchObject({
      hopOrder: 'unordered',
      hops: [
        { transferId: 'tr-1', fromClubId: null, toClubId: 'carlton' },
        { transferId: 'tr-2', fromClubId: 'carlton', toClubId: 'collingwood' },
      ],
    });
  });

  it('refuses a used pick its club traded on, and two hops that both state an end', () => {
    const usedThenTraded = withOutcomes((rows) =>
      rows.map((row) =>
        row.transferId === 'tr-1'
          ? outcome('tr-1', { nominationBasis: 'club_took_no_nominated_player' })
          : row.transferId === 'tr-2'
            ? outcome('tr-2', { disposition: 'traded_on' })
            : row
      )
    );
    expect(usedThenTraded.pickOutcome(PICK_TRADED)).toEqual({
      kind: 'unresolved',
      reason: 'outcome_conflict',
    });
    const twoEnds = withOutcomes((rows) =>
      rows.map((row) =>
        row.transferId === 'tr-1'
          ? outcome('tr-1', { nominationBasis: 'club_took_no_nominated_player' })
          : row
      )
    );
    expect(twoEnds.pickOutcome(PICK_TRADED)).toEqual({
      kind: 'unresolved',
      reason: 'outcome_conflict',
    });
  });

  it('follows a pending hop to a future slot, and a lone traded-on hop to unlinked', () => {
    const pending = withOutcomes((rows) =>
      rows.map((row) =>
        row.transferId === 'tr-3' ? outcome('tr-3', { outcomeStatus: 'pending' }) : row
      )
    );
    expect(pending.pickOutcome(PICK_PASSED)).toEqual({ kind: 'future', projectedSlot: null });
    const unlinked = withOutcomes((rows) =>
      rows.map((row) =>
        row.transferId === 'tr-5' ? outcome('tr-5', { disposition: 'traded_on' }) : row
      )
    );
    expect(unlinked.pickOutcome(PICK_NOT_USED)).toEqual({
      kind: 'unresolved',
      reason: 'traded_on_unlinked',
    });
  });

  it('refuses two usable selections of one pick, and lists identity fields its sources disagree on', () => {
    const ledger = withCandidate((candidate) => ({
      ...candidate,
      draftSelections: [
        ...candidate.draftSelections!,
        { ...selection('sel-4', PICK_DARCY, 'p3', 'western_bulldogs', 3), roundNumber: 2 },
      ],
    }));
    expect(ledger.pickOutcome(PICK_DARCY)).toEqual({
      kind: 'unresolved',
      reason: 'selection_conflict',
    });
    expect(ledger.ledger.content.picks.find(({ pickId }) => pickId === PICK_DARCY)).toMatchObject({
      identityDisagreements: ['round'],
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
        matchedBidPicksShared: 0,
      },
    });
  });
});

describe('asset ledger matched-bid shares (issue 789)', () => {
  type BidMatch = NonNullable<Candidate['draftBoardBidMatches']>[number];
  const spent = (
    nativePickId: string,
    originalNumber: number | null,
    originalClubId: string | null,
    pointsUsed: number
  ) => ({
    nativePickId,
    label: `R3 - Pick ${originalNumber ?? '?'}`,
    originalNumber,
    originalClubId,
    holdingClubId: 'western_bulldogs',
    pointsUsed,
  });
  /** Sam Darcy's 2021 match: the Bulldogs' five spent picks, Essendon's 34 the pick they traded for. */
  const darcyBid = (fields: Partial<BidMatch> = {}): BidMatch => ({
    bidMatchId: `external-draft-board-bid-match:${hex('c')}`,
    draftYear: 2021,
    draftType: 'national',
    nativePickId: '5733',
    selectionNumber: 2,
    roundNumber: 1,
    clubId: 'western_bulldogs',
    playerId: 'p2',
    bidClubId: 'gws',
    basis: 'father_son',
    points: 2517,
    pointsUsed: 1889,
    consumedPicks: [
      spent('7449', 34, 'essendon', 542),
      spent('6042', 42, 'gold_coast', 395),
      spent('6057', 43, 'adelaide', 378),
      spent('7451', 44, null, 362),
      spent('5727', null, 'hawthorn', 347),
    ],
    leftoverPicks: [{ nativePickId: '5792', holdingClubId: 'western_bulldogs', points: 135 }],
    evidenceIds: [`external-evidence:${hex('d')}`],
    ...fields,
  });
  const withBid = (bid: BidMatch = darcyBid()) =>
    withCandidate((candidate) => ({
      ...candidate,
      draftBoardBidMatches: [bid],
      pickCustody: [
        ...candidate.pickCustody!,
        // The 2021 order's pick 34, originally Essendon's, which the Bulldogs held at the bid.
        { ...custody('cu-3', PICK_MATCHED, 2021, 34), originalClubId: 'essendon' },
      ],
    }));

  it('gives the spent pick its share of Darcy by the points it covered of the AFL price', () => {
    const ledger = withBid();
    // 542 of the 2,013.6 the 2015 rule prices pick 2 at, of Darcy's 47 at the Bulldogs.
    expect(ledger.pickOutcome(PICK_MATCHED)).toEqual({
      kind: 'matched_bid',
      status: 'shared',
      basis: 'board_matched_bid',
      matchedBidBoardPickIds: [BOARD_MATCHED],
      bidMatchId: `external-draft-board-bid-match:${hex('c')}`,
      nomineePlayerId: 'p2',
      countedPoints: 542,
      share: 542 / 2013.6,
      use: 'full',
      value: (542 / 2013.6) * 47,
    });
    expect(ledger.ledger.content.summary.matchedBidPicksShared).toBe(1);
  });

  it('lists the bid with its price, leftover and every spent pick’s slot join', () => {
    const [bid] = withBid().ledger.content.bidMatches;
    expect(bid).toMatchObject({
      nominee: { selectionId: 'sel-2', playerId: 'p2', firstStint: { value: 47 } },
      pricing: {
        status: 'shared',
        ruleId: 'afl-bid-price-2015-dvi',
        pricePoints: 2013.6,
        leftover: {
          spentNativePickId: '5727',
          remainderPoints: 10.4,
          boardLeftoverPickIds: ['5792'],
        },
        deficit: null,
      },
    });
    // Only Essendon's 34 has a custody slot; a pick with no number or no club never joins by number.
    expect(bid!.spentPicks.map(({ link, pickId }) => [link, pickId])).toEqual([
      ['custody', PICK_MATCHED],
      ['no_custody', null],
      ['no_custody', null],
      ['club_unresolved', null],
      ['unnumbered', null],
    ]);
    expect(bid!.spentPicks.at(-1)).toMatchObject({ countedPoints: 336.6, use: 'partial' });
  });

  it('stays pending, with the reason, when the bid cannot be priced or its nominee is not one selection', () => {
    expect(withBid(darcyBid({ roundNumber: null })).pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'pending',
      pendingReason: 'bid_unpriced',
    });
    expect(withBid(darcyBid({ playerId: 'p3' })).pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'pending',
      pendingReason: 'nominee_unresolved',
    });
    expect(withBid(darcyBid({ playerId: null })).pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'pending',
      pendingReason: 'nominee_unresolved',
    });
    const unlisted = darcyBid({ consumedPicks: darcyBid().consumedPicks.slice(1) });
    expect(withBid(unlisted).pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'pending',
      pendingReason: 'no_bid_spend',
    });
  });

  it('counts a nominee-count pick no board lists as not used, unless its holder has an unjoined spend', () => {
    // Owner, 2026-10-21: a not-used pick the draft's boards do not list as spent was not spent.
    const nomineeCount = (bid: BidMatch) =>
      withCandidate((candidate) => ({
        ...candidate,
        draftBoardBidMatches: [bid],
        pickOutcomes: candidate.pickOutcomes!.map((row) =>
          row.transferId === 'tr-4'
            ? outcome('tr-4', {
                nominationBasis: 'club_took_nominated_player',
                receivingClubNominatedSelections: 1,
              })
            : row
        ),
      }));
    const unlisted = darcyBid({ consumedPicks: darcyBid().consumedPicks.slice(1) });
    // Another club's bid: the Bulldogs, who held the pick, spent nothing the boards could not join.
    expect(nomineeCount({ ...unlisted, clubId: 'geelong' }).pickOutcome(PICK_MATCHED)).toEqual({
      kind: 'not_used',
      evidence: 'board_not_spent',
    });
    // The Bulldogs' own bid has spent picks that join no slot: one of them could be this pick.
    expect(nomineeCount(unlisted).pickOutcome(PICK_MATCHED)).toMatchObject({
      kind: 'matched_bid',
      status: 'pending',
      basis: 'nominee_count',
      pendingReason: 'no_bid_spend',
    });
  });

  it('joins a spent pick with no custody slot to the one pick traded once at the board’s number', () => {
    // Owner, 2026-10-21: Essendon's pick 34, traded once to the Bulldogs, is the board's spent 34.
    const tradedAt = (nominalPick: number) =>
      withCandidate((candidate) => ({
        ...candidate,
        draftBoardBidMatches: [darcyBid()],
        transfers: candidate.transfers.map((row) =>
          row.transferId === 'tr-4'
            ? ({ ...row, asset: { ...row.asset, nominalPick } } as Transfer)
            : row
        ),
      }));
    const joined = tradedAt(34);
    expect(joined.ledger.content.bidMatches[0]!.spentPicks[0]).toMatchObject({
      link: 'trade_entitlement',
      pickId: PICK_MATCHED,
    });
    expect(joined.pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'shared',
      share: 542 / 2013.6,
    });
    // A different trade-stated number joins nothing.
    expect(tradedAt(35).ledger.content.bidMatches[0]!.spentPicks[0]).toMatchObject({
      link: 'no_custody',
      pickId: null,
    });
  });

  it('does not let an unjoined spend of the bidding club’s own pick block a pick traded in', () => {
    const withSpends = (consumedPicks: BidMatch['consumedPicks']) =>
      withCandidate((candidate) => ({
        ...candidate,
        draftBoardBidMatches: [darcyBid({ consumedPicks })],
        pickOutcomes: candidate.pickOutcomes!.map((row) =>
          row.transferId === 'tr-4'
            ? outcome('tr-4', {
                nominationBasis: 'club_took_nominated_player',
                receivingClubNominatedSelections: 1,
              })
            : row
        ),
      }));
    // The Bulldogs' own unnumbered pick cannot be the pick they got from Essendon.
    expect(
      withSpends([spent('9001', null, 'western_bulldogs', 400)]).pickOutcome(PICK_MATCHED)
    ).toEqual({ kind: 'not_used', evidence: 'board_not_spent' });
    // Hawthorn's unnumbered pick could have reached the Bulldogs some other way: still pending.
    expect(
      withSpends([spent('9002', null, 'hawthorn', 400)]).pickOutcome(PICK_MATCHED)
    ).toMatchObject({ status: 'pending', pendingReason: 'no_bid_spend' });
  });

  it('joins a reviewed spend only to a pick the bidding club held at the draft', () => {
    const base = {
      ...inputs(),
      candidate: { ...inputs().candidate, draftBoardBidMatches: [darcyBid()] },
    };
    const stintValue = createAflTradeAssetLedgerStintValue(base);
    // Gold Coast's 42, which no custody row or single trade places, reviewed as the Bulldogs' pick.
    const reviewed = [
      {
        bidMatchId: darcyBid().bidMatchId,
        nativePickId: '6042',
        pickId: PICK_MATCHED,
        note: 'test',
      },
    ];
    const held = new Map([[PICK_MATCHED, 'western_bulldogs']]);
    const [bid] = aflTradeAssetLedgerBidMatches(base.candidate, stintValue, [], held, reviewed);
    expect(bid!.spentPicks[1]).toMatchObject({ link: 'reviewed', pickId: PICK_MATCHED });
    expect(() =>
      aflTradeAssetLedgerBidMatches(
        base.candidate,
        stintValue,
        [],
        new Map([[PICK_MATCHED, 'essendon']]),
        reviewed
      )
    ).toThrow(/did not hold at the draft/);
    // The owner's lists (2026-10-21 "Approve 1-5", 2026-10-23 #1050 B) have six reviewed spends,
    // each named once.
    const keys = AFL_TRADE_ASSET_LEDGER_REVIEWED_BID_SPENDS.map(
      ({ bidMatchId, nativePickId }) => `${bidMatchId}|${nativePickId}`
    );
    expect(new Set(keys).size).toBe(6);
  });

  describe('owner-reviewed links for pending matched-bid picks (#1050)', () => {
    const pendingOutcome = {
      kind: 'matched_bid' as const,
      status: 'pending' as const,
      basis: 'nominee_count' as const,
      matchedBidBoardPickIds: [],
      pendingReason: 'no_bid_spend' as const,
    };
    const spentBid = (clubId: string) =>
      ({
        bidMatchId: 'bid-1',
        draftYear: 2019,
        draftType: 'national',
        selectionNumber: 25,
        clubId,
        bidClubId: null,
        basis: 'father_son',
        nominee: { selectionId: 'sel', playerId: 'mead', firstStint: null },
        pricing: { status: 'shared', ruleId: 'r', pricePoints: 1, leftover: null, deficit: null },
        spentPicks: [
          {
            nativePickId: '1',
            label: 'R3 (GEE) - Pick 57',
            originalNumber: 57,
            originalClubId: 'geelong',
            pointsUsed: 207,
            pickId: 'pick-real',
            link: 'custody',
            countedPoints: 207,
            share: 0.25,
            use: 'full',
            value: 10,
          },
        ],
      }) as never;
    const pick = (holderClubId: string) => ({
      pickId: 'pick-copy',
      draftYear: 2019,
      draftType: 'national',
      holderClubId,
      firstFromClubId: 'carlton',
    });
    const review = (boardStatus = 'passed', boardClub = 'port') => ({
      samePicks: [{ pickId: 'pick-copy', samePickId: 'pick-real', note: 't' }],
      passed: [],
      boardPicks: [{ boardPickId: 'b', status: boardStatus, clubId: boardClub }],
    });

    it("gives a reviewed duplicate the bid share of the pick it is, for the holder's bid only", () => {
      expect(
        aflTradeAssetLedgerShareMatchedBid(
          pendingOutcome,
          pick('port'),
          [spentBid('port')],
          review()
        )
      ).toMatchObject({ kind: 'matched_bid', status: 'shared', share: 0.25, value: 10 });
      expect(() =>
        aflTradeAssetLedgerShareMatchedBid(
          pendingOutcome,
          pick('port'),
          [spentBid('essendon')],
          review()
        )
      ).toThrow(/did not hold it at the draft/);
      // Without the review the copy reads as not spent: the bid's spend joins the other id.
      expect(
        aflTradeAssetLedgerShareMatchedBid(pendingOutcome, pick('port'), [spentBid('port')], {
          samePicks: [],
          passed: [],
          boardPicks: [],
        })
      ).toMatchObject({ kind: 'not_used', evidence: 'board_not_spent' });
    });

    it("marks a reviewed pick passed only when the cited board row is its holder's pass", () => {
      const passedReview = (status: string, club: string) => ({
        samePicks: [],
        passed: [{ pickId: 'pick-copy', boardPickId: 'b', note: 't' }],
        boardPicks: [{ boardPickId: 'b', status, clubId: club }],
      });
      expect(
        aflTradeAssetLedgerShareMatchedBid(
          pendingOutcome,
          pick('fremantle'),
          [],
          passedReview('passed', 'fremantle')
        )
      ).toEqual({ kind: 'passed', boardPickId: 'b' });
      for (const [status, club] of [
        ['selected', 'fremantle'],
        ['passed', 'adelaide'],
      ])
        expect(() =>
          aflTradeAssetLedgerShareMatchedBid(
            pendingOutcome,
            pick('fremantle'),
            [],
            passedReview(status!, club!)
          )
        ).toThrow(/not its holder's pass/);
    });

    it('lists each reviewed pick once', () => {
      const ids = [
        ...AFL_TRADE_ASSET_LEDGER_REVIEWED_SAME_PICKS.map(({ pickId }) => pickId),
        ...AFL_TRADE_ASSET_LEDGER_REVIEWED_PASSED.map(({ pickId }) => pickId),
      ];
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    });
  });

  it('names the nominee from a selection whose pick is unresolved, but not from a disputed one', () => {
    // On the genuine candidate every matched-bid selection is unresolved: the bid created its pick,
    // so it has no custody slot. Who was drafted is still stated by every provider.
    const withNomineeStatus = (status: Selection['status']) =>
      withCandidate((candidate) => ({
        ...candidate,
        draftBoardBidMatches: [darcyBid()],
        draftSelections: candidate.draftSelections!.map((row) =>
          row.selectionId === 'sel-2' ? { ...row, status } : row
        ),
        pickCustody: [
          ...candidate.pickCustody!,
          { ...custody('cu-3', PICK_MATCHED, 2021, 34), originalClubId: 'essendon' },
        ],
      }));
    expect(withNomineeStatus('unresolved').pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'shared',
      nomineePlayerId: 'p2',
    });
    expect(withNomineeStatus('disputed').pickOutcome(PICK_MATCHED)).toMatchObject({
      status: 'pending',
      pendingReason: 'nominee_unresolved',
    });
  });

  it('joins no pick when two pick ids share the slot, and flags a pick two bids list', () => {
    const ambiguous = withCandidate((candidate) => ({
      ...candidate,
      draftBoardBidMatches: [darcyBid()],
      pickCustody: [
        ...candidate.pickCustody!,
        { ...custody('cu-3', PICK_MATCHED, 2021, 34), originalClubId: 'essendon' },
        { ...custody('cu-4', PICK_NOT_USED, 2021, 34), originalClubId: 'essendon' },
      ],
    }));
    expect(ambiguous.ledger.content.bidMatches[0]!.spentPicks[0]).toMatchObject({
      link: 'ambiguous_custody',
      pickId: null,
    });
    expect(ambiguous.pickOutcome(PICK_MATCHED)).toMatchObject({ pendingReason: 'no_bid_spend' });
    const twice = withCandidate((candidate) => ({
      ...candidate,
      draftBoardBidMatches: [
        darcyBid(),
        darcyBid({ bidMatchId: `external-draft-board-bid-match:${hex('e')}` }),
      ],
      pickCustody: [
        ...candidate.pickCustody!,
        { ...custody('cu-3', PICK_MATCHED, 2021, 34), originalClubId: 'essendon' },
      ],
    }));
    expect(twice.pickOutcome(PICK_MATCHED)).toMatchObject({ pendingReason: 'spent_twice' });
  });

  it('never changes the trade structure: it does not read bid matches', () => {
    const base = inputs();
    const withBids: AflTradeGradingInputs = {
      ...base,
      candidate: { ...base.candidate, draftBoardBidMatches: [darcyBid()] },
    };
    expect(buildAflTradeStructure(withBids)).toEqual(buildAflTradeStructure(base));
  });
});
