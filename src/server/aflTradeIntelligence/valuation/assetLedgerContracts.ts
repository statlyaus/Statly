/**
 * The asset ledger read model's types (issue 789): every player's club stints and every pick's custody
 * and outcome, from the same governed inputs the realized grader loads. The ledger is private and
 * publication-prohibited, like realized grades. Matched-bid shares and the private trade pages read
 * from it; public pages never do.
 */

export const AFL_TRADE_ASSET_LEDGER_SCHEMA_VERSION = 'afl-trade-asset-ledger/v1' as const;

export const AFL_TRADE_ASSET_LEDGER_LIMITATION: string =
  'Private, non-production asset ledger. Stints follow the realized grader: a stint ends in the first ' +
  'covered season the player appears for another club (that season still counts) or before a later ' +
  'reviewed arrival at the same club, and runs on through seasons with no spells, so a season at two ' +
  'clubs ends the stint at each. A stint starts at its first season in evidence; without a reviewed ' +
  'arrival it may have begun earlier. PAV is HPN PAV from the current calculation per season and is ' +
  'signed. Picks are keyed by the draft-pick id the candidate records; ids are never merged. A ' +
  'not-used pick of a club that took a nominee may have been spent matching a bid and stays pending ' +
  'until bid evidence lands. Not for publication.';

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
  | { readonly kind: 'not_used' }
  | {
      readonly kind: 'matched_bid';
      /** Pending until bid evidence lands: never 0 and never estimated. */
      readonly status: 'pending';
      /**
       * `board_matched_bid`: a Footyinfo board records the receiving club's matched bid.
       * `nominee_count`: only that the club took a nominee in the draft, so the pick may have been
       * spent matching the bid.
       */
      readonly basis: 'board_matched_bid' | 'nominee_count';
      readonly matchedBidBoardPickIds: readonly string[];
    }
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
  readonly summary: {
    readonly players: number;
    readonly playersWithoutName: number;
    readonly stints: number;
    readonly openStints: number;
    readonly picks: number;
    readonly outcomes: Readonly<Record<AflTradeAssetLedgerOutcomeKind, number>>;
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
