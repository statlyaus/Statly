import { describe, expect, it } from 'vitest';

import type { TradeRulePresentationInput } from './tradeRulePresentation';
import {
  getTradeAcceptanceConsequence,
  getTradeDeadlineDescription,
  getTradeOfferExpiryDescription,
  getTradeReviewSummary,
} from './tradeRulePresentation';

const rules: TradeRulePresentationInput = {
  reviewMode: 'none',
  deadline: null,
  offerExpiryHours: 72,
  reviewHours: 24,
  vetoThreshold: 3,
};

describe('trade rule presentation', () => {
  it('says the players swap straight away when there is no review', () => {
    expect(getTradeReviewSummary(rules)).toBe('No review');
    expect(getTradeAcceptanceConsequence(rules, 'AFL Legends')).toBe(
      'If AFL Legends accepts, the players swap straight away.'
    );
  });

  it('describes commissioner review without promising an immediate roster change', () => {
    const adminRules = { ...rules, reviewMode: 'admin' as const };
    expect(getTradeReviewSummary(adminRules)).toBe('Commissioner approves');
    expect(getTradeAcceptanceConsequence(adminRules, 'AFL Legends')).toBe(
      'If AFL Legends accepts, the commissioner approves it before the players swap.'
    );
  });

  it('describes the configured veto window and threshold', () => {
    const vetoRules = { ...rules, reviewMode: 'veto' as const };
    expect(getTradeReviewSummary(vetoRules)).toBe('24h veto, 3 votes');
    expect(getTradeAcceptanceConsequence(vetoRules, 'AFL Legends')).toBe(
      'If AFL Legends accepts, the league has 24 hours to veto. 3 votes blocks it.'
    );
  });

  it('explains when a deadline can shorten the configured expiry', () => {
    expect(getTradeDeadlineDescription(null)).toBe('None');
    expect(getTradeOfferExpiryDescription(rules)).toBe('In 72 hours');
    expect(
      getTradeOfferExpiryDescription({
        ...rules,
        deadline: '2026-08-01T12:00:00.000Z',
        offerExpiryHours: 1,
      })
    ).toBe('In 1 hour, or at the deadline if sooner');
  });
});
