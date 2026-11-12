import { describe, expect, it } from 'vitest';

import { leagueManagerUserIds } from './activeMembership';

const member = (userId: string, overrides: Record<string, unknown> = {}) => ({
  userId,
  isCoCommissioner: false,
  isActive: true,
  status: 'ACTIVE',
  ...overrides,
});

describe('leagueManagerUserIds', () => {
  it('names the active owner and active co-commissioners, whatever the draft order holds', () => {
    expect(
      leagueManagerUserIds({
        ownerId: 'owner',
        members: [
          member('owner'),
          member('co', { isCoCommissioner: true }),
          member('manager'),
          member('removed-co', { isCoCommissioner: true, status: 'removed' }),
          member('inactive-co', { isCoCommissioner: true, isActive: false }),
        ],
      })
    ).toEqual(['owner', 'co']);
  });

  it('does not name an owner who is no longer an active member', () => {
    expect(
      leagueManagerUserIds({ ownerId: 'owner', members: [member('owner', { isActive: false })] })
    ).toEqual([]);
  });
});
