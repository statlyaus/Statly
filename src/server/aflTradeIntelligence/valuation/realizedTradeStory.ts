import { AflTradeStoryIndex, type AflTradeStoryHopRef } from './realizedTradeStoryAssets';
import type {
  AflTradeStory,
  AflTradeStoryAsset,
  AflTradeStoryChainNet,
  AflTradeStoryHop,
  AflTradeStoryLineageAsset,
  AflTradeStoryLineageTrade,
  AflTradeStoryLines,
  AflTradeStoryNames,
  AflTradeStoryPendingAsset,
  AflTradeStoryPlayer,
  AflTradeStorySide,
  AflTradeStoryTradeNet,
} from './realizedTradeStoryContracts';
import type { AflTradeStructureTrade } from './tradeStructureContracts';

export type * from './realizedTradeStoryContracts';

/** A club's chain: the linked trades it is a party to, oldest first. */
interface ClubChain {
  readonly clubId: string;
  readonly trades: readonly AflTradeStructureTrade[];
}

const refsOf = (trade: AflTradeStructureTrade): AflTradeStoryHopRef[] =>
  trade.legs.map((leg) => ({ trade, leg }));

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
}

type Valued = { value: AflTradeStoryAsset['value'] };
const knownPav = ({ value }: Valued) => (value.kind === 'known' ? value.pav : 0);
/** Highest value first. Values are signed, so a pending value sorts after every known one. */
const byValueDescending = (left: Valued, right: Valued) =>
  left.value.kind !== right.value.kind
    ? left.value.kind === 'known'
      ? -1
      : 1
    : knownPav(right) - knownPav(left);

const byYear = (left: AflTradeStructureTrade, right: AflTradeStructureTrade) =>
  left.tradeYear - right.tradeYear;

/**
 * The story's trade and, repeatedly, each later trade a club of the story's trade passed a pick it
 * received into, oldest first.
 */
function linkedTrades(
  index: AflTradeStoryIndex,
  trade: AflTradeStructureTrade
): AflTradeStructureTrade[] {
  const clubIds = new Set(trade.clubs.map(({ clubId }) => clubId));
  const trades = [trade];
  for (let at = 0; at < trades.length; at++)
    for (const ref of refsOf(trades[at]!)) {
      const next = clubIds.has(ref.leg.receivingClubId) ? index.nextHop(ref) : undefined;
      if (next && !trades.includes(next.trade)) trades.push(next.trade);
    }
  return trades.sort(byYear);
}

const clubChain = (linked: readonly AflTradeStructureTrade[], clubId: string): ClubChain => ({
  clubId,
  trades: linked.filter((trade) => trade.clubs.some((club) => club.clubId === clubId)),
});

/** A club's net on one trade and at the trade, from the value lines. */
function tradeNet(
  index: AflTradeStoryIndex,
  trade: AflTradeStructureTrade,
  clubId: string
): AflTradeStoryTradeNet {
  const club = index.nets(trade.transactionId).clubs.get(clubId);
  if (!club)
    throw new Error(`The value lines have no net for club ${clubId} on ${trade.transactionId}.`);
  return { ...index.club(clubId), ...club.now, atTrade: club.atTrade, line: club.line };
}

/**
 * A club's net over its chain, per value line: each line it received counts +1 and each it gave -1,
 * read at the latest chain trade that moved it. A pick received then passed on nets to zero, so it
 * cancels out whatever slot each trade read it at; a pending line is listed instead of valued.
 */
function chainNet(index: AflTradeStoryIndex, chain: ClubChain): AflTradeStoryChainNet {
  const holdings = new Map<string, { asset: AflTradeStoryAsset; count: number }>();
  for (const ref of chain.trades.flatMap(refsOf)) {
    const step =
      ref.leg.receivingClubId === chain.clubId
        ? 1
        : ref.leg.sendingClubId === chain.clubId
          ? -1
          : 0;
    if (step === 0) continue;
    const asset = index.resolve(ref);
    const count = (holdings.get(asset.assetKey)?.count ?? 0) + step;
    holdings.set(asset.assetKey, { asset, count });
  }
  const held = [...holdings.values()].filter(({ count }) => count !== 0);
  const net = held.reduce((total, { asset, count }) => total + count * knownPav(asset), 0);
  const pending: AflTradeStoryPendingAsset[] = held.flatMap(({ asset, count }) =>
    asset.value.kind === 'pending'
      ? [
          {
            assetId: asset.assetId,
            assetKey: asset.assetKey,
            direction: count > 0 ? ('received' as const) : ('given' as const),
            reason: asset.value.pending,
          },
        ]
      : []
  );
  return {
    ...index.club(chain.clubId),
    net: Math.round(net * 1e6) / 1e6,
    pendingCount: pending.length,
    pending,
    tradeIds: chain.trades.map(({ transactionId }) => transactionId),
  };
}

