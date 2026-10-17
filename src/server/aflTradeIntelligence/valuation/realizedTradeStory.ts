import { AflTradeStoryIndex, type AflTradeStoryHopRef } from './realizedTradeStoryAssets';
import type {
  AflTradeStory,
  AflTradeStoryAsset,
  AflTradeStoryBatch,
  AflTradeStoryHop,
  AflTradeStoryLineageAsset,
  AflTradeStoryLineageTrade,
  AflTradeStoryNames,
  AflTradeStoryNet,
  AflTradeStoryPlayer,
  AflTradeStorySide,
  AflTradeStoryTrade,
} from './realizedTradeStoryContracts';

export type * from './realizedTradeStoryContracts';

/** A club's chain: the linked trades it is a party to, oldest first. */
interface ClubChain {
  readonly clubId: string;
  readonly trades: readonly AflTradeStoryTrade[];
}

const refsOf = (trade: AflTradeStoryTrade): AflTradeStoryHopRef[] =>
  trade.legs.map((leg) => ({ trade, leg }));

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
}

const knownPav = ({ value }: { value: AflTradeStoryAsset['value'] }) =>
  value.kind === 'known' ? value.pav : 0;
/** Values are never below 0, so a pending value sorts after every known one. */
const sortValue = ({ value }: { value: AflTradeStoryAsset['value'] }) =>
  value.kind === 'known' ? value.pav : -1;
const byValueDescending = (
  left: { value: AflTradeStoryAsset['value'] },
  right: { value: AflTradeStoryAsset['value'] }
) => sortValue(right) - sortValue(left);

/**
 * The story's trade and, repeatedly, each later trade a club of the story's trade passed a pick it
 * received into, oldest first.
 */
function linkedTrades(index: AflTradeStoryIndex, trade: AflTradeStoryTrade): AflTradeStoryTrade[] {
  const clubIds = new Set(trade.clubs.map(({ clubId }) => clubId));
  const trades = [trade];
  for (let at = 0; at < trades.length; at++)
    for (const ref of refsOf(trades[at]!)) {
      const next = clubIds.has(ref.leg.receivingClubId) ? index.nextHop(ref) : undefined;
      if (next && !trades.includes(next.trade)) trades.push(next.trade);
    }
  return trades.sort((left, right) => left.tradeYear - right.tradeYear);
}

const clubChain = (linked: readonly AflTradeStoryTrade[], clubId: string): ClubChain => ({
  clubId,
  trades: linked.filter((trade) => trade.clubs.some((club) => club.clubId === clubId)),
});

type PendingBalance = Map<string, { assetId: string; count: number }>;

function addPending(balance: PendingBalance, identity: string, assetId: string, sign: number) {
  const current = balance.get(identity) ?? { assetId, count: 0 };
  balance.set(identity, { ...current, count: current.count + sign });
}

/**
 * Known values received minus known values given, over the trades. A pending asset is counted
 * instead, by what it became, so a pick received then passed on cancels out, as its value does.
 */
function clubNet(
  index: AflTradeStoryIndex,
  trades: readonly AflTradeStoryTrade[],
  clubId: string
): AflTradeStoryNet {
  let net = 0;
  const balance: PendingBalance = new Map();
  for (const ref of trades.flatMap(refsOf)) {
    const sign =
      (ref.leg.receivingClubId === clubId ? 1 : 0) - (ref.leg.sendingClubId === clubId ? 1 : 0);
    if (sign === 0) continue;
    const asset = index.resolve(ref);
    if (asset.value.kind === 'known') net += sign * asset.value.pav;
    else addPending(balance, index.identity(ref), asset.assetId, sign);
  }
  const pending = [...balance.values()]
    .filter(({ count }) => count !== 0)
    .map(({ assetId, count }) => ({
      assetId,
      direction: count > 0 ? ('received' as const) : ('given' as const),
    }));
  return { ...index.club(clubId), net, pendingCount: pending.length, pending };
}

function storySide(
  index: AflTradeStoryIndex,
  trade: AflTradeStoryTrade,
  clubId: string
): AflTradeStorySide {
  const assets = refsOf(trade).map((ref) => index.resolve(ref));
  const received = assets.filter((asset) => asset.toClubId === clubId);
  return {
    ...index.club(clubId),
    gave: assets.filter((asset) => asset.fromClubId === clubId),
    received,
    receivedValue: received.reduce((total, asset) => total + knownPav(asset), 0),
    receivedPendingCount: received.filter((asset) => asset.value.kind === 'pending').length,
  };
}

function storyPlayer(
  index: AflTradeStoryIndex,
  final: AflTradeStoryHopRef,
  group: AflTradeStoryPlayer['group']
): AflTradeStoryPlayer {
  const asset = index.resolve(final);
  return {
    ...index.club(final.leg.receivingClubId),
    group,
    assetId: asset.assetId,
    acquired: {
      tradeId: final.trade.transactionId,
      fromClubId: final.leg.sendingClubId,
      pickLabel: asset.assetKind === 'pick' ? asset.label : null,
    },
    outcome: asset.outcome,
    value: asset.value,
    stillAtClub: asset.outcome.kind === 'player' && asset.outcome.stint === 'open',
  };
}

const chainLegs = (chain: ClubChain, side: 'receivingClubId' | 'sendingClubId') =>
  chain.trades.flatMap(refsOf).filter((ref) => ref.leg[side] === chain.clubId);

