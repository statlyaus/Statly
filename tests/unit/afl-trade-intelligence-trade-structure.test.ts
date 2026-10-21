import { describe, expect, it } from 'vitest';

import {
  gradeAflTradesOnRealizedValue,
  type AflTradeRealizedTradeGradeInputs,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';
import {
  buildAflTradeStructure,
  type AflTradeStructureInputs,
} from '@/server/aflTradeIntelligence/valuation/tradeStructure';
import {
  AFL_TRADE_STRUCTURE_SCHEMA_VERSION,
  parseAflTradeStructure,
  type AflTradeStructure,
} from '@/server/aflTradeIntelligence/valuation/tradeStructureContracts';

/**
 * Issue 789, value-line method step 5: the trade structure (graded trades, their legs and onward
 * links) extracted from the realized grader, with no valuation. Its onward links do not depend on
 * whether the onward side could be graded; only the leadsTo cycle guard drops one.
 */
const hex = (digit: string) => digit.repeat(64);
type Candidate = AflTradeStructureInputs['candidate'];
type Transfer = Candidate['transfers'][number];
type Outcome = NonNullable<Candidate['pickOutcomes']>[number];
type Board = NonNullable<Candidate['draftBoardPicks']>[number];

const trade = (transactionId: string, seasonYear: number, providerEventId = transactionId) =>
  ({
    transactionId,
    providerEventId,
    seasonYear,
    occurredOn: null,
    transactionType: 'trade',
  }) as unknown as Candidate['transactions'][number];
const player = (
  transferId: string,
  transactionId: string,
  from: string | null,
  to: string,
  playerId: string | null
): Transfer =>
  ({
    transferId,
    transactionId,
    fromClubId: from,
    toClubId: to,
    asset: { kind: 'player', playerId, recordedName: playerId ?? 'Unknown' },
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Transfer;
const pick = (
  transferId: string,
  transactionId: string,
  from: string,
  to: string,
  pickId: string,
  draftYear = 2021
): Transfer =>
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
      nominalPick: 20,
      originalClubId: from,
      recordedLabel: null,
    },
    status: 'single_source',
    evidenceIds: [],
  }) as unknown as Transfer;
const tradedOn = (transferId: string): Outcome =>
  ({
    outcomeId: `outcome-${transferId}`,
    transferId,
    disposition: 'traded_on',
    outcomeStatus: 'stated',
    selectionId: null,
    playerId: null,
    evidenceIds: [],
  }) as unknown as Outcome;
const board = (route: string[]): Board =>
  ({
    boardPickId: `external-draft-board-pick:${hex('c')}`,
    draftYear: 2021,
    draftType: 'national',
    roundNumber: 1,
    recordedPickNumber: 20,
    status: 'selected',
    clubId: route.at(-1)!,
    routeClubIds: route,
    evidenceIds: [],
  }) as unknown as Board;

const candidateId = `external-reconciliation:${hex('a')}`;
const structureOf = (
  candidate: Candidate,
  extra: Partial<AflTradeStructureInputs> = {}
): AflTradeStructure => buildAflTradeStructure({ candidateId, candidate, ...extra });
const legOf = (structure: AflTradeStructure, transferId: string) =>
  structure.content.trades
    .flatMap(({ legs }) => legs)
    .find((leg) => leg.transferId === transferId)!;
const gradeInputs = (
  candidate: Candidate,
  extra: Partial<AflTradeRealizedTradeGradeInputs> = {}
): AflTradeRealizedTradeGradeInputs => ({
  candidateId,
  candidate,
  pavCalculations: [2021, 2022].map((season) => ({
    season,
    calculationId: `hpn-pav-season:${season}`,
    official: true,
  })),
  pav: [],
  seasonSpells: [],
  spellSeasons: [2021, 2022],
  reviewedArrivals: [],
  pickProjectionBenchmarkId: `hpn-pick-benchmark:${hex('b')}`,
  spellCutoffAt: '2026-10-21T00:00:00.000Z',
  gradedAt: '2026-10-21T01:00:00.000Z',
  ...extra,
});

