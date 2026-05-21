import { LeagueRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { canManageTradeReviewForRole } from './tradeService';

describe('canManageTradeReviewForRole', () => {
  it('allows owners and commissioners to manage trade reviews', () => {
    expect(canManageTradeReviewForRole(LeagueRole.OWNER)).toBe(true);
    expect(canManageTradeReviewForRole(LeagueRole.COMMISSIONER)).toBe(true);
  });

  it('rejects managers, missing roles, and unknown roles', () => {
    expect(canManageTradeReviewForRole(LeagueRole.MANAGER)).toBe(false);
    expect(canManageTradeReviewForRole(null)).toBe(false);
    expect(canManageTradeReviewForRole('admin')).toBe(false);
  });
});
