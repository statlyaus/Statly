import type {
  AflTradeRealizedTradeGradeBatch,
  AflTradeRealizedTradeGradeLeg,
} from './realizedTradeGradeContracts';

/**
 * The realized trade story read model's input and output types. The story serves only the local
 * private valuation reader: realized grades are publication-prohibited.
 */

/** The leg fields the story reads. Every realized-trade-grade leg is assignable to it. */
export interface AflTradeStoryLeg {
  readonly transferId: string;
  readonly assetKind: 'player' | 'pick';
  readonly sendingClubId: string;
  readonly receivingClubId: string;
  readonly basis: AflTradeRealizedTradeGradeLeg['basis'];
  /** Read only for a first-stint leg. A traded-on leg's value is never read (old return rule). */
  readonly realizedValue?: number;
  readonly stint?: { readonly status: 'closed' | 'open' };
  readonly onward?: { readonly transactionId: string };
  readonly onwardTransactionId?: string;
  /** Rule v7: a special entitlement's next hop is its successor transfer, an ordinary pick. */
  readonly specialEntitlement?: { readonly successorTransferId: string };
}

export interface AflTradeStoryTrade {
  readonly transactionId: string;
  readonly tradeYear: number;
  readonly clubs: readonly { readonly clubId: string }[];
  readonly legs: readonly AflTradeStoryLeg[];
}

/** The batch fields the story reads. A realized-trade-grade batch is assignable to it. */
export interface AflTradeStoryBatch {
  readonly content: { readonly trades: readonly AflTradeStoryTrade[] };
}

type ReadableAsStoryBatch<Batch extends AflTradeStoryBatch> = Batch;
/** A sealed realized-trade-grade batch. This alias stops compiling if the story cannot read one. */
export type AflTradeStoryGradeBatch = ReadableAsStoryBatch<AflTradeRealizedTradeGradeBatch>;

/** The asset one transfer moved: a player, or a pick with its label at that transfer. */
export type AflTradeStoryTransferAsset =
  | { readonly kind: 'player'; readonly playerId: string }
  | { readonly kind: 'pick'; readonly pickId: string; readonly label: string };

/** The player a pick was used on, and where. */
export interface AflTradeStorySelection {
  readonly playerId: string;
  readonly selectionNumber: number;
  readonly draftYear: number;
}

/** Injected names, so the builder stays pure. A missing name fails the build, never guesses. */
export interface AflTradeStoryNames {
  readonly clubs: ReadonlyMap<string, string>;
  readonly players: ReadonlyMap<string, string>;
  /** Each used pick by pick id: the selection it was used on. */
  readonly picks: ReadonlyMap<string, AflTradeStorySelection>;
  /** Each transfer by transfer id: the asset it moved. */
  readonly transfers: ReadonlyMap<string, AflTradeStoryTransferAsset>;
}

/**
 * Why an asset has no value yet. `matched_bid`: the pick was spent matching a bid, so its value is
 * pending, never 0 and never estimated. `draft_not_in_evidence`: no outcome is in evidence yet
 * (the grader projected it from the draft order, which the story never uses).
 * `unavailable`: the grader blocked the leg its value rests on.
 */
export type AflTradeStoryPendingReason = 'matched_bid' | 'draft_not_in_evidence' | 'unavailable';

/** An asset's one intrinsic value, in first-stint PAV, the same in every trade it passes through. */
export type AflTradeStoryValue =
  | { readonly kind: 'known'; readonly pav: number }
  | { readonly kind: 'pending'; readonly pending: AflTradeStoryPendingReason };

export interface AflTradeStoryClub {
  readonly clubId: string;
  readonly clubName: string;
}

/** What an asset became: a player at a club (with his draft slot for a pick), nothing, or pending. */
export type AflTradeStoryOutcome =
  | (AflTradeStoryClub & {
      readonly kind: 'player';
      readonly playerId: string;
      readonly playerName: string;
      readonly selection: { readonly selectionNumber: number; readonly draftYear: number } | null;
      /** `open`: still at the club, so the value will move. */
      readonly stint: 'open' | 'closed';
    })
  | { readonly kind: 'not_used' }
  | { readonly kind: 'pending'; readonly pending: AflTradeStoryPendingReason };

