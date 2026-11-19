import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { findLeagueFormatStartBlocker } from '@/server/leagues/leagueFormat';

const members = Array.from({ length: 8 }, (_, index) => ({
  id: `m-${index + 1}`,
  isActive: true,
  status: 'ACTIVE',
}));

function tx(bloodsuckerInOrder: number) {
  return {
    league: {
      findUnique: vi.fn().mockResolvedValue({
        settings: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'm-8' },
        members,
      }),
    },
    draftOrder: { count: vi.fn().mockResolvedValue(bloodsuckerInOrder) },
  };
}

describe('draft start refuses a Bloodsucker still in the draft order (draft-26, league-30)', () => {
  it('blocks the start while the Bloodsucker holds a draft-order slot', async () => {
    const client = tx(1);

    const blocker = await findLeagueFormatStartBlocker(client as never, 'league-1');

    expect(blocker).toMatchObject({ code: 'bloodsucker_in_draft_order' });
    expect(client.draftOrder.count).toHaveBeenCalledWith({
      where: { memberId: 'm-8', draft: { leagueId: 'league-1' } },
    });
  });

  it('lets the start through once the order excludes the Bloodsucker', async () => {
    await expect(findLeagueFormatStartBlocker(tx(0) as never, 'league-1')).resolves.toBeNull();
  });
});
