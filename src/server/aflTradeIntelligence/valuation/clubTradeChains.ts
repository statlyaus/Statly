import type { AflTradeStoryLines, AflTradeStoryNames } from './realizedTradeStoryContracts';

/**
 * Every chain of one club (statlyaus/Statly#1051; owner 2026-10-23: "All club chains"). Two of the
 * club's trades are in one chain when the club received a pick in one and traded that same pick on in
 * the other (the structure's onward link). A player is never a link: each trade values him by his
 * stint at the club that received him, so nothing cancels. A chain's net is the sum of its trades'
 * own nets for the club at the latest checkpoint (the method's "chain totals are simply additive";
 * checked on genuine 2026-10-23: 0 mismatches against the story's per-line chain net). It is
 * provisional while any of its trades is.
 */

export interface AflTradeClubChainTrade {
  readonly tradeId: string;
  readonly year: number;
  /** The other clubs in the trade, by name. */
  readonly withClubs: readonly string[];
  readonly net: number;
  readonly provisional: boolean;
}

export interface AflTradeClubChain {
  /** Oldest first. */
  readonly trades: readonly AflTradeClubChainTrade[];
  readonly net: number;
  readonly provisional: boolean;
}

export interface AflTradeClubChains {
  readonly clubId: string;
  readonly clubName: string;
  /** Chains of two or more trades, largest absolute net first. */
  readonly chains: readonly AflTradeClubChain[];
  /** The club's trades that link to no other. */
  readonly standalone: readonly AflTradeClubChainTrade[];
  /** The season the nets are read at. */
  readonly throughSeason: number;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function buildAflTradeClubChains(
  lines: AflTradeStoryLines,
  clubId: string,
  names: AflTradeStoryNames
): AflTradeClubChains {
  const clubName = names.clubs.get(clubId);
  if (clubName === undefined) throw new Error(`The club chains have no name for club ${clubId}.`);
  const nets = new Map(
    lines.valueLines.content.trades.map((trade) => [trade.transactionId, trade])
  );
  const trades = lines.structure.content.trades.filter((trade) =>
    trade.clubs.some((club) => club.clubId === clubId)
  );
  const ids = new Set(trades.map(({ transactionId }) => transactionId));
  const sendsOn = new Map<string, string>();
  for (const trade of trades)
    for (const leg of trade.legs)
      if (leg.sendingClubId === clubId) sendsOn.set(leg.transferId, trade.transactionId);

  // Union-find over the club's trades.
  const parent = new Map(trades.map(({ transactionId }) => [transactionId, transactionId]));
  const find = (id: string): string => {
    const up = parent.get(id)!;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (const trade of trades)
    for (const leg of trade.legs) {
      if (leg.receivingClubId !== clubId || leg.onward === undefined) continue;
      const onward = sendsOn.get(leg.onward.transferId);
      if (onward === undefined || !ids.has(onward)) continue;
      parent.set(find(onward), find(trade.transactionId));
    }

  const row = (transactionId: string): AflTradeClubChainTrade => {
    const trade = trades.find((candidate) => candidate.transactionId === transactionId)!;
    const valued = nets.get(transactionId)?.clubs.find((club) => club.clubId === clubId);
    const last = valued?.points.at(-1);
    if (!last)
      throw new Error(`The value lines have no net for club ${clubId} on ${transactionId}.`);
    return {
      tradeId: transactionId,
      year: trade.tradeYear,
      withClubs: trade.clubs
        .filter((club) => club.clubId !== clubId)
        .map((club) => {
          const name = names.clubs.get(club.clubId);
          if (name === undefined)
            throw new Error(`The club chains have no name for club ${club.clubId}.`);
          return name;
        }),
      net: last.net,
      provisional: last.provisional,
    };
  };

  const groups = new Map<string, string[]>();
  for (const { transactionId } of trades) {
    const root = find(transactionId);
    groups.set(root, [...(groups.get(root) ?? []), transactionId]);
  }
  const chains: AflTradeClubChain[] = [];
  const standalone: AflTradeClubChainTrade[] = [];
  for (const members of groups.values()) {
    const rows = members
      .map(row)
      .sort((left, right) => left.year - right.year || (left.tradeId < right.tradeId ? -1 : 1));
    if (rows.length === 1) {
      standalone.push(rows[0]!);
      continue;
    }
    chains.push({
      trades: rows,
      net: round(rows.reduce((total, { net }) => total + net, 0)),
      provisional: rows.some(({ provisional }) => provisional),
    });
  }
  chains.sort((left, right) => Math.abs(right.net) - Math.abs(left.net));
  standalone.sort(
    (left, right) => left.year - right.year || (left.tradeId < right.tradeId ? -1 : 1)
  );
  return {
    clubId,
    clubName,
    chains,
    standalone,
    throughSeason: lines.valueLines.content.inputs.throughSeason,
  };
}