export interface AflTradeStoryAsset {
  readonly transferId: string;
  readonly assetKind: 'player' | 'pick';
  /** The player or pick id, stable across every trade the asset passes through. */
  readonly assetId: string;
  readonly label: string;
  readonly fromClubId: string;
  readonly toClubId: string;
  readonly outcome: AflTradeStoryOutcome;
  readonly value: AflTradeStoryValue;
}

export interface AflTradeStorySide extends AflTradeStoryClub {
  readonly gave: readonly AflTradeStoryAsset[];
  readonly received: readonly AflTradeStoryAsset[];
  /** The known value of what this club received; pending assets are counted, not valued. */
  readonly receivedValue: number;
  readonly receivedPendingCount: number;
}

export interface AflTradeStoryNet extends AflTradeStoryClub {
  /** Known values received minus known values given. */
  readonly net: number;
  /**
   * Pending assets the net leaves out, each as this hop's asset id and whether the club received or
   * gave it. A pick received and passed on cancels out.
   */
  readonly pendingCount: number;
  readonly pending: readonly {
    readonly assetId: string;
    readonly direction: 'received' | 'given';
  }[];
}

/**
 * A club's net over its chain: the linked trades it is a party to. The linked trades are the story's
 * trade and, repeatedly, each later trade a club of the story's trade passed a received pick into.
 */
export interface AflTradeStoryChainNet extends AflTradeStoryNet {
  readonly tradeIds: readonly string[];
}

export interface AflTradeStoryPlayer extends AflTradeStoryClub {
  /** `ended_with`: a club of this trade holds it; `got_away`: one of them gave it and lost it. */
  readonly group: 'ended_with' | 'got_away';
  readonly assetId: string;
  /** How the club got it: the trade, the club it came from, and the pick label for a pick. */
  readonly acquired: {
    readonly tradeId: string;
    readonly fromClubId: string;
    readonly pickLabel: string | null;
  };
  readonly outcome: AflTradeStoryOutcome;
  readonly value: AflTradeStoryValue;
  /** True while the player's first stint at the club is open. */
  readonly stillAtClub: boolean;
}

export interface AflTradeStoryHop extends AflTradeStoryClub {
  readonly tradeId: string;
  readonly year: number;
  readonly fromClubId: string;
  /** Relative to the story's trade. `clubId` is the club holding the asset after the hop. */
  readonly relation: 'before' | 'this' | 'after';
}

export interface AflTradeStoryLineageTrade {
  readonly tradeId: string;
  readonly year: number;
  readonly clubs: readonly AflTradeStoryClub[];
  readonly nets: readonly AflTradeStoryNet[];
  readonly assets: readonly AflTradeStoryAsset[];
}

export interface AflTradeStoryLineageAsset {
  readonly transferId: string;
  readonly assetId: string;
  readonly label: string;
  readonly hops: readonly AflTradeStoryHop[];
  readonly outcome: AflTradeStoryOutcome;
  readonly value: AflTradeStoryValue;
}

/**
 * A dated event on the story's timeline, such as a premiership. Every event requires a `sourceId`
 * naming the reviewed source record it comes from: an unsourced event is never shown.
 */
export interface AflTradeStoryEvent {
  readonly date: string;
  readonly kind: 'major' | 'milestone';
  readonly title: string;
  readonly detail?: string;
  readonly sourceId: string;
}

export interface AflTradeStory {
  readonly trade: {
    readonly id: string;
    readonly year: number;
    readonly clubs: readonly AflTradeStoryClub[];
  };
  readonly sides: readonly AflTradeStorySide[];
  readonly nets: {
    readonly tradeAlone: readonly AflTradeStoryNet[];
    readonly withNextMoves: readonly AflTradeStoryChainNet[];
  };
  readonly players: readonly AflTradeStoryPlayer[];
  readonly lineage: {
    /**
     * The linked trades and each later trade an asset of the story's trade passed through, oldest
     * first. A `before` hop of an asset can name a trade not listed here.
     */
    readonly trades: readonly AflTradeStoryLineageTrade[];
    /** Each asset of the story's trade, hop by hop, to its final selection or pending value. */
    readonly assets: readonly AflTradeStoryLineageAsset[];
  };
  /** Always empty until sourced events exist. */
  readonly events: readonly AflTradeStoryEvent[];
}
