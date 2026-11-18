import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const prisma = vi.hoisted(() => ({
  leagueMember: { findFirst: vi.fn() },
  league: { findUnique: vi.fn() },
  leagueBite: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { executeBite } from './bloodsuckerBites';

describe("bite commands act only on the league's active season (league-31)", () => {
  it("answers 404 for a bite of an earlier season and reads it with the active season's id", async () => {
    prisma.leagueMember.findFirst.mockResolvedValue({
      id: 'member-1',
      role: 'MANAGER',
      isCoCommissioner: false,
      isActive: true,
      status: 'ACTIVE',
    });
    prisma.league.findUnique.mockResolvedValue({ activeSeasonId: 'season-2' });
    prisma.leagueBite.findFirst.mockResolvedValue(null);

    await expect(
      executeBite({
        leagueId: 'league-1',
        biteId: 'old-bite',
        userId: 'user-1',
        body: { takenPlayerId: 'p1', returnedPlayerId: 'p2' },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(prisma.leagueBite.findFirst).toHaveBeenCalledWith({
      where: { id: 'old-bite', leagueId: 'league-1', seasonId: 'season-2' },
    });
  });
});
