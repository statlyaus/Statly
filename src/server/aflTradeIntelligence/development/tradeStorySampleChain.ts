import type { AflTradeStoryNames } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';
import { aflTradeMatchedBidShares } from '@/server/aflTradeIntelligence/valuation/matchedBidShares';
import type {
  AflTradeValueLineAsset,
  AflTradeValueLinePoint,
  AflTradeValueLineSlotSource,
} from '@/server/aflTradeIntelligence/valuation/valueLineContracts';

import {
  samplePoints as at,
  sealAflTradeStorySample,
  type AflTradeStorySampleLeg,
  type AflTradeStorySampleTrade,
} from './tradeStorySampleLines';

/**
 * The Jeremy Cameron trade chain (2020 GWS ⇄ Geelong and the trades its assets passed through), as a
 * trade structure and the value lines on it. Each line's value at the 2026 season end is the
 * first-stint PAV to 2026 from the approved trade-page mockups; draft-night and at-trade values are
 * illustrative, from a sample slot curve. Two off-chain trades (Collingwood ⇄ Fremantle and North ⇄
 * Geelong) exist only so picks 27 and 52 reach their selections: their return legs are fixture
 * placeholders, not history. Picks 34 and 42 of 2021 are shares of Sam Darcy's matched bid.
 *
 * Sample data, not sealed outputs of a run: the story unit tests and the private trade page's sample
 * source (`tradeStorySamples.ts`) both read it. Never publication evidence.
 */

export const CLUB = {
  ade: 'club:ade',
  col: 'club:col',
  fre: 'club:fre',
  gee: 'club:gee',
  gws: 'club:gws',
  nth: 'club:nth',
  pta: 'club:pta',
  wbd: 'club:wbd',
} as const;
type ClubKey = keyof typeof CLUB;

export const TRADE = {
  cameron: 'trade:2020-gws-gee',
  gwsCol: 'trade:2020-gws-col',
  colAde: 'trade:2020-col-ade',
  colPta: 'trade:2020-col-pta',
  colFre: 'trade:2020-col-fre',
  geeWbd: 'trade:2021-gee-wbd',
  wbdNth: 'trade:2021-wbd-nth',
  nthGee: 'trade:2021-nth-gee',
} as const;

export const CAMERON_CHAIN_THROUGH_SEASON = 2026;

const CLUB_NAMES: Record<ClubKey, string> = {
  ade: 'Adelaide',
  col: 'Collingwood',
  fre: 'Fremantle',
  gee: 'Geelong',
  gws: 'GWS',
  nth: 'North Melbourne',
  pta: 'Port Adelaide',
  wbd: 'Western Bulldogs',
};

/** Sam Darcy's 2021 matched bid: the board's spent picks and his first stint to 2026. */
export const DARCY = {
  playerId: 'player:sam-darcy',
  firstStintPav: 34.71,
  /** Native id, label, the story's pick id where it is one, points used. */
  spent: [
    ['7449', 'Pick 34', 'pick:2021-34-gee', 542],
    ['6042', 'Pick 42', 'pick:2021-42-nth', 395],
    ['6057', 'Pick 43', 'pick:2021-43-wbd', 378],
    ['7451', 'Pick 44', 'pick:2021-44-wbd', 362],
    ['5727', 'Pick 45', 'pick:2021-45-wbd', 347],
  ],
  shares: aflTradeMatchedBidShares({
    draftYear: 2021,
    selectionNumber: 2,
    roundNumber: 1,
    points: 2517,
    consumedPicks: [542, 395, 378, 362, 347].map((pointsUsed, index) => ({
      nativePickId: ['7449', '6042', '6057', '7451', '5727'][index]!,
      pointsUsed,
    })),
    leftoverPicks: [{ nativePickId: '5792', points: 135 }],
  }),
} as const;

const THROUGH = CAMERON_CHAIN_THROUGH_SEASON;
const NOW = at.seasonEnd(THROUGH);
/** The sample slot curve: illustrative only, never a fitted pick curve. */
const slotValue = (slot: number) => Math.round(450 * 0.96 ** (slot - 1)) / 10;
const slotOf = (selectionNumber: number, source: AflTradeValueLineSlotSource) => ({
  selectionNumber,
  source,
});

