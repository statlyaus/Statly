import type { AflTradeStructure } from './tradeStructureContracts';
import type {
  AflTradeValueLineCheckpoint,
  AflTradeValueLinePendingReason,
  AflTradeValueLines,
  AflTradeValueLineSlotSource,
} from './valueLineContracts';

/**
 * The trade story read model's input and output types (value-line method step 5,
 * statlyaus/Statly#789). The story reads a trade structure and the value lines computed on it, never
 * a realized grade. It serves only the local private valuation reader: value lines are
 * publication-prohibited.
 */

/** What the story reads: a sealed trade structure and the sealed value lines computed on it. */
export interface AflTradeStoryLines {
  readonly structure: AflTradeStructure;
  readonly valueLines: AflTradeValueLines;
}

/** Injected names, so the builder stays pure. A missing name fails the build, never guesses. */
export interface AflTradeStoryNames {
  readonly clubs: ReadonlyMap<string, string>;
  readonly players: ReadonlyMap<string, string>;
  /**
   * Each transfer's label by transfer id: how that transfer names its pick. A player leg without one
   * is labelled with the player's name.
   */
  readonly labels: ReadonlyMap<string, string>;
}

/** Why an asset has no value: the value line's own reason. Never 0, never estimated. */
export type AflTradeStoryPendingReason = AflTradeValueLinePendingReason;

/**
 * An asset's value in signed first-stint HPN PAV, read from its value line: never floored, so a
 * closed stint that cost value is negative.
 */
export type AflTradeStoryValue =
  | { readonly kind: 'known'; readonly pav: number }
  | { readonly kind: 'pending'; readonly pending: AflTradeStoryPendingReason };

export interface AflTradeStoryClub {
  readonly clubId: string;
  readonly clubName: string;
}

/**
 * What an asset became, by its value line: a player at a club (with his draft slot for a pick), a
 * matched-bid share of the nominee, a pick whose draft is still to come (valued at its slot), nothing,
 * or pending (the line's reason). An asset's value is pending exactly when its outcome is.
 */
export type AflTradeStoryOutcome =
  | (AflTradeStoryClub & {
      readonly kind: 'player';
      readonly playerId: string;
      readonly playerName: string;
      readonly selection: { readonly selectionNumber: number; readonly draftYear: number } | null;
      /** `open`: still at the club, so the value will move. */
      readonly stint: 'open' | 'closed';
    })
  | (AflTradeStoryClub & {
      readonly kind: 'bid_share';
      /** The matched-bid nominee. */
      readonly playerId: string;
      readonly playerName: string;
      /** The pick's share of the nominee's line, by the points it covered. */
      readonly share: number;
      readonly stint: 'open' | 'closed';
    })
  | {
      readonly kind: 'pick';
      readonly draftYear: number;
      /** The slot the line reads before the draft: its latest hop's at-trade slot. */
      readonly selectionNumber: number;
      readonly source: AflTradeValueLineSlotSource;
    }
  | { readonly kind: 'not_used' }
  | { readonly kind: 'pending'; readonly pending: AflTradeStoryPendingReason };

export interface AflTradeStoryAsset {
  readonly transferId: string;
  readonly assetKind: 'player' | 'pick';
  /** The player or pick id, stable across every trade the asset passes through. */
  readonly assetId: string;
  /** The value line this leg reads: the same for every hop of a pick. */
  readonly assetKey: string;
  readonly label: string;
  readonly fromClubId: string;
  readonly toClubId: string;
  readonly outcome: AflTradeStoryOutcome;
  /** The value line at the story's checkpoint. */
  readonly value: AflTradeStoryValue;
  /** The value at this trade: shown beside the result, never subtracted from it. */
  readonly atTrade: AflTradeStoryValue;
}

export interface AflTradeStorySide extends AflTradeStoryClub {
  readonly gave: readonly AflTradeStoryAsset[];
  readonly received: readonly AflTradeStoryAsset[];
  /** The known value of what this club received; pending assets are counted, not valued. */
  readonly receivedValue: number;
  readonly receivedPendingCount: number;
}

/** A pending asset a net leaves out: this hop's asset id, the direction and the line's reason. */
export interface AflTradeStoryPendingAsset {
  readonly assetId: string;
  /** The value line it reads, so a pick received and passed on cancels out. */
  readonly assetKey: string;
  readonly direction: 'received' | 'given';
  readonly reason: AflTradeStoryPendingReason;
}

export interface AflTradeStoryNet extends AflTradeStoryClub {
  /** Known values received minus known values given, from the value lines. */
  readonly net: number;
  /** Pending assets the net leaves out. A pick received and passed on cancels out. */
  readonly pendingCount: number;
  readonly pending: readonly AflTradeStoryPendingAsset[];
}

/** A club's net on one trade, with the at-trade view beside it (never subtracted). */
export interface AflTradeStoryTradeNet extends AflTradeStoryNet {
  readonly atTrade: {
    readonly net: number;
    readonly pendingCount: number;
    readonly pending: readonly AflTradeStoryPendingAsset[];
  };
}

/**
 * A club's net over its chain: the linked trades it is a party to. The linked trades are the story's
 * trade and, repeatedly, each later trade a club of the story's trade passed a received pick into.
 * Secondary to the trade's own net (owner, 2026-10-21); step 6 builds the chain view.
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
  /** True while the player's (or nominee's) first stint at the club is open. */
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
  readonly nets: readonly AflTradeStoryTradeNet[];
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
  /** The checkpoint the values are read at: the trade's latest, normally the last season end. */
  readonly checkpoint: AflTradeValueLineCheckpoint;
  /** Where the values came from. */
  readonly inputs: { readonly structureId: string; readonly valueLinesId: string };
  readonly sides: readonly AflTradeStorySide[];
  readonly nets: {
    /** The headline: each club's net on this trade only (owner, 2026-10-21). */
    readonly tradeAlone: readonly AflTradeStoryTradeNet[];
    /** Secondary: each club's net over its chain. */
    readonly withNextMoves: readonly AflTradeStoryChainNet[];
  };
  readonly players: readonly AflTradeStoryPlayer[];
  readonly lineage: {
    /**
     * The linked trades and each later trade an asset of the story's trade passed through, oldest
     * first. A `before` hop of an asset can name a trade not listed here.
     */
    readonly trades: readonly AflTradeStoryLineageTrade[];
    /** Each asset of the story's trade, hop by hop, to what it became. */
    readonly assets: readonly AflTradeStoryLineageAsset[];
  };
  /** Always empty until sourced events exist. */
  readonly events: readonly AflTradeStoryEvent[];
}
