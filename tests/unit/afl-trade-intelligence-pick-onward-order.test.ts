import { describe, expect, it } from 'vitest';

import {
  aflTradePickCustodyHolders,
  aflTradePickTradeSequence,
  aflTradeTransactionNotBefore,
  createAflTradePickOnwardTransfers,
  type AflTradeOnwardCustody,
  type AflTradeOnwardTransaction,
  type AflTradeOnwardTransfer,
} from '@/server/aflTradeIntelligence/source/pickOnwardTransfer';
import type { AflTradeGradingInputs } from '@/server/aflTradeIntelligence/valuation/gradingInputs';
import { buildAflTradeStructure } from '@/server/aflTradeIntelligence/valuation/tradeStructure';

/**
 * Issue 789 (coordinator decision 2026-10-16): undated hops of one season are ordered by the Draftguru
 * pick-trade sequence, and a tie between trails is broken by the pick's latest custody holder. The
 * shapes are the four trades the v10 dry run blocked as undated cycles.
 */
const tx = (providerEventId: string, seasonYear = Number(providerEventId.slice(0, 4))) =>
  ({
    transactionId: `tx:${providerEventId}`,
    providerEventId,
    seasonYear,
    occurredOn: null,
  }) satisfies AflTradeOnwardTransaction;
const hop = (transaction: AflTradeOnwardTransaction, from: string, to: string, pickId: string) =>
  ({
    transferId: `${transaction.transactionId}:${from}-${to}`,
    transactionId: transaction.transactionId,
    fromClubId: from,
    toClubId: to,
    asset: { kind: 'pick_entitlement', pickId },
  }) satisfies AflTradeOnwardTransfer;

function onward(
  transactions: AflTradeOnwardTransaction[],
  transfers: AflTradeOnwardTransfer[],
  holder?: string
) {
  const pickId = transfers[0]!.asset.pickId!;
  const onwardOf = createAflTradePickOnwardTransfers(
    new Map(transactions.map((transaction) => [transaction.transactionId, transaction])),
    transfers,
    holder === undefined ? {} : { custodyHolders: new Map([[pickId, holder]]) }
  );
  return transfers.map((transfer) => onwardOf(transfer).map(({ transferId }) => transferId));
}

// 2019 Port Adelaide #50: HAW → MEL (the Frost trade, a player trade with no sequence), MEL → NM
// (pick trade 8), NM → HAW (pick trade 32). The suffix leaves two trails; Hawthorn held the pick on
// the 2019-11-25 indicative order.
const pick50 = () => {
  const trades = [
    tx('2019-sam-frost'),
    tx('2019-picks-melbourne-north_melbourne-8'),
    tx('2019-picks-hawthorn-north_melbourne-32'),
  ];
  return {
    trades,
    hops: [
      hop(trades[0]!, 'hawthorn', 'melbourne', 'pick-2019-50'),
      hop(trades[1]!, 'melbourne', 'north_melbourne', 'pick-2019-50'),
      hop(trades[2]!, 'north_melbourne', 'hawthorn', 'pick-2019-50'),
    ],
  };
};
// 2019 #64: WCE → BRL (pick trade 5), BRL → ESS (the Cutler trade), ESS → WCE (pick trade 51).
const pick64 = () => {
  const trades = [
    tx('2019-picks-brisbane_lions-west_coast-5'),
    tx('2019-mitch-cutler'),
    tx('2019-picks-essendon-west_coast-51'),
  ];
  return {
    trades,
    hops: [
      hop(trades[0]!, 'west_coast', 'brisbane_lions', 'pick-2019-64'),
      hop(trades[1]!, 'brisbane_lions', 'essendon', 'pick-2019-64'),
      hop(trades[2]!, 'essendon', 'west_coast', 'pick-2019-64'),
    ],
  };
};
// 2020 #70: BRL → NTH and NTH → COL in player trades, COL → BRL in pick trade 36. Brisbane held it.
const pick70 = () => {
  const trades = [
    tx('2020-brisbane-north-player'),
    tx('2020-north-collingwood-player'),
    tx('2020-picks-brisbane_lions-collingwood-36'),
  ];
  return {
    trades,
    hops: [
      hop(trades[0]!, 'brisbane_lions', 'north_melbourne', 'pick-2020-70'),
      hop(trades[1]!, 'north_melbourne', 'collingwood', 'pick-2020-70'),
      hop(trades[2]!, 'collingwood', 'brisbane_lions', 'pick-2020-70'),
    ],
  };
};
// 2024: STK → ESS (pick trade 25), ESS → STK (pick trade 30).
const pick2024 = () => {
  const trades = [tx('2024-picks-essendon-st_kilda-25'), tx('2024-picks-essendon-st_kilda-30')];
  return {
    trades,
    hops: [
      hop(trades[0]!, 'st_kilda', 'essendon', 'pick-2024-x'),
      hop(trades[1]!, 'essendon', 'st_kilda', 'pick-2024-x'),
    ],
  };
};
const ids = (hops: AflTradeOnwardTransfer[]) => hops.map(({ transferId }) => transferId);

