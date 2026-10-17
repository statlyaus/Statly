import { describe, expect, it } from 'vitest';

import {
  buildAflTradeStory,
  type AflTradeStoryLeg,
  type AflTradeStoryNames,
  type AflTradeStoryNet,
  type AflTradeStoryTrade,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

/** Small synthetic batches for the paths the Cameron chain does not take. Clubs are A to D. */
function world() {
  const names = {
    clubs: new Map(['A', 'B', 'C', 'D'].map((club) => [club, `Club ${club}`])),
    players: new Map<string, string>(),
    picks: new Map(),
    transfers: new Map(),
  } satisfies AflTradeStoryNames;
  const leg = (
    transferId: string,
    asset: string,
    [from, to]: string,
    rest: Pick<AflTradeStoryLeg, 'basis'> & Partial<AflTradeStoryLeg>
  ): AflTradeStoryLeg => {
    const isPlayer = asset.startsWith('player:');
    if (isPlayer) names.players.set(asset, asset);
    names.transfers.set(
      transferId,
      isPlayer ? { kind: 'player', playerId: asset } : { kind: 'pick', pickId: asset, label: asset }
    );
    return {
      transferId,
      assetKind: isPlayer ? 'player' : 'pick',
      sendingClubId: from!,
      receivingClubId: to!,
      ...rest,
    };
  };
  const selected = (transferId: string, pick: string, move: string, pav: number) => {
    names.players.set(`player:${pick}`, `Drafted with ${pick}`);
    names.picks.set(pick, { playerId: `player:${pick}`, selectionNumber: 30, draftYear: 2021 });
    return leg(transferId, pick, move, {
      basis: 'pick_selected_first_stint',
      realizedValue: pav,
      stint: { status: 'open' },
    });
  };
  const onward = (transferId: string, pick: string, move: string, transactionId: string) =>
    leg(transferId, pick, move, {
      basis: 'pick_traded_on_return',
      realizedValue: 999,
      onward: { transactionId },
    });
  const trade = (
    transactionId: string,
    tradeYear: number,
    legs: AflTradeStoryLeg[]
  ): AflTradeStoryTrade => ({
    transactionId,
    tradeYear,
    clubs: [...new Set(legs.flatMap((one) => [one.sendingClubId, one.receivingClubId]))]
      .sort()
      .map((clubId) => ({ clubId })),
    legs,
  });
  return { names, leg, selected, onward, trade };
}

const netOf = <Net extends AflTradeStoryNet>(nets: readonly Net[], clubId: string): Net =>
  nets.find((net) => net.clubId === clubId)!;
const groups = (players: ReturnType<typeof buildAflTradeStory>['players']) =>
  players.map(({ group, clubId, assetId }) => `${group} ${clubId} ${assetId}`);

describe('realized trade story edge cases', () => {
  it('follows a special entitlement to its successor pick, and cancels it when passed on', () => {
    const { names, leg, trade } = world();
    const trades = [
      trade('T1', 2020, [
        leg('t1-entitlement', 'pick:E', 'AB', {
          basis: 'pick_traded_on_return',
          onward: { transactionId: 'T2' },
          specialEntitlement: { successorTransferId: 't2-successor' },
        }),
      ]),
      trade('T2', 2020, [
        leg('t2-successor', 'pick:S', 'BC', { basis: 'pick_not_used_nominee_excluded' }),
      ]),
    ];
    const built = buildAflTradeStory({ content: { trades } }, 'T1', names);
    expect(built.sides[0]!.gave[0]!.value).toEqual({ kind: 'pending', pending: 'matched_bid' });
    expect(built.lineage.assets[0]!.hops.map(({ tradeId, clubId }) => tradeId + clubId)).toEqual([
      'T1B',
      'T2C',
    ]);
    expect(netOf(built.nets.withNextMoves, 'B')).toMatchObject({ pendingCount: 0, net: 0 });
    expect(netOf(built.nets.withNextMoves, 'A').pending).toEqual([
      { assetId: 'pick:E', direction: 'given' },
    ]);
    const successor = buildAflTradeStory({ content: { trades } }, 'T2', names);
    expect(successor.lineage.assets[0]!.hops[0]).toMatchObject({
      tradeId: 'T1',
      relation: 'before',
    });
  });

  it('counts a pick passed back to a club of the trade as ended with, in that club’s chain', () => {
    const { names, selected, onward, trade } = world();
    const trades = [
      trade('T1', 2020, [onward('t1-p', 'P', 'AB', 'T2'), selected('t1-q', 'Q', 'BA', 10)]),
      trade('T2', 2021, [selected('t2-p', 'P', 'BA', 20), selected('t2-r', 'R', 'AB', 5)]),
    ];
    const built = buildAflTradeStory({ content: { trades } }, 'T1', names);
    expect(groups(built.players)).toEqual(['ended_with A P', 'ended_with A Q', 'ended_with B R']);
    expect(netOf(built.nets.withNextMoves, 'A')).toMatchObject({ net: 5, tradeIds: ['T1', 'T2'] });
    expect(netOf(built.nets.tradeAlone, 'A').net).toBe(-10);
  });

  it('lets a player traded on along the chain get away, valued at each receiving club', () => {
    const { names, leg, selected, onward, trade } = world();
    const player = (transferId: string, move: string, pav: number) =>
      leg(transferId, 'player:X', move, {
        basis: 'player_first_stint',
        realizedValue: pav,
        stint: { status: 'open' },
      });
    const trades = [
      trade('T1', 2020, [
        player('t1-x', 'AB', 10),
        onward('t1-v', 'V', 'AB', 'T2'),
        selected('t1-s', 'S', 'BA', 7),
      ]),
      trade('T2', 2021, [
        player('t2-x', 'BC', 40),
        selected('t2-v', 'V', 'BC', 3),
        selected('t2-w', 'W', 'CB', 50),
      ]),
    ];
    const built = buildAflTradeStory({ content: { trades } }, 'T1', names);
    expect(groups(built.players)).toEqual([
      'ended_with A S',
      'ended_with B W',
      'got_away C player:X',
      'got_away C V',
    ]);
    // B: +10 + 3 − 7 on T1, then +50 − 40 − 3 on T2. The player does not cancel.
    expect(netOf(built.nets.withNextMoves, 'B').net).toBe(13);
  });

  it('keeps a three-club trade zero-sum across unallocated, blocked, projected and not-used legs', () => {
    const { names, leg, selected, trade } = world();
    const trades = [
      trade('T', 2022, [
        leg('t-u', 'U', 'AB', {
          basis: 'pick_traded_on_return_unallocated',
          onwardTransactionId: 'T2',
        }),
        leg('t-x', 'player:Y', 'BC', { basis: 'unavailable' }),
        leg('t-p', 'P', 'CA', { basis: 'pick_projected_from_order', realizedValue: 12 }),
        leg('t-n', 'N', 'AC', { basis: 'pick_not_used_no_nominee', realizedValue: 0 }),
      ]),
      trade('T2', 2022, [selected('t2-u', 'U', 'BD', 12)]),
    ];
    const built = buildAflTradeStory({ content: { trades } }, 'T', names);
    const values = Object.fromEntries(
      built.lineage.trades[0]!.assets.map(({ assetId, value, outcome }) => [
        assetId,
        [value, outcome.kind],
      ])
    );
    expect(values).toEqual({
      U: [{ kind: 'known', pav: 12 }, 'player'],
      'player:Y': [{ kind: 'pending', pending: 'unavailable' }, 'pending'],
      P: [{ kind: 'pending', pending: 'draft_not_in_evidence' }, 'pending'],
      N: [{ kind: 'known', pav: 0 }, 'not_used'],
    });
    const nets = built.nets.tradeAlone.map(({ clubId, net, pendingCount }) => [
      clubId,
      net,
      pendingCount,
    ]);
    expect(nets).toEqual([
      ['A', -12, 1],
      ['B', 12, 1],
      ['C', 0, 2],
    ]);
  });

  it('fails closed on a cycle of onward links', () => {
    const { names, onward, trade } = world();
    const trades = [
      trade('T1', 2020, [onward('t1-p', 'P', 'AB', 'T2')]),
      trade('T2', 2020, [onward('t2-p', 'P', 'BA', 'T1')]),
    ];
    expect(() => buildAflTradeStory({ content: { trades } }, 'T1', names)).toThrow(
      'The trade story found a cycle at transfer t1-p.'
    );
  });
});
