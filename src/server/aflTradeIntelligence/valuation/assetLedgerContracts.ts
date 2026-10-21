/**
 * The asset ledger read model's types (issue 789): every player's club stints and every pick's custody
 * and outcome, from the same governed inputs the realized grader loads. The ledger is private and
 * publication-prohibited, like realized grades. Matched-bid shares and the private trade pages read
 * from it; public pages never do.
 */

export const AFL_TRADE_ASSET_LEDGER_SCHEMA_VERSION = 'afl-trade-asset-ledger/v2' as const;

export const AFL_TRADE_ASSET_LEDGER_LIMITATION: string =
  'Private, non-production asset ledger. Stints follow the realized grader: a stint ends in the first ' +
  'covered season the player appears for another club (that season still counts) or before a later ' +
  'reviewed arrival at the same club, and runs on through seasons with no spells, so a season at two ' +
  'clubs ends the stint at each. A stint starts at its first season in evidence; without a reviewed ' +
  'arrival it may have begun earlier. PAV is HPN PAV from the current calculation per season and is ' +
  'signed. Picks are keyed by the draft-pick id the candidate records; ids are never merged. A ' +
  'not-used pick of a club that took a nominee may have been spent matching a bid: it takes its share ' +
  "of the nominee's first stint by the points it covered of the year's AFL price when a Footyinfo " +
  'board lists it as spent and joins it to its custody slot, and stays pending otherwise. Not for ' +
  'publication.';

/** One season of a stint: the player's HPN PAV at the club, 0 when he has no row there. */
export interface AflTradeAssetLedgerStintSeason {
  readonly season: number;
  readonly pav: number;
  /** False when the season's pinned calculation is not official. */
  readonly official: boolean;
}

/** A player's stint at one club, by the grader's first-stint rules. */
export interface AflTradeAssetLedgerStint {
  readonly clubId: string;
  readonly startSeason: number;
  /** The last season counted, or null while the stint is open (or counts no season). */
  readonly endSeason: number | null;
  readonly status: 'open' | 'closed';
  /** A reviewed (v4) arrival at the club in the season before the start or the start season. */
  readonly arrivalReviewed: boolean;
  /** Starts in the first covered season with no reviewed arrival, so it may have begun earlier. */
  readonly beganBeforeCoverage: boolean;
  readonly seasons: readonly AflTradeAssetLedgerStintSeason[];
  /** Seasons of the stint with no pinned PAV calculation. */
  readonly seasonsMissingPav: readonly number[];
  /** The signed HPN PAV sum of `seasons`. */
  readonly total: number;
  /** `total` floored at 0: what a grade leg realizes for this stint (rule v4). */
  readonly value: number;
}

export interface AflTradeAssetLedgerPlayer {
  readonly playerId: string;
  /** The approved canonical display name, or null when the player has no approved row. */
  readonly name: string | null;
  readonly stints: readonly AflTradeAssetLedgerStint[];
}

/** One trade a pick moved in: the club that gave it and the club that held it after. */
export interface AflTradeAssetLedgerPickHop {
  readonly transactionId: string;
  readonly transferId: string;
  readonly seasonYear: number;
  /** Null when the candidate could not resolve the club; such a hop never joins a trail. */
  readonly fromClubId: string | null;
  readonly toClubId: string | null;
}

/** The order slot a pick not yet drafted is projected to (rule v6's live-order lookup). */
export interface AflTradeAssetLedgerProjectedSlot {
  readonly selectionNumber: number;
  readonly custodyId: string;
  readonly orderDraftYear: number;
  /** True when the previous draft's order stands in because the pick's own draft has none. */
  readonly proxy: boolean;
}

export type AflTradeAssetLedgerUnresolvedReason =
  | 'no_outcome_evidence'
  | 'not_used_no_access_evidence'
  | 'outcome_conflict'
  | 'pick_outcome_unresolved'
  | 'selection_conflict'
  | 'traded_on_unlinked';

/**
 * Why a pick a club may have spent matching a bid has no share. `no_bid_spend`: no board bid match
 * lists it as spent (or its slot does not join). `bid_unpriced`: the year's rule cannot price the bid.
 * `nominee_unresolved`: the bid's nominee is not one candidate selection. `spent_twice`: two bid
 * matches list it.
 */
