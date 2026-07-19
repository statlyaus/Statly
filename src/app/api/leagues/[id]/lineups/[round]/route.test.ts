import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getLeagueMembership: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindMany: vi.fn(),
  lineupFindFirst: vi.fn(),
  createSetupLineupRoundContext: vi.fn(),
  loadMemberLineup: vi.fn(),
  loadMemberLineupRoundContext: vi.fn(),
  loadRoundPlayerGameStarts: vi.fn(),
  normalizeLegacyBenchAssignments: vi.fn(),
  resolveCurrentCompetitionRoundNumber: vi.fn(),
  resolveRequestedLineupRound: vi.fn(),
  saveMemberLineup: vi.fn(),
  synchronizeLineupPlayerLocks: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: mocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: mocks.getLeagueMembership,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    leagueRosterPlayer: { findMany: mocks.rosterFindMany },
    leagueLineup: { findFirst: mocks.lineupFindFirst },
  },
}));

vi.mock('@/server/leagues/lineupService', () => ({
  createSetupLineupRoundContext: mocks.createSetupLineupRoundContext,
  loadMemberLineup: mocks.loadMemberLineup,
  loadMemberLineupRoundContext: mocks.loadMemberLineupRoundContext,
  loadRoundPlayerGameStarts: mocks.loadRoundPlayerGameStarts,
  normalizeLegacyBenchAssignments: mocks.normalizeLegacyBenchAssignments,
  resolveCurrentCompetitionRoundNumber: mocks.resolveCurrentCompetitionRoundNumber,
  resolveRequestedLineupRound: mocks.resolveRequestedLineupRound,
  saveMemberLineup: mocks.saveMemberLineup,
  synchronizeLineupPlayerLocks: mocks.synchronizeLineupPlayerLocks,
}));

import { GET, PATCH } from './route';

const params = { params: Promise.resolve({ id: 'league-1', round: '2' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
  mocks.getLeagueMembership.mockResolvedValue({
    isMember: true,
    memberDocId: 'member-1',
  });
  mocks.resolveRequestedLineupRound.mockReturnValue(2);
  mocks.loadMemberLineup.mockResolvedValue(null);
  mocks.leagueFindUnique.mockResolvedValue({
    id: 'league-1',
    ownerId: 'owner-1',
    settings: {
      competitionStatus: 'ACTIVE',
      competitionRulesJson: null,
      lineupSlotsJson: null,
    },
    members: [{ isCoCommissioner: false }],
  });
  mocks.rosterFindMany.mockResolvedValue([]);
  mocks.loadMemberLineupRoundContext.mockResolvedValue({
    source: 'PUBLISHED',
    round: 2,
    aflRound: 17,
    phase: 'REGULAR',
    roundStatus: 'SCHEDULED',
    startsAt: new Date('2026-07-18T09:00:00.000Z'),
    fallbackLockAt: null,
    lockAt: null,
    lockState: 'OPEN',
    opponent: null,
  });
  mocks.lineupFindFirst.mockResolvedValue(null);
  mocks.normalizeLegacyBenchAssignments.mockImplementation(
    (players: Array<Record<string, unknown>>) =>
      players.map((player) => ({
        ...player,
        slot: player.slot === 'BENCH' ? 'INTERCHANGE' : player.slot,
      }))
  );
  mocks.loadRoundPlayerGameStarts.mockResolvedValue({
    ok: true,
    gameStartsByPlayerId: new Map(),
    timingStatus: 'PUBLISHED_PENDING',
  });
  mocks.synchronizeLineupPlayerLocks.mockResolvedValue(new Map());
});

describe('lineup round route timing failures', () => {
  it('returns 503 when a PATCH cannot verify official timing', async () => {
    mocks.saveMemberLineup.mockResolvedValue({
      ok: false,
      code: 'TIMING_UNAVAILABLE',
      errors: ['Official AFL match timing is temporarily unavailable.'],
    });
    const request = new NextRequest('http://localhost/api/leagues/league-1/lineups/2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ players: [] }),
    });

    const response = await PATCH(request, params);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Lineup timing unavailable',
      details: ['Official AFL match timing is temporarily unavailable.'],
    });
  });

  it('returns 503 on GET instead of presenting provider failure as unlocked', async () => {
    mocks.lineupFindFirst.mockResolvedValue({
      id: 'prior-lineup',
      round: 1,
      lockedAt: null,
      players: [
        {
          id: 'assignment-1',
          playerId: 'player-1',
          slot: 'INTERCHANGE',
          slotIndex: 0,
          lockedAt: null,
          player: { id: 'player-1', name: 'Player One', club: 'GWS', position: 'MID' },
        },
      ],
    });
    mocks.loadRoundPlayerGameStarts.mockResolvedValue({
      ok: false,
      error: 'Official AFL match timing is temporarily unavailable.',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/lineups/2'),
      params
    );

    expect(response.status).toBe(503);
    expect(mocks.synchronizeLineupPlayerLocks).not.toHaveBeenCalled();
  });
});

describe('carried lineup normalization', () => {
  it('normalizes BENCH and clears stale prior-round locks throughout the payload', async () => {
    const staleLockedAt = new Date('2026-07-10T09:00:00.000Z');
    mocks.lineupFindFirst.mockResolvedValue({
      id: 'prior-lineup',
      round: 1,
      lockedAt: staleLockedAt,
      players: [
        {
          id: 'assignment-1',
          playerId: 'player-1',
          slot: 'BENCH',
          slotIndex: 0,
          lockedAt: staleLockedAt,
          player: { id: 'player-1', name: 'Player One', club: 'GWS', position: 'MID' },
        },
      ],
    });

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/lineups/2'),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.carriedFromRound).toBe(1);
    expect(body.data.lineup.lockedAt).toBeNull();
    expect(body.data.lineup.players[0]).toMatchObject({
      slot: 'INTERCHANGE',
      lockedAt: null,
    });
    expect(body.data.players[0]).toMatchObject({
      slot: 'INTERCHANGE',
      lockedAt: null,
    });
    expect(mocks.synchronizeLineupPlayerLocks).not.toHaveBeenCalled();
  });
});
