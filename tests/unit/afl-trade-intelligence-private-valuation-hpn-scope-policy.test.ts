import { describe, expect, it } from 'vitest';

import { requireAflTradePrivateValuationHpnScopePolicy } from '@/server/aflTradeIntelligence/valuation/privateValuationHpnScopePolicy';

describe('private valuation HPN scope policy', () => {
  it.each([
    ['afl-men:2025-trades', 2025],
    ['afl-men:2026-trades', 2026],
  ] as const)('binds %s to its exact AFLM season', (scopeKey, seasonYear) => {
    expect(requireAflTradePrivateValuationHpnScopePolicy(scopeKey)).toEqual({
      scopeKey,
      competition: 'AFLM',
      seasonYear,
    });
  });

  it('rejects an unreviewed season instead of deriving authority from its name', () => {
    expect(() => requireAflTradePrivateValuationHpnScopePolicy('afl-men:2024-trades')).toThrow(
      'HPN preparation does not support afl-men:2024-trades.'
    );
  });
});