export type AflTradeAssetLedgerBidPendingReason =
  'no_bid_spend' | 'bid_unpriced' | 'nominee_unresolved' | 'spent_twice';

interface MatchedBidOutcomeBase {
  readonly kind: 'matched_bid';
  /**
   * `board_matched_bid`: a Footyinfo board records the receiving club's matched bid.
   * `nominee_count`: only that the club took a nominee in the draft, so the pick may have been spent
   * matching the bid.
   */
  readonly basis: 'board_matched_bid' | 'nominee_count';
  readonly matchedBidBoardPickIds: readonly string[];
}

/** A pick spent matching a bid: its share of the nominee, or pending (never 0, never estimated). */
export type AflTradeAssetLedgerMatchedBidOutcome =
  | (MatchedBidOutcomeBase & {
      readonly status: 'pending';
      readonly pendingReason: AflTradeAssetLedgerBidPendingReason;
    })
  | (MatchedBidOutcomeBase & {
      readonly status: 'shared';
      readonly bidMatchId: string;
      readonly nomineePlayerId: string;
      /** The points the pick covered of the price, and that over the price. */
      readonly countedPoints: number;
      readonly share: number;
      readonly use: 'full' | 'partial';
      /** `share` × the nominee's first-stint value at the matching club; null with no stint. */
      readonly value: number | null;
    });

/** How a board's spent pick joins a candidate pick: by its custody slot, else by one trade. */
export type AflTradeAssetLedgerBidSpendLink =
  /** One pick id has a usable custody row with the spent pick's number and original club. */
  | 'custody'
  /**
   * No custody slot, but exactly one pick traded once, from the spent pick's original club to the
   * bidding club, with the trade-stated number equal to the board's (owner, 2026-10-21).
   */
  | 'trade_entitlement'
  /** Joined by owner review (`assetLedgerReviewedBidSpends.ts`). */
  | 'reviewed'
  /** The board gives no number: a leftover-points pick an earlier bid created. */
  | 'unnumbered'
  | 'club_unresolved'
  | 'no_custody'
  | 'ambiguous_custody';

export interface AflTradeAssetLedgerBidSpentPick {
  readonly nativePickId: string;
  readonly label: string;
  readonly originalNumber: number | null;
  readonly originalClubId: string | null;
  readonly pointsUsed: number;
  readonly pickId: string | null;
  readonly link: AflTradeAssetLedgerBidSpendLink;
  /** Null when the bid is unpriced. */
  readonly countedPoints: number | null;
  readonly share: number | null;
  readonly use: 'full' | 'partial' | null;
  /** `share` × the nominee's first-stint value; null when either is missing. */
  readonly value: number | null;
}

/** One board matched bid: its price by the year's AFL rule and each spent pick's share. */
export interface AflTradeAssetLedgerBidMatch {
  readonly bidMatchId: string;
  readonly draftYear: number;
  readonly draftType: string;
  readonly selectionNumber: number;
  /** The matching club. */
  readonly clubId: string | null;
  readonly bidClubId: string | null;
  readonly basis: 'father_son' | 'academy' | 'next_generation_academy';
  /** The candidate selection of the nominee, and his first stint at the matching club. */
  readonly nominee: {
    readonly selectionId: string;
    readonly playerId: string;
    readonly firstStint: AflTradeAssetLedgerStint | null;
  } | null;
  readonly pricing:
    | {
        readonly status: 'shared';
        readonly ruleId: string;
        /** Null when the club's next selection paid in full. */
        readonly pricePoints: number | null;
        readonly leftover: {
          readonly spentNativePickId: string;
          readonly remainderPoints: number;
          readonly boardLeftoverPickIds: readonly string[];
        } | null;
        readonly deficit: {
          readonly points: number | null;
          readonly against: 'next_draft_first_pick' | 'next_selection';
        } | null;
      }
    | { readonly status: 'refused'; readonly reason: string; readonly detail: string };
  readonly spentPicks: readonly AflTradeAssetLedgerBidSpentPick[];
}

