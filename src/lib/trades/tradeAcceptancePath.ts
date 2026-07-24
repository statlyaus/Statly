export const TRADE_REVIEW_MODES = ['none', 'admin', 'veto'] as const;

export type TradeReviewMode = (typeof TRADE_REVIEW_MODES)[number];

export type TradeAcceptancePath =
  | { kind: 'immediate' }
  | { kind: 'commissioner-review' }
  | { kind: 'veto-review' };

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