const players = new Map<string, string>([[DARCY.playerId, 'Sam Darcy']]);
const labels = new Map<string, string>();
const assets = new Map<string, AflTradeValueLineAsset>();
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

type Move = readonly [from: ClubKey, to: ClubKey];
/** A first stint: the player's name, its PAV to 2026, and whether it is still open. */
type Stint = readonly [name: string, pav: number, status?: 'open' | 'closed'];
/** The pick's at-trade slot: stated at the trade, or a previous draft's order as a proxy. */
type AtSlot = readonly [selectionNumber: number, source: 'stated_at_trade' | 'order_proxy'] | null;
type Leg = AflTradeStorySampleLeg & { readonly onwardTradeId?: string };

const BASE = { pickId: null, playerId: null, clubId: null, draftYear: null, share: null };

function addLine(asset: AflTradeValueLineAsset) {
  if (!assets.has(asset.assetKey)) assets.set(asset.assetKey, asset);
}

function player(year: number, move: Move, [name, pav, status = 'open']: Stint, atTradePav: number) {
  const playerId = `player:${slug(name)}`;
  players.set(playerId, name);
  const assetKey = `player|${playerId}|${CLUB[move[1]]}|${year + 1}`;
  addLine({
    ...BASE,
    assetKey,
    kind: 'player',
    basis: 'traded_player',
    playerId,
    clubId: CLUB[move[1]],
    points: [at.stint(NOW, pav, status)],
  });
  return {
    transferId: `transfer:${slug(name)}`,
    assetKind: 'player' as const,
    sendingClubId: CLUB[move[0]],
    receivingClubId: CLUB[move[1]],
    assetKey,
    atTrade: at.stint(at.trade(year), atTradePav),
  };
}

/** One hop of a pick. `pickId` is stable across hops; `label` is how this transfer names it. */
function hop(pickId: string, label: string, year: number, move: Move, slot: AtSlot): Leg {
  const transferId = `transfer:${pickId}:${move.join('-')}`;
  labels.set(transferId, label);
  const atTrade: AflTradeValueLinePoint =
    slot === null
      ? at.pending(at.trade(year), 'slot_unknown')
      : at.pick(at.trade(year), slotOf(...slot), slotValue(slot[0]));
  return {
    transferId,
    assetKind: 'pick',
    sendingClubId: CLUB[move[0]],
    receivingClubId: CLUB[move[1]],
    assetKey: `pick|pick:${pickId}`,
    atTrade,
  };
}

const onward = (
  pickId: string,
  label: string,
  [year, move, slot]: readonly [number, Move, AtSlot],
  onwardTradeId: string
): Leg => ({ ...hop(pickId, label, year, move, slot), onwardTradeId });

function selected(
  pickId: string,
  label: string,
  [year, move, slot]: readonly [number, Move, AtSlot],
  [selectionNumber, draftYear]: readonly [number, number],
  [name, pav, status = 'open']: Stint
): Leg {
  const playerId = `player:${slug(name)}`;
  players.set(playerId, name);
  const used = slotOf(selectionNumber, 'used_selection');
  addLine({
    ...BASE,
    assetKey: `pick|pick:${pickId}`,
    kind: 'pick',
    basis: 'pick_selected',
    pickId: `pick:${pickId}`,
    playerId,
    clubId: CLUB[move[1]],
    draftYear,
    points: [
      at.stint(at.draft(draftYear), slotValue(selectionNumber), 'open', used),
      at.stint(NOW, pav, status, used),
    ],
  });
  return hop(pickId, label, year, move, slot);
}

/** A pick spent matching Sam Darcy's bid: its share of his line from the 2021 draft. */
function bidShare(pickId: string, label: string, year: number, move: Move): Leg {
  if (DARCY.shares.status !== 'shared') throw new Error('The Darcy sample bid is not priced.');
  const index = DARCY.spent.findIndex(([, , id]) => id === `pick:${pickId}`);
  const share = DARCY.shares.picks[index]!.share;
  const bid = slotOf(2, 'bid_selection');
  addLine({
    ...BASE,
    assetKey: `pick|pick:${pickId}`,
    kind: 'pick',
    basis: 'pick_matched_bid_share',
    pickId: `pick:${pickId}`,
    playerId: DARCY.playerId,
    clubId: CLUB.wbd,
    draftYear: 2021,
    share,
    points: [
      at.stint(at.draft(2021), share * slotValue(2), 'open', bid),
      at.stint(NOW, share * DARCY.firstStintPav, 'open', bid),
    ],
  });
  return hop(pickId, label, year, move, [Number(pickId.split('-')[1]), 'stated_at_trade']);
}