/** What became of a pick. Nothing is guessed: missing or conflicting evidence is `unresolved`. */
export type AflTradeAssetLedgerPickOutcome =
  | {
      readonly kind: 'selected';
      readonly selectionId: string | null;
      readonly playerId: string | null;
      /** The drafting club. */
      readonly clubId: string | null;
      readonly selectionNumber: number | null;
      /** The drafted player's first stint at the drafting club, from the season after the draft. */
      readonly firstStint: AflTradeAssetLedgerStint | null;
    }
  | {
      readonly kind: 'not_used';
      /**
       * `board_not_spent`: Draftguru says not used and the club took a nominee, but the draft's boards
       * list the club's bid spends and this pick is not among them (owner, 2026-10-21).
       */
      readonly evidence?: 'board_not_spent';
    }
  | AflTradeAssetLedgerMatchedBidOutcome
  | { readonly kind: 'passed'; readonly boardPickId: string }
  | { readonly kind: 'future'; readonly projectedSlot: AflTradeAssetLedgerProjectedSlot | null }
  | { readonly kind: 'unresolved'; readonly reason: AflTradeAssetLedgerUnresolvedReason };

export type AflTradeAssetLedgerPickIdentityField =
  'draftYear' | 'draftType' | 'round' | 'originalClubId';

export interface AflTradeAssetLedgerPick {
  readonly pickId: string;
  readonly draftYear: number;
  readonly draftType: string;
  readonly round: number | null;
  readonly originalClubId: string | null;
  /** Identity fields on which the custody rows, traded entitlements and selections disagree. */
  readonly identityDisagreements: readonly AflTradeAssetLedgerPickIdentityField[];
  /**
   * `trail` when the trades form one unique trail through the grader's graded trades; otherwise
   * sorted by season, Draftguru pick-trade sequence, date and transfer id.
   */
  readonly hopOrder: 'trail' | 'unordered';
  readonly hops: readonly AflTradeAssetLedgerPickHop[];
  readonly outcome: AflTradeAssetLedgerPickOutcome;
}

export interface AflTradeAssetLedgerClub {
  readonly clubId: string;
  readonly name: string | null;
}

export type AflTradeAssetLedgerOutcomeKind = AflTradeAssetLedgerPickOutcome['kind'];

export interface AflTradeAssetLedgerContent {
  readonly schemaVersion: typeof AFL_TRADE_ASSET_LEDGER_SCHEMA_VERSION;
  readonly environment: 'non_production';
  readonly valueUnit: 'hpn_pav';
  readonly inputs: {
    readonly candidateId: string;
    readonly pavCalculations: readonly {
      readonly season: number;
      readonly calculationId: string;
      readonly official: boolean;
    }[];
    readonly spellSeasons: readonly number[];
    readonly spellCutoffAt: string;
  };
  readonly builtAt: string;
  readonly clubs: readonly AflTradeAssetLedgerClub[];
  readonly players: readonly AflTradeAssetLedgerPlayer[];
  readonly picks: readonly AflTradeAssetLedgerPick[];
  /** Every Footyinfo board matched bid the candidate carries (issue 789). */
  readonly bidMatches: readonly AflTradeAssetLedgerBidMatch[];
  readonly summary: {
    readonly players: number;
    readonly playersWithoutName: number;
    readonly stints: number;
    readonly openStints: number;
    readonly picks: number;
    readonly outcomes: Readonly<Record<AflTradeAssetLedgerOutcomeKind, number>>;
    /** Matched-bid picks that took a share of their nominee. */
    readonly matchedBidPicksShared: number;
  };
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
  readonly limitation: typeof AFL_TRADE_ASSET_LEDGER_LIMITATION;
}

/** The sealed ledger: its content and the content address over it. */
export interface AflTradeAssetLedger {
  readonly ledgerId: string;
  readonly content: AflTradeAssetLedgerContent;
}

/** Canonical labels, injected so the builder stays pure. Labels carry no authority. */
export interface AflTradeAssetLedgerLabels {
  readonly players: readonly { readonly playerId: string; readonly name: string }[];
  readonly clubs: readonly { readonly clubId: string; readonly name: string }[];
}
