// @vitest-environment node

import { LeagueRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {},
}));

import { canProcessWaiverClaimsForRole } from './LeagueApplicationService';

describe('canProcessWaiverClaimsForRole', () => {
  it('allows owners and commissioners to process waiver claims', () => {
    expect(canProcessWaiverClaimsForRole(LeagueRole.OWNER)).toBe(true);
    expect(canProcessWaiverClaimsForRole(LeagueRole.COMMISSIONER)).toBe(true);
  });

  it('rejects managers, missing roles, and unknown roles', () => {
    expect(canProcessWaiverClaimsForRole(LeagueRole.MANAGER)).toBe(false);
    expect(canProcessWaiverClaimsForRole(null)).toBe(false);
    expect(canProcessWaiverClaimsForRole('admin')).toBe(false);
  });
});
