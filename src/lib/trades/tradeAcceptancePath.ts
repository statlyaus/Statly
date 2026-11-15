export const TRADE_REVIEW_MODES = ['none', 'admin', 'veto'] as const;

export type TradeReviewMode = (typeof TRADE_REVIEW_MODES)[number];

export type TradeAcceptancePath =
  { kind: 'immediate' } | { kind: 'commissioner-review' } | { kind: 'veto-review' };

/**
 * Describes the lifecycle path that follows recipient acceptance.
 *
 * This intentionally contains no display copy or persistence details so the
 * server policy and client presentation can share the same rule meaning.
 */
export function getTradeAcceptancePath(reviewMode: TradeReviewMode): TradeAcceptancePath {
  if (reviewMode === 'none') return { kind: 'immediate' };
  if (reviewMode === 'admin') return { kind: 'commissioner-review' };
  return { kind: 'veto-review' };
}

/** Who can review one trade: read when it is accepted, and again by the review sweep. */
export interface TradeReviewContext {
  /** The owner or a co-commissioner is one of the two teams. */
  commissionerIsParty: boolean;
  /** Active teams other than the two in the trade. */
  eligibleVoters: number;
}

/**
 * The review a trade actually gets. A trade with a commissioner on either side goes to a veto vote
 * instead of commissioner review, so no commissioner approves their own trade. A veto vote with no
 * team left to vote is no review at all, so that trade completes on acceptance.
 */
export function resolveTradeReviewMode(
  reviewMode: TradeReviewMode,
  review: TradeReviewContext
): TradeReviewMode {
  const mode = reviewMode === 'admin' && review.commissionerIsParty ? 'veto' : reviewMode;
  return mode === 'veto' && review.eligibleVoters <= 0 ? 'none' : mode;
}