/** A trade's assets, highest value first (the structure lists legs by transfer id). */
const tradeAssets = (index: AflTradeStoryIndex, trade: AflTradeStructureTrade) =>
  refsOf(trade)
    .map((ref) => index.resolve(ref))
    .sort(byValueDescending);

function storySide(
  index: AflTradeStoryIndex,
  trade: AflTradeStructureTrade,
  clubId: string
): AflTradeStorySide {
  const assets = tradeAssets(index, trade);
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
  const { outcome } = asset;
  return {
    ...index.club(final.leg.receivingClubId),
    group,
    assetId: asset.assetId,
    acquired: {
      tradeId: final.trade.transactionId,
      fromClubId: final.leg.sendingClubId,
      label: asset.label,
      pickLabel: asset.assetKind === 'pick' ? asset.label : null,
    },
    outcome,
    value: asset.value,
    stillAtClub:
      (outcome.kind === 'player' || outcome.kind === 'bid_share') && outcome.stint === 'open',
  };
}

const chainLegs = (chain: ClubChain, side: 'receivingClubId' | 'sendingClubId') =>
  chain.trades.flatMap(refsOf).filter((ref) => ref.leg[side] === chain.clubId);

/** A player has no onward link: he is passed on if the club gives him in a later chain trade. */
function playerPassedOn(index: AflTradeStoryIndex, chain: ClubChain, ref: AflTradeStoryHopRef) {
  if (ref.leg.assetKind !== 'player') return false;
  const assetId = index.assetId(ref);
  return chainLegs(
    { ...chain, trades: chain.trades.slice(chain.trades.indexOf(ref.trade) + 1) },
    'sendingClubId'
  ).some((later) => index.assetId(later) === assetId);
}

/**
 * What each club of the trade ended up with (assets it received along its chain and kept), then
 * the ones that got away (assets those clubs gave along their chains that none of them kept).
 */
function storyPlayers(index: AflTradeStoryIndex, chains: readonly ClubChain[]) {
  // A pick is one holding by its value line; a player, who has no onward link, by who he is.
  const holding = (ref: AflTradeStoryHopRef) =>
    ref.leg.assetKind === 'player' ? `player|${index.assetId(ref)}` : index.assetKey(ref);
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
  trade: AflTradeStructureTrade
): AflTradeStoryLineageTrade {
  return {
    tradeId: trade.transactionId,
    year: trade.tradeYear,
    clubs: trade.clubs.map(({ clubId }) => index.club(clubId)),
    nets: trade.clubs.map(({ clubId }) => tradeNet(index, trade, clubId)),
    assets: tradeAssets(index, trade),
  };
}

/**
 * The linked trades and each later trade an asset of the story's trade passed through. A trade that
 * only an asset of another linked trade later passed through is not listed.
 */
function storyLineage(
  index: AflTradeStoryIndex,
  trade: AflTradeStructureTrade,
  linked: readonly AflTradeStructureTrade[]
) {
  const own = refsOf(trade);
  // Trades in the order they are reached; the assets themselves are shown highest value first.
  const withHops = [...linked, ...own.flatMap((ref) => index.forward(ref).map((hop) => hop.trade))];
  const trades = uniqueBy(withHops, (linkedTrade) => linkedTrade.transactionId).sort(byYear);
  return {
    trades: trades.map((linkedTrade) => lineageTrade(index, linkedTrade)),
    assets: own
      .sort((left, right) => byValueDescending(index.resolve(left), index.resolve(right)))
      .map((ref) => lineageAsset(index, ref)),
  };
}

/**
 * The trade story of one trade, for the local private valuation reader (value-line method step 5).
 * Pure: it reads a sealed trade structure and the sealed value lines computed on it, every name comes
 * from `names`, and nothing is read from a database. No realized grade is read.
 *
 * Every asset has one value line in every trade it passes through: a traded player's first stint at
 * the receiving club, and a pick's line to whatever it finally became (a drafted player, a matched-bid
 * share of the nominee, its slot while its draft is to come, or 0 when not used), whoever held it.
 * Values are signed and read at the trade's latest checkpoint; each leg's at-trade value is shown
 * beside it, never subtracted. Each club's net on the trade comes from the value lines, so it is
 * zero-sum. A player traded on has a line per receiving club, so unlike a pick he does not cancel out
 * along a chain.
 */
export function buildAflTradeStory(
  lines: AflTradeStoryLines,
  tradeId: string,
  names: AflTradeStoryNames
): AflTradeStory {
  const index = new AflTradeStoryIndex(lines, names);
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
    checkpoint: index.nets(trade.transactionId).checkpoint,
    inputs: { structureId: index.structureId, valueLinesId: index.valueLinesId },
    sides: clubIds.map((clubId) => storySide(index, trade, clubId)),
    nets: {
      tradeAlone: clubIds.map((clubId) => tradeNet(index, trade, clubId)),
      withNextMoves: chains.map((chain) => chainNet(index, chain)),
    },
    players: storyPlayers(index, chains),
    lineage: storyLineage(index, trade, linked),
    events: [],
  };
}
