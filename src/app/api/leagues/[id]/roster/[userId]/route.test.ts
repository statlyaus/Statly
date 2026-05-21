import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const ensureRosterTablesMock = vi.fn();
const isAuthBypassEnabledMock = vi.fn();
const getLeagueRosterContextMock = vi.fn();
const getLeagueRosterSummaryMapMock = vi.fn();

const prismaMock = {
  leagueMember: {
    findFirst: vi.fn(),
  },
  league: {
    findUnique: vi.fn(),
  },
  leagueRosterPlayer: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  leagueRoster: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/ensureLobbyColumns', () => ({
  ensureRosterTables: ensureRosterTablesMock,
}));

vi.mock('@/lib/authBypass', () => ({
  isAuthBypassEnabled: isAuthBypassEnabledMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    getLeagueRosterContext: getLeagueRosterContextMock,
  },
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  getLeagueRosterSummaryMap: getLeagueRosterSummaryMapMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leagues/league-1/roster/user-1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function malformedPutRequest() {
  return new NextRequest('http://localhost/api/leagues/league-1/roster/user-1', {
    method: 'PUT',
    body: '{',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PUT /api/leagues/[id]/roster/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    ensureRosterTablesMock.mockResolvedValue(undefined);
    isAuthBypassEnabledMock.mockReturnValue(false);
    getLeagueRosterContextMock.mockResolvedValue(null);
    getLeagueRosterSummaryMapMock.mockResolvedValue(new Map());
    prismaMock.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prismaMock.league.findUnique.mockResolvedValue({ id: 'league-1', settings: {} });
    prismaMock.leagueRosterPlayer.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.leagueRosterPlayer.createMany.mockResolvedValue({ count: 2 });
    prismaMock.leagueRoster.upsert.mockResolvedValue({
      id: 'roster-1',
      leagueId: 'league-1',
      memberId: 'member-1',
      captainId: 'player-1',
      viceCaptainId: 'player-2',
      benchOrder: JSON.stringify(['player-2', 'player-1']),
      updatedAt: new Date('2026-05-20T00:00:00.000Z'),
    });
    prismaMock.$transaction.mockImplementation(async (input: unknown) => {
      if (Array.isArray(input)) {
        return Promise.all(input);
      }
      if (typeof input === 'function') {
        return input({
          leagueRosterPlayer: prismaMock.leagueRosterPlayer,
          leagueRoster: prismaMock.leagueRoster,
        });
      }
      return input;
    });
  });

  it('rejects unauthenticated roster writes before parsing malformed request bodies', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { PUT } = await import('./route');

    const response = await PUT(malformedPutRequest(), {
      params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
    });

    expect(response.status).toBe(401);
    expect(ensureRosterTablesMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('forbids cross-user roster writes before touching roster tables', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-2');
    const { PUT } = await import('./route');

    const response = await PUT(putRequest({ playerIds: ['player-1'] }), {
      params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
    });

    expect(response.status).toBe(403);
    expect(ensureRosterTablesMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns a bad request for invalid roster bodies without mutating roster rows', async () => {
    const { PUT } = await import('./route');

    const response = await PUT(putRequest({ playerIds: 'player-1' }), {
      params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(ensureRosterTablesMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('updates the authenticated user roster atomically', async () => {
    const { PUT } = await import('./route');

    const response = await PUT(
      putRequest({
        playerIds: ['player-1', 'player-2'],
        captainId: 'player-1',
        viceCaptainId: 'player-2',
        benchOrder: ['player-2', 'player-1'],
      }),
      {
        params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.leagueMember.findFirst).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', userId: 'user-1' },
    });
    expect(prismaMock.leagueRosterPlayer.deleteMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', memberId: 'member-1' },
    });
    expect(prismaMock.leagueRosterPlayer.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'league-1:member-1:player-1',
          leagueId: 'league-1',
          memberId: 'member-1',
          playerId: 'player-1',
          sortOrder: 0,
        },
        {
          id: 'league-1:member-1:player-2',
          leagueId: 'league-1',
          memberId: 'member-1',
          playerId: 'player-2',
          sortOrder: 1,
        },
      ],
    });
    expect(body.data.roster).toMatchObject({
      id: 'roster-1',
      leagueId: 'league-1',
      memberId: 'member-1',
      captainId: 'player-1',
      viceCaptainId: 'player-2',
      benchOrder: ['player-2', 'player-1'],
    });
  });
});
