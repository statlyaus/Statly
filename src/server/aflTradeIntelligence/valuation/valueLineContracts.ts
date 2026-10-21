/**
 * The value-line contract (value-line method, implementation order step 3; statlyaus/Statly#789):
 * every traded asset's value line at each checkpoint, and each trade's per-club nets on those lines,
 * with each leg's at-trade view beside them. Private and publication-prohibited, like the asset ledger
 * and realized grades. v2 (step 5) reads its trades, legs and onward links from the trade structure
(`afl-trade-structure/v1`), never a realized-trade-grade batch.
 */

export const AFL_TRADE_VALUE_LINES_SCHEMA_VERSION = 'afl-trade-value-lines/v2' as const;

/**
 * Every choice step 3 makes where the method left one open. Published with the result; each is a
 * recorded rule in docs/architecture/afl-trade-value-line-method.md ("Value lines (step 3)").
 */
export const AFL_TRADE_VALUE_LINE_RULES = {
  /**
   * Checkpoints, in order within a year Y: the end of season Y (its HPN PAV official), the trade
   * period of Y, then the national draft of Y. A trade of year Y is viewed at trade Y; a pick of
   * draft Y has a draft Y checkpoint; every season end after the trade follows.
   */
  checkpointOrder: ['season_end', 'trade', 'draft'],
  /**
   * Before its draft a pick is worth the first-stint pick curve at its at-trade slot, never its
   * eventual selection: the number stated at the trade, else rule v6's live-order slot (a previous
   * draft's order as a flagged proxy), else rule v19's reviewed-board pre-draft slot.
   */
  pickBeforeDraft: 'at_trade_slot_pick_curve',
  /** Between trades, a pick's slot is the at-trade slot of its latest hop by year, then trade id. */
  preDraftSlotBetweenTrades: 'latest_hop_at_trade_slot',
  /** From its draft a used pick is the drafted player: the used slot's curve, then his first stint. */
  pickFromDraft: 'used_slot_then_drafted_player_first_stint',
  /** A pick not used or passed is worth its slot until the draft, then 0. */
  notUsed: 'slot_until_draft_then_zero',
  /** A matched-bid spent pick is worth its own slot until the bid, then share × the nominee's line. */
  matchedBid: 'own_slot_until_bid_then_share_of_nominee_line',
  /** A stint closes at the ledger's end, or after this many consecutive in-stint seasons with no game. */
  inactivityClosureSeasons: 3,
  /** A closed stint is worth exactly what it produced; values are signed, never floored. */
  closedValue: 'produced_signed_no_floor',
  /**
   * Owner decision 2026-10-19: a traded player's open stint is estimated from the injected
   * traded-player fit (career stage prior, own form by credibility, survival at the receiving club);
   * with no fit it is pending and the trade's net is provisional.
   */
  tradedPlayerOpenStint: 'traded_player_fit_else_pending',
  /**
   * A traded player's career-stage origin, from evidence at the trade: his first national draft,
   * else the season before his first game (assumed youngest, left-censored, when that game is in the
   * first season read).
   */
  tradedPlayerStage: 'draft_else_first_game_else_assumed_youngest',
  /** Each leg's at-trade view is shown beside the result and never subtracted from it. */
  atTradeView: 'shown_never_subtracted',
} as const;

export type AflTradeValueLineCheckpointKind = 'season_end' | 'trade' | 'draft';

/** A point in time: `season` is the season end, trade period or draft year. */
export interface AflTradeValueLineCheckpoint {
  readonly kind: AflTradeValueLineCheckpointKind;
  readonly season: number;
}

/** Why a point has no value. Never 0, never estimated. */
export type AflTradeValueLinePendingReason =
  | 'matched_bid'
  | 'draft_not_in_evidence'
  | 'slot_unknown'
  | 'traded_player_fit_not_stored'
  | 'unavailable';

/**
 * `pick`: before its draft, valued by slot. `open`: a stint running at the checkpoint. `closed`: the
 * stint has ended, so the value is what it produced. `not_used`: worth 0 from the draft.
 */
export type AflTradeValueLineState = 'pick' | 'open' | 'closed' | 'not_used' | 'pending';

/** Where a pick's slot came from. */
export type AflTradeValueLineSlotSource =
  | 'stated_at_trade'
  | 'order'
  | 'order_proxy'
  | 'board_pre_draft'
  | 'used_selection'
  | 'bid_selection';

export interface AflTradeValueLinePoint {
  readonly checkpoint: AflTradeValueLineCheckpoint;
  readonly state: AflTradeValueLineState;
  /** Null when pending. Signed. */
  readonly value: number | null;
  /** First-stint PAV produced through the checkpoint (after any share). */
  readonly produced: number | null;
  /** Expected PAV still to come (after any share); 0 when closed. */
  readonly expectedRemaining: number | null;
  /** The slot a `pick` point, or the draft point, reads. */
  readonly slot: {
    readonly selectionNumber: number;
    readonly source: AflTradeValueLineSlotSource;
  } | null;
  /** Seasons of the stint counted (tenure), for an `open` or `closed` point. */
  readonly tenure: number | null;
  readonly pending: AflTradeValueLinePendingReason | null;
}