// tx-1 (2020): Richmond sends Hawthorn pick A for player p. tx-2 (2021): Hawthorn trades pick A on
// to Sydney for a player whose identity is unresolved, so Hawthorn's side of tx-2 is blocked.
const blockedOnward = (): Candidate => ({
  transactions: [trade('tx-1', 2020), trade('tx-2', 2021)],
  transfers: [
    pick('tr-1a', 'tx-1', 'richmond', 'hawthorn', 'pick-A'),
    player('tr-1b', 'tx-1', 'hawthorn', 'richmond', 'p'),
    pick('tr-2a', 'tx-2', 'hawthorn', 'sydney', 'pick-A'),
    player('tr-2b', 'tx-2', 'sydney', 'hawthorn', null),
  ],
  pickOutcomes: [tradedOn('tr-1a'), tradedOn('tr-2a')],
});

describe('the trade structure (issue 789, value-line method step 5)', () => {
  it('lists graded trades and their legs, sorted, with no valuation', () => {
    const structure = structureOf(blockedOnward());
    expect(structure.content.schemaVersion).toBe(AFL_TRADE_STRUCTURE_SCHEMA_VERSION);
    expect(structure.content.trades.map(({ transactionId }) => transactionId)).toEqual([
      'tx-1',
      'tx-2',
    ]);
    expect(structure.content.trades[0]).toEqual({
      transactionId: 'tx-1',
      tradeYear: 2020,
      clubs: [{ clubId: 'hawthorn' }, { clubId: 'richmond' }],
      legs: [
        {
          transferId: 'tr-1a',
          assetKind: 'pick',
          sendingClubId: 'richmond',
          receivingClubId: 'hawthorn',
          onward: { kind: 'pick_trail', transactionId: 'tx-2', transferId: 'tr-2a' },
        },
        {
          transferId: 'tr-1b',
          assetKind: 'player',
          sendingClubId: 'hawthorn',
          receivingClubId: 'richmond',
        },
      ],
    });
    expect(JSON.stringify(structure)).not.toMatch(/realizedValue|pav|state|reasons/i);
    expect(structure.content.summary).toEqual({ trades: 2, legs: 4, onwardLinks: 1, ungraded: 0 });
  });

  it('holds a trade from any season the grader accepts, back to 1897', () => {
    const candidate: Candidate = {
      transactions: [trade('tx-old', 1898)],
      transfers: [
        player('tr-old-a', 'tx-old', 'fitzroy', 'carlton', 'p1'),
        player('tr-old-b', 'tx-old', 'carlton', 'fitzroy', 'p2'),
      ],
    };
    expect(structureOf(candidate).content.trades.map(({ tradeYear }) => tradeYear)).toEqual([1898]);
  });

  it('keeps an onward link the grader drops when the onward side is blocked', () => {
    const candidate = blockedOnward();
    const grade = gradeAflTradesOnRealizedValue(gradeInputs(candidate));
    const graded = grade.content.trades
      .flatMap(({ legs }) => legs)
      .find((leg) => leg.transferId === 'tr-1a')!;
    expect(graded).toMatchObject({ state: 'blocked', reasons: ['traded_on_return_blocked'] });
    expect(graded).not.toHaveProperty('onward');
    expect(graded).not.toHaveProperty('onwardTransactionId');
    expect(legOf(structureOf(candidate), 'tr-1a').onward).toEqual({
      kind: 'pick_trail',
      transactionId: 'tx-2',
      transferId: 'tr-2a',
    });
  });

  it('drops the link of a leg whose onward trade leads back to its own trade', () => {
    // A ring: the pick goes Brisbane → North → Collingwood → Brisbane in undated player trades, so
    // each hop links to the next around the ring and every link would read its own trade.
    const ring = (withHolder: boolean): Candidate => ({
      transactions: [
        trade('tx:2020-a', 2020, '2020-brisbane-north-player'),
        trade('tx:2020-b', 2020, '2020-north-collingwood-player'),
        trade('tx:2020-c', 2020, '2020-picks-brisbane_lions-collingwood-36'),
      ],
      transfers: [
        pick('tr-a', 'tx:2020-a', 'brisbane_lions', 'north_melbourne', 'pick-70', 2020),
        pick('tr-b', 'tx:2020-b', 'north_melbourne', 'collingwood', 'pick-70', 2020),
        pick('tr-c', 'tx:2020-c', 'collingwood', 'brisbane_lions', 'pick-70', 2020),
        player('tr-a2', 'tx:2020-a', 'north_melbourne', 'brisbane_lions', 'q'),
        player('tr-b2', 'tx:2020-b', 'collingwood', 'north_melbourne', 'r'),
        player('tr-c2', 'tx:2020-c', 'brisbane_lions', 'collingwood', 's'),
      ],
      pickOutcomes: [tradedOn('tr-a'), tradedOn('tr-b'), tradedOn('tr-c')],
      ...(withHolder
        ? {
            pickCustody: [
              {
                custodyId: 'external-pick-custody:70',
                pickId: 'pick-70',
                observedAt: '2020-12-07T00:00:00.000Z',
                draftYear: 2020,
                draftType: 'national',
                roundNumber: 3,
                recordedPickNumber: 70,
                originalClubId: 'brisbane_lions',
                currentClubId: 'brisbane_lions',
                status: 'single_source',
                evidenceIds: [],
              },
            ] as unknown as Candidate['pickCustody'],
          }
        : {}),
    });
    const cyclic = structureOf(ring(false));
    expect(['tr-a', 'tr-b', 'tr-c'].map((id) => legOf(cyclic, id).onward)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    // The pick-onward order: the custody holder picks the one trail, and the final hop links nowhere.
    const ordered = structureOf(ring(true));
    expect(['tr-a', 'tr-b', 'tr-c'].map((id) => legOf(ordered, id).onward?.transferId)).toEqual([
      'tr-b',
      'tr-c',
      undefined,
    ]);
  });

  it('names a route-corroborated pick trail, and only that one', () => {
    const corroborated = structureOf({
      ...blockedOnward(),
      draftBoardPicks: [board(['richmond', 'hawthorn', 'sydney'])],
    });
    expect(legOf(corroborated, 'tr-1a').onward).toEqual({
      kind: 'pick_trail',
      transactionId: 'tx-2',
      transferId: 'tr-2a',
      corroboratedBy: 'footyinfo',
    });
    // Two boards routing the same hop pair corroborate nothing.
    const ambiguous = structureOf({
      ...blockedOnward(),
      draftBoardPicks: [
        board(['richmond', 'hawthorn', 'sydney']),
        board(['richmond', 'hawthorn', 'sydney']),
      ],
    });
    expect(legOf(ambiguous, 'tr-1a').onward).not.toHaveProperty('corroboratedBy');
  });

  it('links a special entitlement to its reviewed custody successor', () => {
    const entitlementId = `special-entitlement:${hex('d')}`;
    const concession = {
      ...pick('tr-S1', 'tx-S', 'gold-coast', 'geelong', 'unused', 2020),
      asset: {
        kind: 'special_pick',
        entitlementType: 'assistance_concession',
        draftYear: 2020,
        selectionOrdinal: null,
        sourceLabel: '2020MIDR1 (Gold Coast concession)',
      },
    } as unknown as Transfer;
    const candidate: Candidate = {
      transactions: [trade('tx-S', 2019), trade('tx-C', 2020)],
      transfers: [
        concession,
        player('tr-S2', 'tx-S', 'geelong', 'gold-coast', 'g'),
        pick('tr-C1', 'tx-C', 'geelong', 'gws', 'pick-15', 2020),
        player('tr-C2', 'tx-C', 'gws', 'geelong', 'cam'),
      ],
    };
    const specialEntitlementCustody = [
      { transferId: 'tr-S1', entitlementId, predecessorTransferId: null },
      { transferId: 'tr-C1', entitlementId, predecessorTransferId: 'tr-S1' },
    ];
    expect(legOf(structureOf(candidate, { specialEntitlementCustody }), 'tr-S1').onward).toEqual({
      kind: 'special_entitlement_successor',
      transactionId: 'tx-C',
      transferId: 'tr-C1',
      entitlementId,
    });
    expect(legOf(structureOf(candidate), 'tr-S1')).not.toHaveProperty('onward');
  });

  it('names the trades it cannot structure, never dropping them', () => {
    const structure = structureOf({
      transactions: [trade('tx-1', 2021), trade('tx-0', 2021), trade('tx-9', 2021)],
      transfers: [
        player('tr-1', 'tx-1', 'carlton', 'collingwood', 'p'),
        player('tr-9', 'tx-9', null, 'collingwood', 'q'),
      ],
    });
    expect(structure.content.trades.map(({ transactionId }) => transactionId)).toEqual(['tx-1']);
    expect(structure.content.ungraded).toEqual([
      { transactionId: 'tx-0', reason: 'no_transfers' },
      { transactionId: 'tx-9', reason: 'club_unresolved' },
    ]);
  });

  it('is content-addressed: the same candidate in any order gives the same structure id', () => {
    const candidate = blockedOnward();
    const first = structureOf(candidate);
    expect(first.structureId).toMatch(/^afl-trade-structure:[a-f0-9]{64}$/);
    const shuffled: Candidate = {
      ...candidate,
      transactions: [...candidate.transactions].reverse(),
      transfers: [...candidate.transfers].reverse(),
    };
    expect(structureOf(shuffled).structureId).toBe(first.structureId);
    expect(structureOf(candidate).structureId).toBe(first.structureId);
    expect(parseAflTradeStructure(JSON.parse(JSON.stringify(first)))).toEqual(first);
    const tampered = structuredClone(first) as { content: { trades: { tradeYear: number }[] } };
    tampered.content.trades[0]!.tradeYear = 2019;
    expect(() => parseAflTradeStructure(tampered)).toThrow();
    // A different candidate is a different structure.
    expect(structureOf({ ...candidate, pickOutcomes: [] }).structureId).not.toBe(first.structureId);
  });

  it('agrees with every onward link the grader still emits', () => {
    const candidate: Candidate = {
      ...blockedOnward(),
      transfers: blockedOnward().transfers.map((transfer) =>
        transfer.transferId === 'tr-2b'
          ? player('tr-2b', 'tx-2', 'sydney', 'hawthorn', 'h')
          : transfer
      ),
    };
    const grade = gradeAflTradesOnRealizedValue(
      gradeInputs(candidate, {
        seasonSpells: [{ playerId: 'h', season: 2022, clubId: 'hawthorn' }],
        pav: [{ playerId: 'h', season: 2022, clubId: 'hawthorn', value: 4 }],
      })
    );
    const graded = grade.content.trades.flatMap(({ legs }) => legs);
    const structure = structureOf(candidate);
    for (const leg of graded) {
      const gradedOnward =
        'onward' in leg && leg.onward
          ? leg.onward.transactionId
          : 'onwardTransactionId' in leg
            ? leg.onwardTransactionId
            : undefined;
      if (gradedOnward !== undefined)
        expect(legOf(structure, leg.transferId).onward?.transactionId).toBe(gradedOnward);
    }
    expect(graded.find((leg) => leg.transferId === 'tr-1a')).toMatchObject({
      state: 'valued',
      onward: { transactionId: 'tx-2' },
    });
  });
});
