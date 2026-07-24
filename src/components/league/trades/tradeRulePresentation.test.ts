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
  it('describes immediate completion and its authoritative rechecks', () => {
    expect(getTradeReviewSummary(rules)).toBe('Completes on acceptance');
    expect(getTradeAcceptanceConsequence(rules, 'AFL Legends')).toContain(
      'completes immediately after Statly rechecks roster ownership, roster capacity, and league limits'
    );
  });

  it('describes commissioner review without promising an immediate roster change', () => {
    const adminRules = { ...rules, reviewMode: 'admin' as const };
    expect(getTradeReviewSummary(adminRules)).toBe('Commissioner approval');
    expect(getTradeAcceptanceConsequence(adminRules, 'AFL Legends')).toContain(
      'moves to commissioner review'
    );
    expect(getTradeAcceptanceConsequence(adminRules, 'AFL Legends')).toContain(
      'Rosters change only after approval'
    );
  });

  it('describes the configured veto window and threshold', () => {
    const vetoRules = { ...rules, reviewMode: 'veto' as const };
    expect(getTradeReviewSummary(vetoRules)).toBe('24h veto window · 3 votes');
    expect(getTradeAcceptanceConsequence(vetoRules, 'AFL Legends')).toContain(
      '24-hour veto review'
    );
    expect(getTradeAcceptanceConsequence(vetoRules, 'AFL Legends')).toContain('3 votes threshold');
  });

  it('explains when a deadline can shorten the configured expiry', () => {
    expect(getTradeDeadlineDescription(null)).toBe('No league deadline');
    expect(getTradeOfferExpiryDescription(rules)).toBe('72 hours after sending');
    expect(
      getTradeOfferExpiryDescription({
        ...rules,
        deadline: '2026-08-01T12:00:00.000Z',
        offerExpiryHours: 1,
      })
    ).toBe('1 hour after sending or at the league deadline, whichever comes first');
  });
});
