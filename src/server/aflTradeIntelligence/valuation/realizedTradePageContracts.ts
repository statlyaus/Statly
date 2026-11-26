import type { AflTradeAssetLedgerBidMatch } from './assetLedgerContracts';
import type { AflTradeStory } from './realizedTradeStoryContracts';

/**
 * What the private trade page renders (statlyaus/Statly#789): the realized trade story and the asset
 * ledger's matched bids for the story's picks. The page adds no value of its own, so refitted pick
 * curves or new seasons change the page without a code change. Publication-prohibited, like the
 * story and the ledger: only the local private reader serves it.
 */
/** Who a page is for. Only the public reader, showing an owner-approved bundle, says `public`. */
export type AflTradePageAudience = 'private' | 'public';

export interface AflTradePageSource {
  readonly kind: 'sample' | 'sealed_batch';
  readonly label: string;
  /** Absent means private: the page says so and links stay inside the private reader. */
  readonly audience?: AflTradePageAudience;
}

export interface AflTradePageModel {
  readonly story: AflTradeStory;
  /** Where the story came from, shown on the page: sample data until a sealed batch is read. */
  readonly source: AflTradePageSource;
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
  /**
   * What the leftover points became, as phrases that follow "which became": "a new pick 13, used on
   * Jake Eime". Empty when the match left none, or the evidence lists no leftover pick.
   */
  readonly leftoverLabels: readonly string[];
  /**
   * The players the bid's last spent pick also carries through its leftover pick (2026-11-26): the
   * player it was used on (`whole`), or a later nominee it bought a share of. Absent when none.
   */
  readonly leftoverPlayers?: readonly { readonly name: string; readonly whole: boolean }[];
}