export type AflTradeValueLineBasis =
  | 'pick_selected'
  | 'pick_matched_bid_share'
  | 'pick_future'
  | 'pick_not_used'
  | 'pick_pending'
  | 'traded_player'
  | 'pending';

/** One intrinsic line, the same in every trade the asset passes through. */
export interface AflTradeValueLineAsset {
  /**
   * `pick|<pickId>`, `player|<playerId>|<clubId>|<fromSeason>` for a traded player's stint, or
   * `unresolved|<transferId>` for an asset the candidate does not resolve.
   */
  readonly assetKey: string;
  readonly kind: 'pick' | 'player' | 'unresolved';
  readonly basis: AflTradeValueLineBasis;
  readonly pickId: string | null;
  /** The traded player, the drafted player, or the matched-bid nominee. */
  readonly playerId: string | null;
  /** The club whose first stint the line counts. */
  readonly clubId: string | null;
  readonly draftYear: number | null;
  /** The matched-bid share of the nominee's line. */
  readonly share: number | null;
  readonly points: readonly AflTradeValueLinePoint[];
}

/** One leg of a trade: its asset's line, and its at-trade view (shown, never subtracted). */
export interface AflTradeValueLineTradeLeg {
  readonly transferId: string;
  readonly assetKey: string;
  readonly sendingClubId: string;
  readonly receivingClubId: string;
  /** The asset's value at this trade, from this leg's own at-trade slot for a pick. */
  readonly atTrade: AflTradeValueLinePoint;
}

export interface AflTradeValueLineNetPoint {
  readonly checkpoint: AflTradeValueLineCheckpoint;
  /** Known values received minus known values given. */
  readonly net: number;
  /** True while a leg is pending: the net leaves it out. */
  readonly provisional: boolean;
  readonly pending: readonly {
    readonly assetKey: string;
    readonly direction: 'received' | 'given';
    readonly reason: AflTradeValueLinePendingReason;
  }[];
}

export interface AflTradeValueLineTrade {
  readonly transactionId: string;
  readonly tradeYear: number;
  /**
   * Each pick leg's line is what its pick finally became: a traded-on pick follows the structure's
   * onward links (a pick trail, or a special entitlement's reviewed custody successor).
   */
  readonly legs: readonly AflTradeValueLineTradeLeg[];
  readonly clubs: readonly {
    readonly clubId: string;
    /** The at-trade view: shown beside the result, never subtracted from a later checkpoint. */
    readonly atTrade: AflTradeValueLineNetPoint;
    /** The draft of each pick in the trade and every season end after it. */
    readonly points: readonly AflTradeValueLineNetPoint[];
  }[];
}

export const AFL_TRADE_VALUE_LINES_LIMITATION: string =
  'Private, non-production value lines. Each asset has one line, in signed first-stint HPN PAV at ' +
  'the club that holds it: a pick by its at-trade slot until the draft, then the drafted player; a ' +
  "matched-bid spent pick by its own slot until the bid, then its share of the nominee's line; a " +
  'traded player by what he has produced at the receiving club plus what the traded-player fit ' +
  'expects, pending while no such fit is stored. Lines use only seasons through each checkpoint. ' +
  'Trades, legs and onward links come from the trade structure, with no realized grade read. Each ' +
  'trade is zero-sum on these lines. Grade rules v11 and v13 to v18 are not retired here. Not for ' +
  'publication.';

export interface AflTradeValueLinesContent {
  readonly schemaVersion: typeof AFL_TRADE_VALUE_LINES_SCHEMA_VERSION;
  readonly environment: 'non_production';
  readonly valueUnit: 'hpn_pav';
  readonly rules: typeof AFL_TRADE_VALUE_LINE_RULES;
  readonly inputs: {
    readonly fitId: string;
    /** Null when no traded-player fit was supplied. */
    readonly tradedPlayerFitId: string | null;
    readonly ledgerId: string;
    readonly candidateId: string;
    /** The trade structure (`afl-trade-structure/v1`) the trades, legs and onward links came from. */
    readonly structureId: string;
    readonly gamesMethodId: string;
    /** Every season read, with the HPN PAV calculation all inputs pinned for it. */
    readonly seasons: readonly { readonly season: number; readonly calculationId: string }[];
    readonly throughSeason: number;
  };
  readonly assets: readonly AflTradeValueLineAsset[];
  readonly trades: readonly AflTradeValueLineTrade[];
  readonly summary: {
    readonly assets: number;
    readonly trades: number;
    readonly byBasis: Readonly<Record<AflTradeValueLineBasis, number>>;
    /** Assets with no value at the last season end. */
    readonly pendingAtLastCheckpoint: number;
    /** Trades with a provisional net at the last season end. */
    readonly provisionalTrades: number;
  };
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
  readonly limitation: typeof AFL_TRADE_VALUE_LINES_LIMITATION;
}

/** The sealed result: its content and the content address over it. */
export interface AflTradeValueLines {
  readonly valueLinesId: string;
  readonly content: AflTradeValueLinesContent;
}
