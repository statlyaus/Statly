import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findLeague: vi.fn(),
  findMembers: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue('owner-user'),
}));

vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn().mockResolvedValue({ isMember: true }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.findLeague },
    leagueSettings: { update: vi.fn() },
    leagueCompetitionRound: { findMany: vi.fn().mockResolvedValue([]) },
    leagueCompetitionAudit: { findMany: vi.fn().mockResolvedValue([]) },
    leagueMember: { findMany: mocks.findMembers },
  },
}));

vi.mock('@/server/leagues/competitionService', () => ({
  publishCompetition: vi.fn(),
  setCompetitionRoundFallbackDeadline: vi.fn(),
  saveCompetitionFixture: vi.fn(),
  deleteCompetitionFixture: vi.fn(),
}));

import { GET } from '@/app/api/leagues/[id]/competition/route';

describe('GET /api/leagues/[id]/competition fixture teams', () => {
  beforeEach(() => {
    mocks.findLeague.mockReset().mockResolvedValue({
      ownerId: 'owner-user',
      categoriesJson: ['goals'],
      settings: {
        id: 'settings-1',
        competitionStatus: 'PENDING',
        competitionRulesJson: {},
        competitionRulesVersion: 1,
        competitionPublishedAt: null,
        rosterSize: 30,
        lineupSlotsJson: null,
      },
      members: [{ id: 'member-1', userId: 'owner-user', isCoCommissioner: false }],
    });
    mocks.findMembers.mockReset().mockResolvedValue([]);
  });

  it('offers only active teams, the same set publish and fixture saves accept', async () => {
    const request = new NextRequest('http://localhost/api/leagues/league-1/competition');

    const response = await GET(request, { params: Promise.resolve({ id: 'league-1' }) });

    expect(response?.status).toBe(200);
    const teamQuery = mocks.findMembers.mock.calls
      .map(([query]) => query)
      .find((query) => 'draftSlot' in (query.select ?? {}));
    expect(teamQuery?.where).toEqual({ leagueId: 'league-1', isActive: true });
  });
});
