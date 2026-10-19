import { describe, expect, it } from 'vitest';

import {
  buildAflTradeStory,
  type AflTradeStory,
  type AflTradeStoryAsset,
  type AflTradeStoryNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import {
  CLUB,
  OLD_RULE_RETURN_VALUE,
  TRADE,
  cameronChainBatch,
  cameronChainNames,
} from '../fixtures/aflTradeStoryCameronChainFixture';

const story = (tradeId: string) =>
  buildAflTradeStory(cameronChainBatch, tradeId, cameronChainNames);
const cameron = story(TRADE.cameron);

const netOf = <Net extends AflTradeStoryNet>(nets: readonly Net[], clubId: string): Net => {
  const net = nets.find((candidate) => candidate.clubId === clubId);
  if (!net) throw new Error(`No net for ${clubId}`);
  return net;
};
const pavOf = ({ value }: Pick<AflTradeStoryAsset, 'value'>) =>
  value.kind === 'known' ? value.pav : value.pending;
/** What an asset became, as `player (club abbreviation) pav`. */
const became = (asset: AflTradeStoryAsset) =>
  asset.outcome.kind === 'player'
    ? `${asset.label} → ${asset.outcome.playerName} (${asset.outcome.clubId}) ${pavOf(asset)}`
    : `${asset.label} → ${asset.outcome.kind === 'pending' ? asset.outcome.pending : 'not used'}`;
const everyAsset = (built: AflTradeStory) => built.lineage.trades.flatMap(({ assets }) => assets);

describe('realized trade story: the Cameron trade', () => {
  it('names the trade and its clubs', () => {
    expect(cameron.trade).toEqual({
      id: TRADE.cameron,
      year: 2020,
      clubs: [
        { clubId: CLUB.gee, clubName: 'Geelong' },
        { clubId: CLUB.gws, clubName: 'GWS' },
      ],
    });
    expect(cameron.events).toEqual([]);
  });

  it('shows both sides with what every asset became', () => {
    const [geelong, gws] = cameron.sides;
    expect(geelong!.received.map(became)).toEqual([
      'Jeremy Cameron → Jeremy Cameron (club:gee) 95.3',
      '2021 2nd round (GWS) → Paul Curtis (club:nth) 51.6',
      '2021 2nd round (ESS) → James Willis (club:gee) 0',
    ]);
    expect(gws!.received.map(became)).toEqual([
      'Pick 13 → Conor Stone (club:gws) 8.6',
      'Pick 15 (WCE) → Ryan Angwin (club:gws) 20.7',
      'Pick 20 → pick 25 → Brayden Cook (club:ade) 23.5',
      '2021 4th round → Jase Burgoyne (club:pta) 43.2',
    ]);
    expect(geelong!.gave).toEqual(gws!.received);
    expect(geelong!.receivedValue).toBeCloseTo(146.9, 9);
    expect(gws!.receivedValue).toBeCloseTo(96.0, 9);
    const curtis = geelong!.received[1]!.outcome;
    expect(curtis).toMatchObject({
      selection: { selectionNumber: 35, draftYear: 2021 },
      stint: 'open',
    });
  });

  it('is Geelong +50.9 and GWS −50.9 on the trade alone', () => {
    expect(netOf(cameron.nets.tradeAlone, CLUB.gee).net).toBeCloseTo(50.9, 9);
    expect(netOf(cameron.nets.tradeAlone, CLUB.gws).net).toBeCloseTo(-50.9, 9);
    expect(cameron.nets.tradeAlone.every(({ pendingCount }) => pendingCount === 0)).toBe(true);
  });

  it('follows each club’s next moves: Geelong +7.7 with pick 34 pending, GWS −57.6', () => {
    const geelong = netOf(cameron.nets.withNextMoves, CLUB.gee);
    expect(geelong.net).toBeCloseTo(7.7, 9);
    expect(geelong.pending).toEqual([{ assetId: 'pick:2021-34-gee', direction: 'given' }]);
    expect(geelong).toMatchObject({ pendingCount: 1, tradeIds: [TRADE.cameron, TRADE.geeWbd] });
    const gws = netOf(cameron.nets.withNextMoves, CLUB.gws);
    expect(gws.net).toBeCloseTo(-57.6, 9);
    expect(gws).toMatchObject({ pendingCount: 0, tradeIds: [TRADE.cameron, TRADE.gwsCol] });
  });

  it('values every asset by what it became, the same in every trade it passes through', () => {
    const values = new Map<string, Set<string>>();
    for (const asset of [...everyAsset(cameron), ...everyAsset(story(TRADE.geeWbd))])
      values.set(
        asset.assetId,
        (values.get(asset.assetId) ?? new Set()).add(became(asset).split(' → ').at(-1)!)
      );
    expect(Object.fromEntries([...values].map(([id, seen]) => [id, [...seen]]))).toMatchObject({
      'player:jeremy-cameron': ['Jeremy Cameron (club:gee) 95.3'],
      'pick:2021-r2-gws': ['Paul Curtis (club:nth) 51.6'],
      'pick:2021-r2-ess': ['James Willis (club:gee) 0'],
      'pick:2020-13-gee': ['Conor Stone (club:gws) 8.6'],
      'pick:2020-15-wce': ['Ryan Angwin (club:gws) 20.7'],
      'pick:2020-20-gee': ['Brayden Cook (club:ade) 23.5'],
      'pick:2021-r4-gee': ['Jase Burgoyne (club:pta) 43.2'],
      'pick:2021-r1-col': ['Finn Callaghan (club:gws) 60'],
      'pick:2021-23-ade': ['Mitch Knevitt (club:gee) 8.4'],
      'pick:2020-30-gws': ['Liam McMahon (club:col) 0'],
      'pick:2020-27-ade': ["Nathan O'Driscoll (club:fre) 24.8"],
      'pick:2021-52-wbd': ['Flynn Kroeger (club:gee) 0'],
      'pick:2021-47-nth': ['Arthur Jones (club:wbd) 12.9'],
      'pick:2022-r3-nth': ['Harvey Gallagher (club:wbd) 11.3'],
    });
    expect(everyAsset(cameron).some((asset) => pavOf(asset) === OLD_RULE_RETURN_VALUE)).toBe(false);
  });

  it('keeps every pick spent matching a bid pending, never 0', () => {
    const assets = [...everyAsset(cameron), ...everyAsset(story(TRADE.geeWbd))];
    const bids = ['pick:2021-34-gee', 'pick:2021-42-nth', 'pick:2022-r3-wbd', 'pick:2021-r3-ade'];
    for (const assetId of bids) {
      const asset = assets.find((candidate) => candidate.assetId === assetId);
      expect(asset).toMatchObject({
        value: { kind: 'pending', pending: 'matched_bid' },
        outcome: { kind: 'pending', pending: 'matched_bid' },
      });
    }
  });

  it('groups what each club ended up with, then the ones that got away', () => {
    const groups = cameron.players.map(
      (player) =>
        `${player.group} ${player.clubName}: ${player.outcome.kind === 'player' ? player.outcome.playerName : player.outcome.kind}`
    );
    expect(groups).toEqual([
      'ended_with Geelong: Jeremy Cameron',
      'ended_with Geelong: Mitch Knevitt',
      'ended_with Geelong: James Willis',
      'ended_with GWS: Finn Callaghan',
      'ended_with GWS: Ryan Angwin',
      'ended_with GWS: Conor Stone',
      'got_away North Melbourne: Paul Curtis',
      'got_away Port Adelaide: Jase Burgoyne',
      'got_away Adelaide: Brayden Cook',
      'got_away Collingwood: Liam McMahon',
      'got_away Western Bulldogs: pending',
    ]);
    const [cameronCard] = cameron.players;
    expect(cameronCard).toMatchObject({
      acquired: { tradeId: TRADE.cameron, fromClubId: CLUB.gws, pickLabel: null },
      value: { kind: 'known', pav: 95.3 },
      stillAtClub: true,
    });
    const knevitt = cameron.players[1]!;
    expect(knevitt.acquired).toEqual({
      tradeId: TRADE.geeWbd,
      fromClubId: CLUB.wbd,
      pickLabel: 'Pick 23 · 2021 (ADE)',
    });
    const mcMahon = cameron.players.find(({ assetId }) => assetId === 'pick:2020-30-gws');
    expect(mcMahon).toMatchObject({ stillAtClub: false, outcome: { stint: 'closed' } });
  });

  it('links the six trades of the chain and its seven clubs, and no others', () => {
    const { trades } = cameron.lineage;
    expect(trades.map(({ tradeId }) => tradeId)).toEqual([
      TRADE.cameron,
      TRADE.gwsCol,
      TRADE.colAde,
      TRADE.colPta,
      TRADE.geeWbd,
      TRADE.wbdNth,
    ]);
    expect(new Set(trades.flatMap(({ clubs }) => clubs.map(({ clubId }) => clubId))).size).toBe(7);
    const colAde = trades.find(({ tradeId }) => tradeId === TRADE.colAde)!;
    expect(netOf(colAde.nets, CLUB.col).net).toBeCloseTo(1.3, 9);
    expect(netOf(colAde.nets, CLUB.ade)).toMatchObject({
      pending: [{ assetId: 'pick:2021-r3-ade', direction: 'given' }],
    });
  });

  it('follows each asset hop by hop to its final selection', () => {
    const r2 = cameron.lineage.assets.find(({ assetId }) => assetId === 'pick:2021-r2-gws')!;
    expect(r2.hops.map(({ tradeId, clubId, relation }) => [tradeId, clubId, relation])).toEqual([
      [TRADE.cameron, CLUB.gee, 'this'],
      [TRADE.geeWbd, CLUB.wbd, 'after'],
      [TRADE.wbdNth, CLUB.nth, 'after'],
    ]);
    expect(r2.outcome).toMatchObject({
      kind: 'player',
      playerName: 'Paul Curtis',
      clubId: CLUB.nth,
    });
  });
});

describe('realized trade story: the 2021 Geelong ⇄ Bulldogs trade', () => {
  const swap = story(TRADE.geeWbd);

  it('is Geelong −43.2 and the Bulldogs +43.2 alone, then Bulldogs +15.8 with three bids pending', () => {
    expect(netOf(swap.nets.tradeAlone, CLUB.gee)).toMatchObject({ pendingCount: 1 });
    expect(netOf(swap.nets.tradeAlone, CLUB.gee).net).toBeCloseTo(-43.2, 9);
    expect(netOf(swap.nets.tradeAlone, CLUB.wbd).net).toBeCloseTo(43.2, 9);
    const bulldogs = netOf(swap.nets.withNextMoves, CLUB.wbd);
    expect(bulldogs.net).toBeCloseTo(15.8, 9);
    expect(bulldogs.pending).toEqual([
      { assetId: 'pick:2021-34-gee', direction: 'received' },
      { assetId: 'pick:2022-r3-wbd', direction: 'given' },
      { assetId: 'pick:2021-42-nth', direction: 'received' },
    ]);
    expect(bulldogs.tradeIds).toEqual([TRADE.geeWbd, TRADE.wbdNth]);
    expect(netOf(swap.nets.withNextMoves, CLUB.gee).net).toBeCloseTo(-43.2, 9);
  });

  it('links two trades and three clubs, and shows where pick 32 came from', () => {
    expect(swap.lineage.trades.map(({ tradeId }) => tradeId)).toEqual([TRADE.geeWbd, TRADE.wbdNth]);
    const wbdNth = swap.lineage.trades[1]!;
    expect(netOf(wbdNth.nets, CLUB.wbd).net).toBeCloseTo(-27.4, 9);
    const pick32 = swap.lineage.assets.find(({ assetId }) => assetId === 'pick:2021-r2-gws')!;
    expect(pick32.hops[0]).toMatchObject({
      tradeId: TRADE.cameron,
      fromClubId: CLUB.gws,
      clubId: CLUB.gee,
      relation: 'before',
    });
  });
});

describe('realized trade story invariants', () => {
  it('makes every trade zero-sum on its known values, with each pending asset on both sides', () => {
    for (const { transactionId } of cameronChainBatch.content.trades) {
      const { tradeAlone } = story(transactionId).nets;
      expect(tradeAlone.reduce((total, { net }) => total + net, 0)).toBeCloseTo(0, 9);
      const pending = tradeAlone.flatMap(({ pending: assets }) => assets);
      const received = pending.filter(({ direction }) => direction === 'received');
      expect(received.map(({ assetId }) => assetId).sort()).toEqual(
        pending
          .filter(({ direction }) => direction === 'given')
          .map(({ assetId }) => assetId)
          .sort()
      );
    }
  });

  it('fails closed on a missing name instead of guessing', () => {
    const names = { ...cameronChainNames, clubs: new Map([[CLUB.gee, 'Geelong']]) };
    expect(() => buildAflTradeStory(cameronChainBatch, TRADE.cameron, names)).toThrow(
      'The trade story has no name for club club:gws.'
    );
    expect(() => story('trade:unknown')).toThrow(
      'The trade story has no trade trade:unknown in its batch.'
    );
  });
});
