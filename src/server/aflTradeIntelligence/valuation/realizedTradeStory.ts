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

/** A club's chain: the story's trade, then each trade it passed an asset it received into. */
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

function clubChain(
  index: AflTradeStoryIndex,
  trade: AflTradeStoryTrade,
  clubId: string
): ClubChain {
  const trades = [trade];
  for (let at = 0; at < trades.length; at++)
    for (const ref of refsOf(trades[at]!)) {
      const next = ref.leg.receivingClubId === clubId ? index.nextHop(ref) : undefined;
      if (next && !trades.includes(next.trade)) trades.push(next.trade);
    }
  return { clubId, trades };
}

/**
 * Known values received minus known values given, over the trades. A pending asset is counted
 * instead, and one received then passed on cancels out, as its value does.
 */
function clubNet(
  index: AflTradeStoryIndex,
  trades: readonly AflTradeStoryTrade[],
  clubId: string
): AflTradeStoryNet {
  let net = 0;
  const pendingBalance = new Map<string, number>();
  for (const ref of trades.flatMap(refsOf)) {
    const sign =
      (ref.leg.receivingClubId === clubId ? 1 : 0) - (ref.leg.sendingClubId === clubId ? 1 : 0);
    if (sign === 0) continue;
    const asset = index.resolve(ref);
    if (asset.value.kind === 'known') net += sign * asset.value.pav;
    else pendingBalance.set(asset.assetId, (pendingBalance.get(asset.assetId) ?? 0) + sign);
  }
  const pendingAssetIds = [...pendingBalance].filter(([, count]) => count !== 0).map(([id]) => id);
  return { ...index.club(clubId), net, pendingCount: pendingAssetIds.length, pendingAssetIds };
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

/**
 * What each club of the trade ended up with (assets it received along its chain and kept), then
 * the ones that got away (assets those clubs gave along their chains that none of them kept).
 */
function storyPlayers(index: AflTradeStoryIndex, chains: readonly ClubChain[]) {
  const legsOf = (chain: ClubChain, side: 'receivingClubId' | 'sendingClubId') =>
    chain.trades.flatMap(refsOf).filter((ref) => ref.leg[side] === chain.clubId);
  const endedWith = chains.flatMap((chain) =>
    legsOf(chain, 'receivingClubId')
      .filter((ref) => !index.nextHop(ref))
      .map((ref) => storyPlayer(index, ref, 'ended_with'))
      .sort(byValueDescending)
  );
  const kept = new Set(endedWith.map(({ assetId }) => assetId));
  const given = chains.flatMap((chain) => legsOf(chain, 'sendingClubId'));
  const gotAway = uniqueBy(given, (ref) => index.assetId(ref.leg))
    .filter((ref) => !kept.has(index.assetId(ref.leg)))
    .map((ref) => storyPlayer(index, index.finalHop(ref), 'got_away'))
    .sort(byValueDescending);
  return [...endedWith, ...gotAway];
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
 * The linked trades: the story's trade, every trade one of its assets passed through, and each of
 * its clubs' chains. A trade an asset of a linked trade later passed through is not linked.
 */
function storyLineage(
  index: AflTradeStoryIndex,
  trade: AflTradeStoryTrade,
  chains: readonly ClubChain[]
) {
  const own = refsOf(trade);
  const linked = [
    ...chains.flatMap((chain) => chain.trades),
    ...own.flatMap((ref) => index.forward(ref).map((hop) => hop.trade)),
  ];
  const trades = uniqueBy(linked, (linkedTrade) => linkedTrade.transactionId).sort(
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
 * held it. Each trade is zero-sum on those values. A pick spent matching a bid is pending.
 */
export function buildAflTradeStory(
  batch: AflTradeStoryBatch,
  tradeId: string,
  names: AflTradeStoryNames
): AflTradeStory {
  const index = new AflTradeStoryIndex(batch, names);
  const trade = index.trade(tradeId);
  const clubIds = trade.clubs.map(({ clubId }) => clubId);
  const chains = clubIds.map((clubId) => clubChain(index, trade, clubId));
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
    lineage: storyLineage(index, trade, chains),
    events: [],
  };
}
