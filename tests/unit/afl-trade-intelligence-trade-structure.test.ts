import { describe, expect, it } from 'vitest';

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
 * links), with no valuation. Its onward links do not depend on whether the onward side could be
 * valued; only the leadsTo cycle guard drops one.
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

  it('holds a trade from any season, back to 1897', () => {
    const candidate: Candidate = {
      transactions: [trade('tx-old', 1898)],
      transfers: [
        player('tr-old-a', 'tx-old', 'fitzroy', 'carlton', 'p1'),
        player('tr-old-b', 'tx-old', 'carlton', 'fitzroy', 'p2'),
      ],
    };
    expect(structureOf(candidate).content.trades.map(({ tradeYear }) => tradeYear)).toEqual([1898]);
  });

  it('keeps an onward link when the onward side cannot be valued', () => {
    // tx-2's player has no resolved identity, so Hawthorn's return there is unknown; the link stays.
    expect(legOf(structureOf(blockedOnward()), 'tr-1a').onward).toEqual({
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
});

describe('the trade structure relays a stated not-used pick (#1050, rule R1)', () => {
  const numbered = (transfer: Transfer, nominalPick: number): Transfer =>
    ({ ...transfer, asset: { ...(transfer as { asset: object }).asset, nominalPick } }) as Transfer;
  const notUsed = (transferId: string): Outcome =>
    ({
      ...tradedOn(transferId),
      disposition: 'not_used',
      nominationBasis: 'club_took_no_nominated_player',
      receivingClubNominatedSelections: 0,
    }) as unknown as Outcome;
  // tx-1 (2021): Richmond gives Hawthorn "#22" (pick A), which Draftguru says Hawthorn did not use.
  // tx-2 (2021, draft night): Hawthorn gives Sydney "#22" under a new pick id (pick B).
  const relayed = (
    bYear = 2021,
    bFrom = 'hawthorn',
    bNumber = 22,
    bPick = 'pick-B'
  ): Candidate => ({
    transactions: [trade('tx-1', 2021), trade('tx-2', bYear)],
    transfers: [
      numbered(pick('tr-1a', 'tx-1', 'richmond', 'hawthorn', 'pick-A'), 22),
      player('tr-1b', 'tx-1', 'hawthorn', 'richmond', 'p'),
      numbered(pick('tr-2a', 'tx-2', bFrom, 'sydney', bPick), bNumber),
      player('tr-2b', 'tx-2', 'sydney', bFrom, 'q'),
    ],
    pickOutcomes: [notUsed('tr-1a')],
  });
  const relay = {
    transferId: 'tr-1a',
    onwardTransactionId: 'tx-2',
    onwardTransferId: 'tr-2a',
    selectionNumber: 22,
  };

  it('links the not-used leg to the onward pick id as a pick relay, and seals it', () => {
    const structure = structureOf(relayed(), { pickRelays: [relay] });
    expect(legOf(structure, 'tr-1a').onward).toEqual({
      kind: 'pick_relay',
      transactionId: 'tx-2',
      transferId: 'tr-2a',
      selectionNumber: 22,
    });
    expect(structure.content.summary.onwardLinks).toBe(1);
    expect(parseAflTradeStructure(JSON.parse(JSON.stringify(structure)))).toEqual(structure);
    // Without the ledger's relay the leg links nowhere: a not-used outcome is no trail.
    expect(legOf(structureOf(relayed()), 'tr-1a')).not.toHaveProperty('onward');
  });

  it('refuses a relay the candidate does not bear out', () => {
    const linked = (candidate: Candidate, row = relay) =>
      legOf(structureOf(candidate, { pickRelays: [row] }), 'tr-1a').onward;
    // The onward trade states another number.
    expect(linked(relayed(2021, 'hawthorn', 23))).toBeUndefined();
    // The relay names a number neither trade states.
    expect(linked(relayed(), { ...relay, selectionNumber: 30 })).toBeUndefined();
    // Another club hands the number on.
    expect(linked(relayed(2021, 'richmond'))).toBeUndefined();
    // The onward trade is in an earlier season.
    expect(linked(relayed(2020))).toBeUndefined();
    // The same pick id: that is a trail, never a relay.
    expect(linked(relayed(2021, 'hawthorn', 22, 'pick-A'))).toBeUndefined();
    // A traded-on outcome follows its trail, not a relay.
    const tradedOnward: Candidate = { ...relayed(), pickOutcomes: [tradedOn('tr-1a')] };
    expect(linked(tradedOnward)).toBeUndefined();
  });
});

describe('the trade structure relays a round-only pick by its order number (#1050, R1 by order)', () => {
  it('accepts the relay when the latest usable order row under the pick id states the number', () => {
    const numbered = (transfer: Transfer, nominalPick: number | null): Transfer =>
      ({
        ...transfer,
        asset: { ...(transfer as { asset: object }).asset, nominalPick },
      }) as Transfer;
    const notUsed = (transferId: string): Outcome =>
      ({
        ...tradedOn(transferId),
        disposition: 'not_used',
        nominationBasis: 'club_took_no_nominated_player',
        receivingClubNominatedSelections: 0,
      }) as unknown as Outcome;
    const order = (status: string) =>
      ({
        custodyId: 'external-pick-custody:a',
        pickId: 'pick-A',
        observedAt: '2021-11-20T00:00:00.000Z',
        draftYear: 2021,
        draftType: 'national',
        roundNumber: 2,
        recordedPickNumber: 22,
        originalClubId: 'richmond',
        currentClubId: 'hawthorn',
        status,
        evidenceIds: [],
      }) as unknown as NonNullable<Candidate['pickCustody']>[number];
    const candidate = (status: string | null): Candidate => ({
      transactions: [trade('tx-1', 2020), trade('tx-2', 2021)],
      transfers: [
        numbered(pick('tr-1a', 'tx-1', 'richmond', 'hawthorn', 'pick-A'), null),
        player('tr-1b', 'tx-1', 'hawthorn', 'richmond', 'p'),
        numbered(pick('tr-2a', 'tx-2', 'hawthorn', 'sydney', 'pick-B'), 22),
        player('tr-2b', 'tx-2', 'sydney', 'hawthorn', 'q'),
      ],
      pickOutcomes: [notUsed('tr-1a')],
      ...(status ? { pickCustody: [order(status)] } : {}),
    });
    const relay = {
      transferId: 'tr-1a',
      onwardTransactionId: 'tx-2',
      onwardTransferId: 'tr-2a',
      selectionNumber: 22,
    };
    const linked = (status: string | null) =>
      legOf(structureOf(candidate(status), { pickRelays: [relay] }), 'tr-1a').onward;
    expect(linked('single_source')).toEqual({
      kind: 'pick_relay',
      transactionId: 'tx-2',
      transferId: 'tr-2a',
      selectionNumber: 22,
    });
    expect(linked(null)).toBeUndefined();
    expect(linked('disputed')).toBeUndefined();
  });
});