/** A player has no onward link: he is passed on if the club gives him in a later chain trade. */
function playerPassedOn(index: AflTradeStoryIndex, chain: ClubChain, ref: AflTradeStoryHopRef) {
  if (ref.leg.assetKind !== 'player') return false;
  const assetId = index.assetId(ref.leg);
  return chainLegs(
    { ...chain, trades: chain.trades.slice(chain.trades.indexOf(ref.trade) + 1) },
    'sendingClubId'
  ).some((later) => index.assetId(later.leg) === assetId);
}

/**
 * What each club of the trade ended up with (assets it received along its chain and kept), then
 * the ones that got away (assets those clubs gave along their chains that none of them kept).
 */
function storyPlayers(index: AflTradeStoryIndex, chains: readonly ClubChain[]) {
  // A pick is one holding by what it became; a player, who has no onward link, by who he is.
  const holding = (ref: AflTradeStoryHopRef) =>
    ref.leg.assetKind === 'player' ? `player|${index.assetId(ref.leg)}` : index.identity(ref);
  const kept = chains.flatMap((chain) =>
    chainLegs(chain, 'receivingClubId')
      .filter((ref) => !index.nextHop(ref) && !playerPassedOn(index, chain, ref))
      .sort((left, right) => byValueDescending(index.resolve(left), index.resolve(right)))
  );
  const keptHoldings = new Set(kept.map(holding));
  // Latest first, so a player given more than once is shown where he went last.
  const given = chains
    .flatMap((chain) => chainLegs(chain, 'sendingClubId'))
    .sort((left, right) => right.trade.tradeYear - left.trade.tradeYear);
  const gotAway = uniqueBy(given, holding)
    .filter((ref) => !keptHoldings.has(holding(ref)))
    .map((ref) => storyPlayer(index, index.finalHop(ref), 'got_away'))
    .sort(byValueDescending);
  return [...kept.map((ref) => storyPlayer(index, ref, 'ended_with')), ...gotAway];
}

function storyHop(
  index: AflTradeStoryIndex,
  ref: AflTradeStoryHopRef,
  relation: AflTradeStoryHop['relation']
): AflTradeStoryHop {
  return {
    ...index.club(ref.leg.receivingClubId),
    tradeId: ref.trade.transactionId,
    year: ref.trade.tradeYear,
    fromClubId: ref.leg.sendingClubId,
    relation,
  };
}

function lineageAsset(
  index: AflTradeStoryIndex,
  ref: AflTradeStoryHopRef
): AflTradeStoryLineageAsset {
  const { transferId, assetId, label, outcome, value } = index.resolve(ref);
  const hops = [
    ...index.backward(ref).map((hop) => storyHop(index, hop, 'before')),
    storyHop(index, ref, 'this'),
    ...index
      .forward(ref)
      .slice(1)
      .map((hop) => storyHop(index, hop, 'after')),
  ];
  return { transferId, assetId, label, hops, outcome, value };
}

function lineageTrade(
  index: AflTradeStoryIndex,
  trade: AflTradeStoryTrade
): AflTradeStoryLineageTrade {
  return {
    tradeId: trade.transactionId,
    year: trade.tradeYear,
    clubs: trade.clubs.map(({ clubId }) => index.club(clubId)),
    nets: trade.clubs.map(({ clubId }) => clubNet(index, [trade], clubId)),
    assets: refsOf(trade).map((ref) => index.resolve(ref)),
  };
}

/**
 * The linked trades and each later trade an asset of the story's trade passed through. A trade that
 * only an asset of another linked trade later passed through is not listed.
 */
function storyLineage(
  index: AflTradeStoryIndex,
  trade: AflTradeStoryTrade,
  linked: readonly AflTradeStoryTrade[]
) {
  const own = refsOf(trade);
  const withHops = [...linked, ...own.flatMap((ref) => index.forward(ref).map((hop) => hop.trade))];
  const trades = uniqueBy(withHops, (linkedTrade) => linkedTrade.transactionId).sort(
    (left, right) => left.tradeYear - right.tradeYear
  );
  return {
    trades: trades.map((linkedTrade) => lineageTrade(index, linkedTrade)),
    assets: own.map((ref) => lineageAsset(index, ref)),
  };
}

/**
 * The realized trade story of one trade in a realized-trade-grade batch, for the local private
 * valuation reader. Pure: every name comes from `names`, and nothing is read from a database.
 *
 * Every asset has one intrinsic value in every trade it passes through: a player's first stint at
 * the receiving club, and a pick's final selection's first stint at the club that used it, whoever
 * held it. Each trade is zero-sum on those values. A pick spent matching a bid is pending. A player
 * traded on has a value per receiving club, so unlike a pick he does not cancel out along a chain.
 */
export function buildAflTradeStory(
  batch: AflTradeStoryBatch,
  tradeId: string,
  names: AflTradeStoryNames
): AflTradeStory {
  const index = new AflTradeStoryIndex(batch, names);
  const trade = index.trade(tradeId);
  const clubIds = trade.clubs.map(({ clubId }) => clubId);
  const linked = linkedTrades(index, trade);
  const chains = clubIds.map((clubId) => clubChain(linked, clubId));
  return {
    trade: {
      id: trade.transactionId,
      year: trade.tradeYear,
      clubs: clubIds.map((id) => index.club(id)),
    },
    sides: clubIds.map((clubId) => storySide(index, trade, clubId)),
    nets: {
      tradeAlone: clubIds.map((clubId) => clubNet(index, [trade], clubId)),
      withNextMoves: chains.map((chain) => ({
        ...clubNet(index, chain.trades, chain.clubId),
        tradeIds: chain.trades.map(({ transactionId }) => transactionId),
      })),
    },
    players: storyPlayers(index, chains),
    lineage: storyLineage(index, trade, linked),
    events: [],
  };
}
