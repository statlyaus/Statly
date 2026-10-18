import type { AflTradeAssetLedgerBidMatch } from './assetLedgerContracts';
import type { AflTradeStory } from './realizedTradeStoryContracts';

/**
 * What the private trade page renders (statlyaus/Statly#789): the realized trade story and the asset
 * ledger's matched bids for the story's picks. The page adds no value of its own, so refitted pick
 * curves or new seasons change the page without a code change. Publication-prohibited, like the
 * story and the ledger: only the local private reader serves it.
 */
export interface AflTradePageModel {
  readonly story: AflTradeStory;
  /** Where the story came from, shown on the page: sample data until a sealed batch is read. */
  readonly source: { readonly kind: 'sample' | 'sealed_batch'; readonly label: string };
  /** The last season the values count, shown as "to 2026". */
  readonly throughSeason: number;
  /** The ledger's matched bids that spent a pick of this story, with display labels. */
  readonly bidMatches: readonly AflTradePageBidMatch[];
}

export interface AflTradePageBidMatch {
  readonly match: AflTradeAssetLedgerBidMatch;
  readonly nomineeName: string;
  /** The matching club's name. */
  readonly clubName: string;
  /** The leftover-points picks the match created, as labels such as "Pick 61". */
  readonly leftoverLabels: readonly string[];
}