describe('the Draftguru pick-trade sequence (issue 789)', () => {
  it('reads the season sequence of a pick-only trade and nothing else', () => {
    const sequence = (providerEventId: string, seasonYear?: number) =>
      aflTradePickTradeSequence(tx(providerEventId, seasonYear));
    expect(sequence('2019-picks-melbourne-north_melbourne-8')).toBe(8);
    expect(sequence('2024-picks-port_adelaide-west_coast-30')).toBe(30);
    // Player trades, and a pick trade id with no number, carry no sequence.
    expect(sequence('2024-liam-baker-matt-owies')).toBeNull();
    expect(sequence('2025-picks-gws-western-bulldogs')).toBeNull();
    // A sequence belongs to its own season's trade period only.
    expect(sequence('2019-picks-melbourne-north_melbourne-8', 2020)).toBeNull();
  });

  it('orders one season’s sequenced trades, and leaves player trades and seasons as they were', () => {
    const [first, second] = pick2024().trades as [
      AflTradeOnwardTransaction,
      AflTradeOnwardTransaction,
    ];
    expect(aflTradeTransactionNotBefore(second, first)).toBe(true);
    expect(aflTradeTransactionNotBefore(first, second)).toBe(false);
    expect(aflTradeTransactionNotBefore(first, second, { unordered: true })).toBe(true);
    // A player trade has no sequence, so it may come before or after a pick trade of its season.
    const frost = tx('2019-sam-frost');
    const eight = tx('2019-picks-melbourne-north_melbourne-8');
    expect(aflTradeTransactionNotBefore(frost, eight)).toBe(true);
    expect(aflTradeTransactionNotBefore(eight, frost)).toBe(true);
    // Across seasons the season decides, whatever the sequences say.
    const late2019 = tx('2019-picks-hawthorn-north_melbourne-32');
    const early2020 = tx('2020-picks-brisbane_lions-collingwood-3');
    expect(aflTradeTransactionNotBefore(early2020, late2019)).toBe(true);
    expect(aflTradeTransactionNotBefore(late2019, early2020)).toBe(false);
  });
});

describe('ordering undated pick hops into one trail (issue 789)', () => {
  it('resolves 2019 #64 by the sequence alone', () => {
    const { trades, hops } = pick64();
    expect(onward(trades, hops)).toEqual([[hops[1]!.transferId], [hops[2]!.transferId], []]);
  });

  it('resolves the 2024 swap back by the sequence alone', () => {
    const { trades, hops } = pick2024();
    expect(onward(trades, hops)).toEqual([[hops[1]!.transferId], []]);
  });

  it('resolves 2019 #50 by its custody holder once the sequence leaves two trails', () => {
    const { trades, hops } = pick50();
    // Without a holder, NM → HAW still links back into the Frost trade: a ring the cycle guard drops.
    expect(onward(trades, hops)[2]).toEqual([hops[0]!.transferId]);
    expect(onward(trades, hops, 'hawthorn')).toEqual([
      [hops[1]!.transferId],
      [hops[2]!.transferId],
      [],
    ]);
    // The sequence rules out NM → HAW before MEL → NM, so the only other trail ends at Melbourne.
    expect(onward(trades, hops, 'melbourne')).toEqual([
      [],
      [hops[2]!.transferId],
      [hops[0]!.transferId],
    ]);
  });

  it('resolves 2020 #70 by its custody holder', () => {
    const { trades, hops } = pick70();
    expect(onward(trades, hops, 'brisbane_lions')).toEqual([
      [hops[1]!.transferId],
      [hops[2]!.transferId],
      [],
    ]);
  });

  it('keeps blocking when no trail, or more than one, ends at the holder', () => {
    const { trades, hops } = pick70();
    const ring = onward(trades, hops);
    // Every rotation chains, so each hop links to the next around the ring, as before.
    expect(ring).toEqual([[hops[1]!.transferId], [hops[2]!.transferId], [hops[0]!.transferId]]);
    expect(onward(trades, hops, 'carlton')).toEqual(ring);
    // A pick sent A → B, back B → A and on A → B in undated player trades: both trails end at B.
    const there = tx('2021-a-b-one');
    const back = tx('2021-b-a');
    const again = tx('2021-a-b-two');
    const swaps = [
      hop(there, 'adelaide', 'brisbane', 'pick-swap'),
      hop(back, 'brisbane', 'adelaide', 'pick-swap'),
      hop(again, 'adelaide', 'brisbane', 'pick-swap'),
    ];
    expect(onward([there, back, again], swaps, 'brisbane')[1]).toEqual(ids([swaps[0]!, swaps[2]!]));
  });

  it('leaves the unordered rule as #952 shipped it', () => {
    const { trades, hops } = pick2024();
    const onwardOf = createAflTradePickOnwardTransfers(
      new Map(trades.map((transaction) => [transaction.transactionId, transaction])),
      hops,
      { unordered: true, custodyHolders: new Map([['pick-2024-x', 'st_kilda']]) }
    );
    expect(hops.map((transfer) => ids(onwardOf(transfer)))).toEqual([
      [hops[1]!.transferId],
      [hops[0]!.transferId],
    ]);
  });
});

