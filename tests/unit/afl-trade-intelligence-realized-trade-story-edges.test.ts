import { describe, expect, it } from 'vitest';

import {
  samplePoints as at,
  sealAflTradeStorySample,
  type AflTradeStorySampleLeg,
  type AflTradeStorySampleTrade,
} from '@/server/aflTradeIntelligence/development/tradeStorySampleLines';
import {
  buildAflTradeStory,
  type AflTradeStoryNames,
  type AflTradeStoryNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';
import type { AflTradeStructureOnwardLink } from '@/server/aflTradeIntelligence/valuation/tradeStructureContracts';
import type {
  AflTradeValueLineAsset,
  AflTradeValueLinePoint,
} from '@/server/aflTradeIntelligence/valuation/valueLineContracts';

/** Small synthetic structures and value lines for the paths the Cameron chain does not take. */
function world() {
  const names = {
    clubs: new Map(['A', 'B', 'C', 'D'].map((club) => [club, `Club ${club}`])),
    players: new Map<string, string>(),
    labels: new Map<string, string>(),
  } satisfies AflTradeStoryNames;
  const assets = new Map<string, AflTradeValueLineAsset>();
  const NOW = at.seasonEnd(2026);
  const base = { pickId: null, playerId: null, clubId: null, draftYear: null, share: null };
  const line = (asset: Omit<AflTradeValueLineAsset, keyof typeof base> & Partial<typeof base>) =>
    assets.set(asset.assetKey, { ...base, ...asset });
  const leg = (
    transferId: string,
    assetKey: string,
    [from, to]: string,
    year: number,
    rest: { onward?: AflTradeStructureOnwardLink; atTrade?: AflTradeValueLinePoint } = {}
  ): AflTradeStorySampleLeg => ({
    transferId,
    assetKind: assetKey.startsWith('player|') ? 'player' : 'pick',
    sendingClubId: from!,
    receivingClubId: to!,
    assetKey,
    atTrade: rest.atTrade ?? at.pending(at.trade(year), 'slot_unknown'),
    ...(rest.onward ? { onward: rest.onward } : {}),
  });
  /** A pick hop; `pick` names the pick, its label and its line. */
  const pick = (transferId: string, pick: string, move: string, year: number) => {
    names.labels.set(transferId, pick);
    return leg(transferId, `pick|${pick}`, move, year);
  };
  const selected = (
    transferId: string,
    pickId: string,
    move: string,
    year: number,
    pav: number,
    state: 'open' | 'closed' = 'open'
  ) => {
    names.players.set(`player:${pickId}`, `Drafted with ${pickId}`);
    if (!assets.has(`pick|${pickId}`))
      line({
        assetKey: `pick|${pickId}`,
        kind: 'pick',
        basis: 'pick_selected',
        pickId,
        playerId: `player:${pickId}`,
        clubId: move[1]!,
        draftYear: year,
        points: [at.stint(NOW, pav, state, { selectionNumber: 30, source: 'used_selection' })],
      });
    return pick(transferId, pickId, move, year);
  };
  const onward = (
    transferId: string,
    pickId: string,
    move: string,
    year: number,
    [transactionId, onwardTransferId]: readonly [string, string]
  ): AflTradeStorySampleLeg => ({
    ...pick(transferId, pickId, move, year),
    onward: { kind: 'pick_trail', transactionId, transferId: onwardTransferId },
  });
  const player = (
    transferId: string,
    playerId: string,
    move: string,
    year: number,
    point: AflTradeValueLinePoint
  ) => {
    names.players.set(playerId, playerId);
    const assetKey = `player|${playerId}|${move[1]}|${year + 1}`;
    line({
      assetKey,
      kind: 'player',
      basis: 'traded_player',
      playerId,
      clubId: move[1]!,
      points: [point],
    });
    return leg(transferId, assetKey, move, year);
  };
  const trade = (
    transactionId: string,
    tradeYear: number,
    legs: AflTradeStorySampleLeg[]
  ): AflTradeStorySampleTrade => ({ transactionId, tradeYear, legs });
  const seal = (trades: AflTradeStorySampleTrade[]) =>
    sealAflTradeStorySample({ trades, assets: [...assets.values()], throughSeason: 2026 });
  return { names, line, leg, pick, selected, onward, player, trade, seal, NOW };
}

const netOf = <Net extends AflTradeStoryNet>(nets: readonly Net[], clubId: string): Net =>
  nets.find((net) => net.clubId === clubId)!;
const groups = (players: ReturnType<typeof buildAflTradeStory>['players']) =>
  players.map(({ group, clubId, assetId }) => `${group} ${clubId} ${assetId}`);

describe('trade story edge cases', () => {
  it('follows a special entitlement to its successor pick, and cancels it when passed on', () => {
    const { names, line, pick, trade, seal, NOW } = world();
    line({
      assetKey: 'pick|S',
      kind: 'pick',
      basis: 'pick_pending',
      pickId: 'S',
      draftYear: 2020,
      points: [at.pending(NOW, 'matched_bid')],
    });
    names.labels.set('t1-entitlement', 'Entitlement E');
    const lines = seal([
      trade('T1', 2020, [
        {
          ...pick('t1-entitlement', 'S', 'AB', 2020),
          onward: {
            kind: 'special_entitlement_successor',
            transactionId: 'T2',
            transferId: 't2-successor',
            entitlementId: 'E',
          },
        },
      ]),
      trade('T2', 2020, [pick('t2-successor', 'S', 'BC', 2020)]),
    ]);
    const built = buildAflTradeStory(lines, 'T1', names);
    expect(built.sides[0]!.gave[0]!.value).toEqual({ kind: 'pending', pending: 'matched_bid' });
    expect(built.lineage.assets[0]!.hops.map(({ tradeId, clubId }) => tradeId + clubId)).toEqual([
      'T1B',
      'T2C',
    ]);
    expect(netOf(built.nets.withNextMoves, 'B')).toMatchObject({ pendingCount: 0, net: 0 });
    expect(netOf(built.nets.withNextMoves, 'A').pending).toEqual([
      { assetId: 'S', assetKey: 'pick|S', direction: 'given', reason: 'matched_bid' },
    ]);
    const successor = buildAflTradeStory(lines, 'T2', names);
    expect(successor.lineage.assets[0]!.hops[0]).toMatchObject({
      tradeId: 'T1',
      relation: 'before',
    });
  });

  it('counts a pick passed back to a club of the trade as ended with, in that club’s chain', () => {
    const { names, selected, onward, trade, seal } = world();
    const lines = seal([
      trade('T1', 2020, [
        onward('t1-p', 'P', 'AB', 2020, ['T2', 't2-p']),
        selected('t1-q', 'Q', 'BA', 2020, 10),
      ]),
      trade('T2', 2021, [
        selected('t2-p', 'P', 'BA', 2021, 20),
        selected('t2-r', 'R', 'AB', 2021, 5),
      ]),
    ]);
    const built = buildAflTradeStory(lines, 'T1', names);
    expect(groups(built.players)).toEqual(['ended_with A P', 'ended_with A Q', 'ended_with B R']);
    expect(netOf(built.nets.withNextMoves, 'A')).toMatchObject({ net: 5, tradeIds: ['T1', 'T2'] });
    expect(netOf(built.nets.tradeAlone, 'A').net).toBe(-10);
  });

  it('lets a player traded on along the chain get away, valued at each receiving club', () => {
    const { names, selected, onward, player, trade, seal, NOW } = world();
    const lines = seal([
      trade('T1', 2020, [
        player('t1-x', 'player:X', 'AB', 2020, at.stint(NOW, 10)),
        onward('t1-v', 'V', 'AB', 2020, ['T2', 't2-v']),
        selected('t1-s', 'S', 'BA', 2020, 7),
      ]),
      trade('T2', 2021, [
        player('t2-x', 'player:X', 'BC', 2021, at.stint(NOW, 40)),
        selected('t2-v', 'V', 'BC', 2021, 3),
        selected('t2-w', 'W', 'CB', 2021, 50),
      ]),
    ]);
    const built = buildAflTradeStory(lines, 'T1', names);
    expect(groups(built.players)).toEqual([
      'ended_with A S',
      'ended_with B W',
      'got_away C player:X',
      'got_away C V',
    ]);
    // B: +10 + 3 − 7 on T1, then +50 − 40 − 3 on T2. The player does not cancel.
    expect(netOf(built.nets.withNextMoves, 'B').net).toBe(13);
  });

  it('values future picks at their slot, signs a negative stint, and keeps a three-club trade zero-sum', () => {
    const { names, line, leg, selected, onward, player, trade, seal, NOW } = world();
    line({
      assetKey: 'pick|F',
      kind: 'pick',
      basis: 'pick_future',
      pickId: 'F',
      draftYear: 2027,
      points: [at.pick(NOW, { selectionNumber: 30, source: 'order' }, 13.8)],
    });
    line({
      assetKey: 'pick|N',
      kind: 'pick',
      basis: 'pick_not_used',
      pickId: 'N',
      draftYear: 2022,
      points: [at.notUsed(NOW)],
    });
    names.labels.set('t-f', 'Future pick').set('t-n', 'Pick N');
    const lines = seal([
      trade('T', 2022, [
        onward('t-u', 'U', 'AB', 2022, ['T2', 't2-u']),
        player('t-y', 'player:Y', 'BC', 2022, at.pending(NOW, 'traded_player_fit_not_stored')),
        player('t-z', 'player:Z', 'BC', 2022, at.stint(NOW, -4.5, 'closed')),
        leg('t-f', 'pick|F', 'CA', 2022, {
          atTrade: at.pick(at.trade(2022), { selectionNumber: 30, source: 'order' }, 13.8),
        }),
        leg('t-n', 'pick|N', 'AC', 2022),
      ]),
      trade('T2', 2022, [selected('t2-u', 'U', 'BD', 2022, 12)]),
    ]);
    const built = buildAflTradeStory(lines, 'T', names);
    const values = Object.fromEntries(
      built.lineage.trades[0]!.assets.map(({ assetId, value, outcome }) => [
        assetId,
        [value, outcome.kind],
      ])
    );
    expect(values).toEqual({
      U: [{ kind: 'known', pav: 12 }, 'player'],
      'player:Y': [{ kind: 'pending', pending: 'traded_player_fit_not_stored' }, 'pending'],
      'player:Z': [{ kind: 'known', pav: -4.5 }, 'player'],
      F: [{ kind: 'known', pav: 13.8 }, 'pick'],
      N: [{ kind: 'known', pav: 0 }, 'not_used'],
    });
    expect(built.sides.find(({ clubId }) => clubId === 'C')!.gave[0]!.outcome).toEqual({
      kind: 'pick',
      draftYear: 2027,
      selectionNumber: 30,
      source: 'order',
    });
    const nets = built.nets.tradeAlone.map(({ clubId, net, pendingCount }) => [
      clubId,
      net,
      pendingCount,
    ]);
    // A: +13.8 − 12 − 0; B: +12 + 4.5 (Z given), Y pending; C: −13.8 + 0 − 4.5, Y pending.
    expect(nets).toEqual([
      ['A', 1.8, 0],
      ['B', 16.5, 1],
      ['C', -18.3, 1],
    ]);
    expect(built.nets.tradeAlone.reduce((total, { net }) => total + net, 0)).toBeCloseTo(0, 9);
    // Signed values sort below 0, and a pending value after every known one.
    expect(groups(built.players)).toEqual([
      'ended_with A F',
      'ended_with C N',
      'ended_with C player:Z',
      'ended_with C player:Y',
      'got_away D U',
    ]);
  });

  it('fails closed on a cycle of onward links', () => {
    const { names, onward, trade, seal, line, NOW } = world();
    line({
      assetKey: 'pick|P',
      kind: 'pick',
      basis: 'pick_pending',
      pickId: 'P',
      draftYear: 2021,
      points: [at.pending(NOW, 'unavailable')],
    });
    const lines = seal([
      trade('T1', 2020, [onward('t1-p', 'P', 'AB', 2020, ['T2', 't2-p'])]),
      trade('T2', 2020, [onward('t2-p', 'P', 'BA', 2020, ['T1', 't1-p'])]),
    ]);
    expect(() => buildAflTradeStory(lines, 'T1', names)).toThrow(
      'The trade story found a cycle at transfer t1-p.'
    );
  });
});