/** A pick spent matching a bid the board does not price: pending, never 0. */
function bidPending(pickId: string, label: string, year: number, move: Move, draftYear: number) {
  addLine({
    ...BASE,
    assetKey: `pick|pick:${pickId}`,
    kind: 'pick',
    basis: 'pick_pending',
    pickId: `pick:${pickId}`,
    draftYear,
    points: [at.pending(at.draft(draftYear), 'matched_bid'), at.pending(NOW, 'matched_bid')],
  });
  return hop(pickId, label, year, move, null);
}

function placeholder(pickId: string, year: number, move: Move) {
  addLine({
    ...BASE,
    assetKey: `pick|pick:${pickId}`,
    kind: 'pick',
    basis: 'pick_not_used',
    pickId: `pick:${pickId}`,
    draftYear: year,
    points: [at.notUsed(at.draft(year)), at.notUsed(NOW)],
  });
  return hop(pickId, 'Fixture placeholder return', year, move, null);
}

const trade = (transactionId: string, tradeYear: number, legs: Leg[]) => ({
  transactionId,
  tradeYear,
  legs,
});

const R2_GWS = '2021-r2-gws';
const PICK_20 = '2020-20-gee';
const R4_GEE = '2021-r4-gee';
const PICK_27 = '2020-27-ade';
const PICK_52 = '2021-52-wbd';
const in2020 = (move: Move, slot: AtSlot = null) => [2020, move, slot] as const;
const in2021 = (move: Move, slot: AtSlot = null) => [2021, move, slot] as const;