describe('a pick’s latest custody holder (issue 789)', () => {
  const row = (
    observedAt: AflTradeOnwardCustody['observedAt'],
    currentClubId: string | null,
    status = 'single_source',
    pickId = 'pick-2019-50'
  ): AflTradeOnwardCustody => ({ pickId, observedAt, currentClubId, status });

  it('is the club the one latest usable observation names', () => {
    expect(
      aflTradePickCustodyHolders([
        row('2019-10-01T00:00:00.000Z', 'melbourne'),
        row('2019-11-25T00:00:00.000Z', 'hawthorn', 'corroborated'),
        row('2019-11-25T00:00:00.000Z', 'brisbane_lions', 'single_source', 'pick-2020-70'),
      ])
    ).toEqual(
      new Map([
        ['pick-2019-50', 'hawthorn'],
        ['pick-2020-70', 'brisbane_lions'],
      ])
    );
  });

  it('is unknown when the latest observation is unusable, unnamed or overlapping', () => {
    const older = row('2019-10-01T00:00:00.000Z', 'melbourne');
    expect(
      aflTradePickCustodyHolders([older, row('2019-11-25T00:00:00.000Z', 'hawthorn', 'disputed')])
    ).toEqual(new Map());
    expect(aflTradePickCustodyHolders([older, row('2019-11-25T00:00:00.000Z', null)])).toEqual(
      new Map()
    );
    // A day-precision observation overlaps an instant on that day: neither is the latest.
    expect(
      aflTradePickCustodyHolders([
        row({ precision: 'day', date: '2019-11-25' }, 'melbourne'),
        row('2019-11-25T03:00:00.000Z', 'hawthorn'),
      ])
    ).toEqual(new Map());
  });
});

describe('the trade structure follows an ordered trail (issue 789)', () => {
  type Candidate = AflTradeGradingInputs['candidate'];
  // 2020 #70 as a candidate from before the ordering rule holds it: every hop stated traded on, each
  // trade returning a player to the club that gave the pick.
  const ring = (withCustody: boolean): Candidate => {
    const { trades, hops } = pick70();
    const returns = [
      ['q', 'north_melbourne', 'brisbane_lions'],
      ['r', 'collingwood', 'north_melbourne'],
      ['s', 'brisbane_lions', 'collingwood'],
    ] as const;
    return {
      transactions: trades.map((trade) => ({
        ...trade,
        transactionType: 'trade',
      })) as unknown as Candidate['transactions'],
      transfers: [
        ...hops.map((transfer) => ({
          ...transfer,
          asset: {
            kind: 'pick_entitlement',
            pickId: transfer.asset.pickId,
            draftYear: 2020,
            draftType: 'national',
            nominalRound: 3,
            nominalPick: 70,
            originalClubId: 'brisbane_lions',
            recordedLabel: null,
          },
          status: 'single_source',
          evidenceIds: [],
        })),
        ...returns.map(([playerId, from, to], index) => ({
          transferId: `${trades[index]!.transactionId}:player-${playerId}`,
          transactionId: trades[index]!.transactionId,
          fromClubId: from,
          toClubId: to,
          asset: { kind: 'player', playerId, recordedName: playerId },
          status: 'single_source',
          evidenceIds: [],
        })),
      ] as unknown as Candidate['transfers'],
      pickOutcomes: hops.map((transfer) => ({
        outcomeId: `outcome-${transfer.transferId}`,
        transferId: transfer.transferId,
        disposition: 'traded_on',
        outcomeStatus: 'stated',
        selectionId: null,
        playerId: null,
        evidenceIds: [],
      })) as unknown as Candidate['pickOutcomes'],
      ...(withCustody
        ? {
            pickCustody: [
              {
                custodyId: 'external-pick-custody:70',
                pickId: 'pick-2020-70',
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
    };
  };
  const legs = (candidate: Candidate) => {
    const structure = buildAflTradeStructure({
      candidateId: `external-reconciliation:${'a'.repeat(64)}`,
      candidate,
    });
    return pick70().hops.map(({ transferId }) =>
      structure.content.trades
        .flatMap((trade) => trade.legs)
        .find((leg) => leg.transferId === transferId)!
    );
  };

  it('links no hop of the ring without a custody holder, as before', () => {
    expect(legs(ring(false)).map(({ onward }) => onward)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('follows the trail ending at the holder and links the final hop nowhere', () => {
    const [first, second, final] = legs(ring(true));
    expect(first!.onward).toMatchObject({ transactionId: 'tx:2020-north-collingwood-player' });
    expect(second!.onward).toMatchObject({
      transactionId: 'tx:2020-picks-brisbane_lions-collingwood-36',
    });
    expect(final).not.toHaveProperty('onward');
  });
});
