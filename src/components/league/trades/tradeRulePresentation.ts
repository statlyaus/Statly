import { getTradeAcceptancePath, type TradeReviewMode } from '@/lib/trades/tradeAcceptancePath';

import { formatTradeDate, formatTradeDateTime } from './tradeDateFormatting';

export interface TradeRulePresentationInput {
  reviewMode: TradeReviewMode;
  deadline: string | null;
  offerExpiryHours: number;
  reviewHours: number;
  vetoThreshold: number;
}

export function getTradeReviewSummary(rules: TradeRulePresentationInput): string {
  const path = getTradeAcceptancePath(rules.reviewMode);
  if (path.kind === 'immediate') return 'Completes on acceptance';
  if (path.kind === 'commissioner-review') return 'Commissioner approval';
  return `${rules.reviewHours}h veto window · ${formatVotes(rules.vetoThreshold)}`;
}

export function getTradeDeadlineSummary(deadline: string | null): string {
  return deadline ? formatTradeDate(deadline) : 'No deadline';
}

export function getTradeDeadlineDescription(deadline: string | null): string {
  if (!deadline) return 'No league deadline';
  const formatted = formatTradeDateTime(deadline);
  return formatted === 'date unavailable' ? 'No league deadline' : formatted;
}

export function getTradeOfferExpirySummary(offerExpiryHours: number): string {
  return `${offerExpiryHours}h after sending`;
}

export function getTradeOfferExpiryDescription(rules: TradeRulePresentationInput): string {
  const duration = `${rules.offerExpiryHours} ${formatHours(rules.offerExpiryHours)} after sending`;
  return rules.deadline ? `${duration} or at the league deadline, whichever comes first` : duration;
}

export function getTradeAcceptanceConsequence(
  rules: TradeRulePresentationInput,
  recipientTeamName: string
): string {
  const path = getTradeAcceptancePath(rules.reviewMode);

  if (path.kind === 'immediate') {
    return `If ${recipientTeamName} accepts, the trade completes immediately after Statly rechecks roster ownership, roster capacity, and league limits.`;
  }

  if (path.kind === 'commissioner-review') {
    return `If ${recipientTeamName} accepts, the trade moves to commissioner review. Rosters change only after approval and Statly's final validation.`;
  }

  return `If ${recipientTeamName} accepts, the trade enters a ${rules.reviewHours}-hour veto review. Rosters change after the review window unless the ${formatVotes(rules.vetoThreshold)} threshold is reached, subject to Statly's final validation.`;
}

function formatHours(value: number): string {
  return value === 1 ? 'hour' : 'hours';
}

function formatVotes(value: number): string {
  return `${value} ${value === 1 ? 'vote' : 'votes'}`;
}
