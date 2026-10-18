import type {
  AflTradeStoryBatch,
  AflTradeStoryLeg,
  AflTradeStoryNames,
  AflTradeStorySelection,
  AflTradeStoryTrade,
  AflTradeStoryTransferAsset,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

/**
 * The Jeremy Cameron trade chain (2020 GWS ⇄ Geelong and the trades its assets passed through), as
 * a realized-trade-grade batch reduced to the fields the story reads. Values are first-stint PAV to
 * 2026 from the approved trade-page mockups. Two off-chain trades (Collingwood ⇄ Fremantle and
 * North ⇄ Geelong) exist only so picks 27 and 52 reach their selections: their return legs are
 * fixture placeholders, not history.
 *
 * Sample data, not a sealed batch: the story unit tests and the private trade page's sample source
 * (`tradeStorySamples.ts`) both read it. Never publication evidence.
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

const players = new Map<string, string>();
const picks = new Map<string, AflTradeStorySelection>();
const transfers = new Map<string, AflTradeStoryTransferAsset>();
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

type Move = readonly [from: ClubKey, to: ClubKey];
/** A first stint: the player's name, its PAV, and whether it is still open. */
type Stint = readonly [name: string, pav: number, status?: 'open' | 'closed'];

const legBase = (key: string, kind: 'player' | 'pick', [from, to]: Move) => ({
  transferId: `transfer:${key}`,
  assetKind: kind,
  sendingClubId: CLUB[from],
  receivingClubId: CLUB[to],
});

function player(move: Move, [name, pav, status = 'open']: Stint): AflTradeStoryLeg {
  const playerId = `player:${slug(name)}`;
  players.set(playerId, name);
  const leg = { ...legBase(slug(name), 'player', move), basis: 'player_first_stint' as const };
  transfers.set(leg.transferId, { kind: 'player', playerId });
  return { ...leg, realizedValue: pav, stint: { status } };
}

/** One hop of a pick. `pickId` is stable across hops; `label` is how this transfer names it. */
function pick(
  pickId: string,
  label: string,
  move: Move,
  rest: Omit<AflTradeStoryLeg, keyof ReturnType<typeof legBase>>
) {
  const leg = { ...legBase(`${pickId}:${move.join('-')}`, 'pick', move), ...rest };
  transfers.set(leg.transferId, { kind: 'pick', pickId: `pick:${pickId}`, label });
  return leg;
}

/** The old return rule's value, which the story must never read. */
export const OLD_RULE_RETURN_VALUE = 999;
const onward = (pickId: string, label: string, move: Move, transactionId: string) =>
  pick(pickId, label, move, {
    basis: 'pick_traded_on_return',
    realizedValue: OLD_RULE_RETURN_VALUE,
    onward: { transactionId },
  });
const matchedBid = (pickId: string, label: string, move: Move) =>
  pick(pickId, label, move, { basis: 'pick_not_used_nominee_excluded' });
const placeholder = (pickId: string, move: Move) =>
  pick(pickId, 'Fixture placeholder return', move, {
    basis: 'pick_not_used_no_nominee',
    realizedValue: 0,
  });

function selected(
  pickId: string,
  label: string,
  move: Move,
  [selectionNumber, draftYear]: readonly [number, number],
  [name, pav, status = 'open']: Stint
) {
  const playerId = `player:${slug(name)}`;
  players.set(playerId, name);
  picks.set(`pick:${pickId}`, { playerId, selectionNumber, draftYear });
  return pick(pickId, label, move, {
    basis: 'pick_selected_first_stint',
    realizedValue: pav,
    stint: { status },
  });
}

const trade = (
  transactionId: string,
  tradeYear: number,
  legs: AflTradeStoryLeg[]
): AflTradeStoryTrade => ({
  transactionId,
  tradeYear,
  clubs: [...new Set(legs.flatMap((leg) => [leg.sendingClubId, leg.receivingClubId]))]
    .sort()
    .map((clubId) => ({ clubId })),
  legs,
});

const R2_GWS = '2021-r2-gws';
const PICK_20 = '2020-20-gee';
const R4_GEE = '2021-r4-gee';
const PICK_27 = '2020-27-ade';
const PICK_52 = '2021-52-wbd';

export const cameronChainBatch: AflTradeStoryBatch = {
  content: {
    trades: [
      trade(TRADE.cameron, 2020, [
        player(['gws', 'gee'], ['Jeremy Cameron', 95.3]),
        onward(R2_GWS, '2021 2nd round (GWS)', ['gws', 'gee'], TRADE.geeWbd),
        selected(
          '2021-r2-ess',
          '2021 2nd round (ESS)',
          ['gws', 'gee'],
          [32, 2021],
          ['James Willis', 0]
        ),
        selected('2020-13-gee', 'Pick 13', ['gee', 'gws'], [15, 2020], ['Conor Stone', 8.6]),
        selected('2020-15-wce', 'Pick 15 (WCE)', ['gee', 'gws'], [18, 2020], ['Ryan Angwin', 20.7]),
        onward(PICK_20, 'Pick 20 → 25', ['gee', 'gws'], TRADE.gwsCol),
        onward(R4_GEE, '2021 4th round', ['gee', 'gws'], TRADE.gwsCol),
      ]),
      trade(TRADE.gwsCol, 2020, [
        onward(PICK_20, 'Pick 20 → 25', ['gws', 'col'], TRADE.colAde),
        onward(R4_GEE, '2021 4th round (GEE)', ['gws', 'col'], TRADE.colPta),
        selected(
          '2020-30-gws',
          'Pick 30',
          ['gws', 'col'],
          [30, 2020],
          ['Liam McMahon', 0, 'closed']
        ),
        selected(
          '2021-r1-col',
          '2021 1st round (COL)',
          ['col', 'gws'],
          [3, 2021],
          ['Finn Callaghan', 60]
        ),
      ]),
      trade(TRADE.colAde, 2020, [
        selected(PICK_20, 'Pick 25', ['col', 'ade'], [25, 2020], ['Brayden Cook', 23.5]),
        onward(PICK_27, 'Pick 27', ['ade', 'col'], TRADE.colFre),
        matchedBid('2021-r3-ade', '2021 3rd round (ADE)', ['ade', 'col']),
      ]),
      trade(TRADE.colPta, 2020, [
        selected(R4_GEE, '2021 4th round', ['col', 'pta'], [60, 2021], ['Jase Burgoyne', 43.2]),
        selected('2020-49-col', 'Pick 49', ['col', 'pta'], [49, 2020], ['Ollie Lord', 11.9]),
        selected('2020-44-pta', 'Pick 44', ['pta', 'col'], [44, 2020], ['Beau McCreery', 51.3]),
      ]),
      trade(TRADE.colFre, 2020, [
        selected(PICK_27, 'Pick 27', ['col', 'fre'], [27, 2020], ["Nathan O'Driscoll", 24.8]),
        placeholder('2020-fre-placeholder', ['fre', 'col']),
      ]),
      trade(TRADE.geeWbd, 2021, [
        onward(R2_GWS, 'Pick 32 · 2021 (GWS)', ['gee', 'wbd'], TRADE.wbdNth),
        matchedBid('2021-34-gee', 'Pick 34 · 2021 (GEE)', ['gee', 'wbd']),
        selected(
          '2021-23-ade',
          'Pick 23 · 2021 (ADE)',
          ['wbd', 'gee'],
          [25, 2021],
          ['Mitch Knevitt', 8.4]
        ),
      ]),
      trade(TRADE.wbdNth, 2021, [
        selected(R2_GWS, 'Pick 32', ['wbd', 'nth'], [35, 2021], ['Paul Curtis', 51.6]),
        onward(PICK_52, 'Pick 52', ['wbd', 'nth'], TRADE.nthGee),
        matchedBid('2022-r3-wbd', '2022 3rd round (WBD)', ['wbd', 'nth']),
        selected('2021-47-nth', 'Pick 47', ['nth', 'wbd'], [43, 2021], ['Arthur Jones', 12.9]),
        selected(
          '2022-r3-nth',
          '2022 3rd round (NTH)',
          ['nth', 'wbd'],
          [39, 2022],
          ['Harvey Gallagher', 11.3]
        ),
        matchedBid('2021-42-nth', 'Pick 42', ['nth', 'wbd']),
      ]),
      trade(TRADE.nthGee, 2021, [
        selected(PICK_52, 'Pick 52', ['nth', 'gee'], [52, 2021], ['Flynn Kroeger', 0]),
        placeholder('2021-gee-placeholder', ['gee', 'nth']),
      ]),
    ],
  },
};

export const cameronChainNames: AflTradeStoryNames = {
  clubs: new Map(Object.entries(CLUB).map(([key, id]) => [id, CLUB_NAMES[key as ClubKey]])),
  players,
  picks,
  transfers,
};
