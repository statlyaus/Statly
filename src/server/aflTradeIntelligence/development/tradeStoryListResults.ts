import type { AflTradeStructure } from '../valuation/tradeStructureContracts';
import type { AflTradeValueLines } from '../valuation/valueLineContracts';

/**
 * One club's line in the trade list: its net on this trade at the trade's latest checkpoint, whether
 * that net is still provisional, and what it received. Read straight from the sealed value lines and
 * structure, so the list of every trade does not build every trade's full story.
 */
export interface AflTradeStoryListResult {
  readonly clubId: string;
  readonly clubName: string;
  readonly net: number;
  /** A value is not in yet, so the net will change. */
  readonly provisional: boolean;
  readonly received: readonly string[];
}

export interface AflTradeStoryListNames {
  readonly clubs: ReadonlyMap<string, string>;
  readonly players: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
}

/** Every trade's results by transaction id. A leg with no name anywhere fails, as the story does. */
export function aflTradeStoryListResults(
  structure: AflTradeStructure,
  valueLines: AflTradeValueLines,
  names: AflTradeStoryListNames
): ReadonlyMap<string, readonly AflTradeStoryListResult[]> {
  const valued = new Map(
    valueLines.content.trades.map((trade) => [trade.transactionId, trade] as const)
  );
  // A player leg is named by its asset's player, as on the trade's own page.
  const playerIds = new Map(
    valueLines.content.assets.map((asset) => [asset.assetKey, asset.playerId] as const)
  );
  return new Map(
    structure.content.trades.map((trade) => {
      const lines = valued.get(trade.transactionId);
      if (!lines) throw new Error(`The value lines have no trade ${trade.transactionId}.`);
      const assetKeys = new Map(lines.legs.map((leg) => [leg.transferId, leg.assetKey] as const));
      const label = (transferId: string): string => {
        const playerId = playerIds.get(assetKeys.get(transferId) ?? '');
        const name =
          names.labels.get(transferId) ?? (playerId ? names.players.get(playerId) : undefined);
        if (name === undefined) throw new Error(`The trade list has no label for ${transferId}.`);
        return name;
      };
      const results = lines.clubs.map((club): AflTradeStoryListResult => {
        const latest = club.points.at(-1) ?? club.atTrade;
        return {
          clubId: club.clubId,
          clubName: names.clubs.get(club.clubId) ?? club.clubId,
          net: latest.net,
          provisional: latest.provisional || latest.pending.length > 0,
          received: trade.legs
            .filter((leg) => leg.receivingClubId === club.clubId)
            .map((leg) => label(leg.transferId)),
        };
      });
      return [trade.transactionId, results] as const;
    })
  );
}