const TRADES = [
  trade(TRADE.cameron, 2020, [
    player(2020, ['gws', 'gee'], ['Jeremy Cameron', 95.3], 70),
    onward(
      R2_GWS,
      '2021 2nd round (GWS)',
      in2020(['gws', 'gee'], [28, 'order_proxy']),
      TRADE.geeWbd
    ),
    selected(
      '2021-r2-ess',
      '2021 2nd round (ESS)',
      in2020(['gws', 'gee'], [25, 'order_proxy']),
      [32, 2021],
      ['James Willis', 0]
    ),
    selected(
      '2020-13-gee',
      'Pick 13',
      in2020(['gee', 'gws'], [13, 'stated_at_trade']),
      [15, 2020],
      ['Conor Stone', 8.6]
    ),
    selected(
      '2020-15-wce',
      'Pick 15 (WCE)',
      in2020(['gee', 'gws'], [15, 'stated_at_trade']),
      [18, 2020],
      ['Ryan Angwin', 20.7]
    ),
    onward(
      PICK_20,
      'Pick 20 → pick 25',
      in2020(['gee', 'gws'], [20, 'stated_at_trade']),
      TRADE.gwsCol
    ),
    onward(R4_GEE, '2021 4th round', in2020(['gee', 'gws']), TRADE.gwsCol),
  ]),
  trade(TRADE.gwsCol, 2020, [
    onward(
      PICK_20,
      'Pick 20 → pick 25',
      in2020(['gws', 'col'], [20, 'stated_at_trade']),
      TRADE.colAde
    ),
    onward(R4_GEE, '2021 4th round (GEE)', in2020(['gws', 'col']), TRADE.colPta),
    selected(
      '2020-30-gws',
      'Pick 30',
      in2020(['gws', 'col'], [30, 'stated_at_trade']),
      [30, 2020],
      ['Liam McMahon', 0, 'closed']
    ),
    selected(
      '2021-r1-col',
      '2021 1st round (COL)',
      in2020(['col', 'gws'], [6, 'order_proxy']),
      [3, 2021],
      ['Finn Callaghan', 60]
    ),
  ]),
  trade(TRADE.colAde, 2020, [
    selected(
      PICK_20,
      'Pick 25',
      in2020(['col', 'ade'], [25, 'stated_at_trade']),
      [25, 2020],
      ['Brayden Cook', 23.5]
    ),
    onward(PICK_27, 'Pick 27', in2020(['ade', 'col'], [27, 'stated_at_trade']), TRADE.colFre),
    bidPending('2021-r3-ade', '2021 3rd round (ADE)', 2020, ['ade', 'col'], 2021),
  ]),
  trade(TRADE.colPta, 2020, [
    selected(R4_GEE, '2021 4th round', in2020(['col', 'pta']), [60, 2021], ['Jase Burgoyne', 43.2]),
    selected(
      '2020-49-col',
      'Pick 49',
      in2020(['col', 'pta'], [49, 'stated_at_trade']),
      [49, 2020],
      ['Ollie Lord', 11.9]
    ),
    selected(
      '2020-44-pta',
      'Pick 44',
      in2020(['pta', 'col'], [44, 'stated_at_trade']),
      [44, 2020],
      ['Beau McCreery', 51.3]
    ),
  ]),
  trade(TRADE.colFre, 2020, [
    selected(
      PICK_27,
      'Pick 27',
      in2020(['col', 'fre'], [27, 'stated_at_trade']),
      [27, 2020],
      ["Nathan O'Driscoll", 24.8]
    ),
    placeholder('2020-fre-placeholder', 2020, ['fre', 'col']),
  ]),
  trade(TRADE.geeWbd, 2021, [
    onward(
      R2_GWS,
      'Pick 32 · 2021 (GWS)',
      in2021(['gee', 'wbd'], [32, 'stated_at_trade']),
      TRADE.wbdNth
    ),
    bidShare('2021-34-gee', 'Pick 34 · 2021 (GEE)', 2021, ['gee', 'wbd']),
    selected(
      '2021-23-ade',
      'Pick 23 · 2021 (ADE)',
      in2021(['wbd', 'gee'], [23, 'stated_at_trade']),
      [25, 2021],
      ['Mitch Knevitt', 8.4]
    ),
  ]),
  trade(TRADE.wbdNth, 2021, [
    selected(
      R2_GWS,
      'Pick 32',
      in2021(['wbd', 'nth'], [32, 'stated_at_trade']),
      [35, 2021],
      ['Paul Curtis', 51.6]
    ),
    onward(PICK_52, 'Pick 52', in2021(['wbd', 'nth'], [52, 'stated_at_trade']), TRADE.nthGee),
    bidPending('2022-r3-wbd', '2022 3rd round (WBD)', 2021, ['wbd', 'nth'], 2022),
    selected(
      '2021-47-nth',
      'Pick 47',
      in2021(['nth', 'wbd'], [47, 'stated_at_trade']),
      [43, 2021],
      ['Arthur Jones', 12.9]
    ),
    selected(
      '2022-r3-nth',
      '2022 3rd round (NTH)',
      in2021(['nth', 'wbd']),
      [39, 2022],
      ['Harvey Gallagher', 11.3]
    ),
    bidShare('2021-42-nth', 'Pick 42', 2021, ['nth', 'wbd']),
  ]),
  trade(TRADE.nthGee, 2021, [
    selected(
      PICK_52,
      'Pick 52',
      in2021(['nth', 'gee'], [52, 'stated_at_trade']),
      [52, 2021],
      ['Flynn Kroeger', 0]
    ),
    placeholder('2021-gee-placeholder', 2021, ['gee', 'nth']),
  ]),
];

/** Each onward leg links to the onward trade's transfer of the same pick, given by its receiver. */
function linked(trades: typeof TRADES): AflTradeStorySampleTrade[] {
  const byId = new Map(trades.map((one) => [one.transactionId, one]));
  return trades.map((one) => ({
    ...one,
    legs: one.legs.map(({ onwardTradeId, ...leg }) => {
      if (onwardTradeId === undefined) return leg;
      const next = byId
        .get(onwardTradeId)!
        .legs.find(
          (candidate) =>
            candidate.assetKey === leg.assetKey && candidate.sendingClubId === leg.receivingClubId
        )!;
      return {
        ...leg,
        onward: {
          kind: 'pick_trail' as const,
          transactionId: onwardTradeId,
          transferId: next.transferId,
        },
      };
    }),
  }));
}

export const cameronChainLines = sealAflTradeStorySample({
  trades: linked(TRADES),
  assets: [...assets.values()],
  throughSeason: THROUGH,
});

export const cameronChainNames: AflTradeStoryNames = {
  clubs: new Map(Object.entries(CLUB).map(([key, id]) => [id, CLUB_NAMES[key as ClubKey]])),
  players,
  labels,
};
