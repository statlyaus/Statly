import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  leagueMemberFindMany: vi.fn(),
  leagueRosterPlayerFindMany: vi.fn(),
  loggerError: vi.fn(),
  pickFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  teamActionFindMany: vi.fn(),
}));

// Firestore must never decide availability: any use of it fails the test.
vi.mock('@/lib/firebaseAdmin', () => ({
  get adminDb() {
    throw new Error('Firestore must not be read for player availability');
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueMember: { findMany: mocks.leagueMemberFindMany },
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

function request() {
  return GET(new NextRequest('http://localhost/api/players/player-1/availability'), {
    params: Promise.resolve({ id: 'player-1' }),
  });
}

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
    mocks.pickFindMany.mockResolvedValue([]);
    mocks.teamActionFindMany.mockResolvedValue([]);
  });

  it('answers from Prisma alone, for the leagues the user is still active in', async () => {
    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'league-1',
        leagueName: 'Test League',
        teamName: 'Test Team',
        status: 'free-agent',
        action: expect.objectContaining({
          type: 'add',
          href: '/leagues/league-1?tab=roster&addPlayerId=player-1',
        }),
      }),
    ]);
    expect(body.data.leagues[0]).not.toHaveProperty('source');
    expect(mocks.leagueMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isActive: true } })
    );
  });

  it('returns 500 when Prisma fails, rather than showing the player as a free agent', async () => {
    mocks.leagueRosterPlayerFindMany.mockRejectedValue(new Error('database unavailable'));

    const response = await request();

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('uses draft picks for ownership only while the draft is still running', async () => {
    mocks.pickFindMany.mockResolvedValue([
      {
        memberId: 'member-2',
        draft: { leagueId: 'league-1' },
        member: { userId: 'user-2', teamName: 'Rival' },
      },
    ]);

    const body = await (await request()).json();

    expect(mocks.pickFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          playerId: { in: expect.any(Array) },
          draft: { leagueId: { in: ['league-1'] }, status: { not: 'COMPLETED' } },
        },
      })
    );
    expect(body.data.leagues[0]).toMatchObject({ status: 'owned', statusDetail: 'Owned by Rival' });
  });

  it('states when the next daily waiver run processes the claims, in the league timezone', async () => {
    mocks.leagueMemberFindMany.mockResolvedValue([
      {
        id: 'member-1',
        leagueId: 'league-1',
        teamName: 'Test Team',
        league: { id: 'league-1', name: 'Test League', settings: { timeZone: 'Australia/Perth' } },
      },
    ]);
    mocks.teamActionFindMany.mockResolvedValue([
      {
        leagueId: 'league-1',
        actionType: 'WAIVER_CLAIM',
        details: { playerId: 'player-1' },
        processingAt: new Date('2099-10-03T09:30:00.000Z'),
      },
    ]);

    const body = await (await request()).json();
    const [league] = body.data.leagues;

    expect(league.status).toBe('waiver');
    expect(league.timeZone).toBe('Australia/Perth');
    // Due at 8:30 pm Saturday Melbourne time; the run is 6 am Sunday Melbourne (AEDT from that
    // morning), which is 3 am in Perth.
    expect(league.statusDetail).toMatch(/^Claims process Sun,? 4 Oct,? 3:00\sam AWST$/);
    expect(league.waiver.processingAt).toBe('2099-10-03T19:00:00.000Z');
  });

  it('keeps a player with a due but unprocessed claim on waivers instead of offering Add', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 10 am Wednesday 1 July 2026 Melbourne; the claim fell due at 4 am, before the 6 am run that
    // did not settle it, so the next run that can award him is 6 am Thursday.
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    try {
      mocks.leagueMemberFindMany.mockResolvedValue([
        {
          id: 'member-1',
          leagueId: 'league-1',
          teamName: 'Test Team',
          league: {
            id: 'league-1',
            name: 'Test League',
            settings: { timeZone: 'Australia/Melbourne' },
          },
        },
      ]);
      mocks.teamActionFindMany.mockResolvedValue([
        {
          leagueId: 'league-1',
          actionType: 'WAIVER_CLAIM',
          details: { playerId: 'player-1' },
          processingAt: new Date('2026-06-30T18:00:00.000Z'),
        },
      ]);

      const body = await (await request()).json();
      const [league] = body.data.leagues;

      expect(league.status).toBe('waiver');
      expect(league.waiver).toMatchObject({
        processingAt: '2026-07-01T20:00:00.000Z',
        pendingClaims: 1,
      });
      expect(mocks.teamActionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
            OR: expect.arrayContaining([{ actionType: 'WAIVER_CLAIM' }]),
          }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
