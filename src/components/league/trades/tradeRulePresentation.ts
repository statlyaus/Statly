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
  if (path.kind === 'immediate') return 'No review';
  if (path.kind === 'commissioner-review') return 'Commissioner approves';
  return `${rules.reviewHours}h veto, ${formatVotes(rules.vetoThreshold)}`;
}

export function getTradeDeadlineSummary(deadline: string | null): string {
  return deadline ? `Deadline ${formatTradeDate(deadline)}` : 'No deadline';
}

export function getTradeDeadlineDescription(deadline: string | null): string {
  if (!deadline) return 'None';
  const formatted = formatTradeDateTime(deadline);
  return formatted === 'date unavailable' ? 'None' : formatted;
}

export function getTradeOfferExpirySummary(offerExpiryHours: number): string {
  return `Offers expire after ${offerExpiryHours}h`;
}

export function getTradeOfferExpiryDescription(rules: TradeRulePresentationInput): string {
  const duration = `In ${rules.offerExpiryHours} ${formatHours(rules.offerExpiryHours)}`;
  return rules.deadline ? `${duration}, or at the deadline if sooner` : duration;
}

export function getTradeAcceptanceConsequence(
  rules: TradeRulePresentationInput,
  recipientTeamName: string
): string {
  const path = getTradeAcceptancePath(rules.reviewMode);

  if (path.kind === 'immediate') {
    return `If ${recipientTeamName} accepts, the players swap straight away.`;
  }

  if (path.kind === 'commissioner-review') {
    return `If ${recipientTeamName} accepts, the commissioner approves it before the players swap.`;
  }

  return `If ${recipientTeamName} accepts, the league has ${rules.reviewHours} hours to veto. ${formatVotes(rules.vetoThreshold)} blocks it.`;
}

/** What happens once the trade is accepted, without naming who accepts. */
export function getTradeAcceptanceSummary(rules: TradeRulePresentationInput): string {
  const path = getTradeAcceptancePath(rules.reviewMode);
  if (path.kind === 'immediate') return 'The players swap straight away.';
  if (path.kind === 'commissioner-review') {
    return 'The commissioner approves it before the players swap.';
  }
  return `The league has ${rules.reviewHours} hours to veto. ${formatVotes(rules.vetoThreshold)} blocks it.`;
}

function formatHours(value: number): string {
  return value === 1 ? 'hour' : 'hours';
}

function formatVotes(value: number): string {
  return `${value} ${value === 1 ? 'vote' : 'votes'}`;
}
