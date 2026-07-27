import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firestoreCollection: vi.fn(),
  getAuthenticatedUserId: vi.fn(),
  leagueMemberFindMany: vi.fn(),
  leagueRosterFindMany: vi.fn(),
  leagueRosterPlayerFindMany: vi.fn(),
  listActiveLeagueMembers: vi.fn(),
  listActiveUserLeagueMemberships: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  pickFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  teamActionFindMany: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: { collection: mocks.firestoreCollection },
}));
vi.mock('@/lib/leagueMembership', () => ({
  listActiveLeagueMembers: mocks.listActiveLeagueMembers,
  listActiveUserLeagueMemberships: mocks.listActiveUserLeagueMemberships,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueMember: { findMany: mocks.leagueMemberFindMany },
    leagueRoster: { findMany: mocks.leagueRosterFindMany },
    leagueRosterPlayer: { findMany: mocks.leagueRosterPlayerFindMany },
    pick: { findMany: mocks.pickFindMany },
    player: { findMany: mocks.playerFindMany },
    teamAction: { findMany: mocks.teamActionFindMany },
  },
}));
vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: mocks.getAuthenticatedUserId,
}));

import { GET } from './route';

describe('GET /api/players/[id]/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.leagueMemberFindMany.mockResolvedValue([
      {
        id: 'member-1',
        leagueId: 'league-1',
        teamName: 'Test Team',
        league: { id: 'league-1', name: 'Test League' },
      },
    ]);
    mocks.playerFindMany.mockResolvedValue([{ id: 'player-1' }]);
    mocks.leagueRosterPlayerFindMany.mockResolvedValue([]);
    mocks.leagueRosterFindMany.mockResolvedValue([]);
    mocks.pickFindMany.mockResolvedValue([]);
    mocks.teamActionFindMany.mockResolvedValue([]);
    mocks.listActiveUserLeagueMemberships.mockRejectedValue(
      new Error('Missing Firestore credentials')
    );
    mocks.firestoreCollection.mockImplementation(() => {
      throw new Error('Missing Firestore credentials');
    });
  });

  it('preserves Prisma availability when Firestore compatibility data is unavailable', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/players/player-1/availability'),
      { params: Promise.resolve({ id: 'player-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        playerId: 'player-1',
        leagues: [
          {
            leagueId: 'league-1',
            leagueName: 'Test League',
            teamName: 'Test Team',
            source: 'prisma',
            status: 'free-agent',
            action: {
              type: 'add',
              href: '/leagues/league-1?tab=roster&addPlayerId=player-1',
            },
          },
        ],
      },
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Firestore memberships unavailable for player availability; using Prisma data',
      expect.objectContaining({
        userId: 'user-1',
        error: 'Missing Firestore credentials',
      })
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
