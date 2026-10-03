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
  loadRoundPlayerFixtures: vi.fn(),
  standingFindMany: vi.fn(),
  memberFindMany: vi.fn(),
  normalizeLegacyBenchAssignments: vi.fn(),
  resolveCurrentCompetitionRoundNumber: vi.fn(),
  resolveRequestedLineupRound: vi.fn(),
  saveMemberLineup: vi.fn(),
  synchronizeLineupPlayerLocks: vi.fn(),
  loadLineupRoundSummaries: vi.fn(),
  resolveNextEditableRoundNumber: vi.fn(),
  ensureDefaultLineups: vi.fn(),
  getPlayers: vi.fn(),
  buildLeaguePlayerStatDatasetForTargets: vi.fn(),
}));

vi.mock('@/lib/data', () => ({ getPlayers: mocks.getPlayers }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/leagues/defaultLineups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/leagues/defaultLineups')>()),
  ensureDefaultLineups: mocks.ensureDefaultLineups,
}));
vi.mock('@/server/players/readModels/leaguePlayerStatReadModel', () => ({
  buildLeaguePlayerStatDatasetForTargets: mocks.buildLeaguePlayerStatDatasetForTargets,
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
    leagueStanding: { findMany: mocks.standingFindMany },
    leagueMember: { findMany: mocks.memberFindMany },
  },
}));

vi.mock('@/server/leagues/lineupService', () => ({
  createSetupLineupRoundContext: mocks.createSetupLineupRoundContext,
  loadMemberLineup: mocks.loadMemberLineup,
  loadMemberLineupRoundContext: mocks.loadMemberLineupRoundContext,
  loadRoundPlayerGameStarts: mocks.loadRoundPlayerGameStarts,
  loadRoundPlayerFixtures: mocks.loadRoundPlayerFixtures,
  normalizeLegacyBenchAssignments: mocks.normalizeLegacyBenchAssignments,
  resolveCurrentCompetitionRoundNumber: mocks.resolveCurrentCompetitionRoundNumber,
  resolveRequestedLineupRound: mocks.resolveRequestedLineupRound,
  saveMemberLineup: mocks.saveMemberLineup,
  synchronizeLineupPlayerLocks: mocks.synchronizeLineupPlayerLocks,
  loadLineupRoundSummaries: mocks.loadLineupRoundSummaries,
  resolveNextEditableRoundNumber: mocks.resolveNextEditableRoundNumber,
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
  mocks.loadLineupRoundSummaries.mockResolvedValue([]);
  mocks.loadRoundPlayerFixtures.mockResolvedValue({ ok: true, fixturesByPlayerId: new Map() });
  mocks.standingFindMany.mockResolvedValue([]);
  mocks.memberFindMany.mockResolvedValue([]);
  mocks.ensureDefaultLineups.mockResolvedValue(0);
  mocks.getPlayers.mockResolvedValue([]);
  mocks.buildLeaguePlayerStatDatasetForTargets.mockReturnValue({
    context: {
      basis: 'PER_GAME',
      period: 'SEASON',
      season: 2026,
      availableSeasons: [2026],
      dataThrough: null,
    },
    columns: [],
    playersById: {},
  });
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

  it('keeps GET working without official timing but never presents a started round as unlocked', async () => {
    mocks.loadMemberLineupRoundContext.mockResolvedValue({
      source: 'PUBLISHED',
      round: 2,
      aflRound: 17,
      phase: 'REGULAR',
      roundStatus: 'SCHEDULED',
      startsAt: new Date('2026-01-01T09:00:00.000Z'),
      fallbackLockAt: null,
      lockAt: null,
      lockState: 'OPEN',
      opponent: null,
    });
    mocks.rosterFindMany.mockResolvedValue([
      { playerId: 'player-1', player: { name: 'Player One', club: 'GWS', position: 'MID' } },
    ]);
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

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.timingStatus).toBe('UNAVAILABLE');
    expect(body.data.context.lockState).toBe('TIMING_UNAVAILABLE');
    expect(body.data.rosterPlayers).toEqual([
      {
        playerId: 'player-1',
        name: 'Player One',
        position: 'MID',
        club: 'GWS',
        gameStartsAt: null,
        opponent: null,
        isHome: null,
        bye: false,
        injury: null,
      },
    ]);
    expect(mocks.synchronizeLineupPlayerLocks).not.toHaveBeenCalled();
  });

  it('rejects a PATCH without a players list instead of clearing the lineup', async () => {
    const request = new NextRequest('http://localhost/api/leagues/league-1/lineups/2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await PATCH(request, params);

    expect(response.status).toBe(400);
    expect(mocks.saveMemberLineup).not.toHaveBeenCalled();
  });
});

describe('round resolution and default lineups', () => {
  it('resolves "next" to the next editable round', async () => {
    mocks.resolveNextEditableRoundNumber.mockResolvedValue(5);
    mocks.resolveRequestedLineupRound.mockReturnValue(5);

    await GET(new NextRequest('http://localhost/api/leagues/league-1/lineups/next'), {
      params: Promise.resolve({ id: 'league-1', round: 'next' }),
    });

    expect(mocks.resolveNextEditableRoundNumber).toHaveBeenCalledWith('league-1');
    expect(mocks.resolveRequestedLineupRound).toHaveBeenCalledWith({
      requestedRound: 'next',
      publishedCurrentRound: 5,
    });
  });

  it('saves the default lineup once the round has started', async () => {
    mocks.loadMemberLineupRoundContext.mockResolvedValue({
      source: 'PUBLISHED',
      round: 2,
      aflRound: 17,
      phase: 'REGULAR',
      roundStatus: 'LOCKED',
      startsAt: new Date('2026-01-01T09:00:00.000Z'),
      fallbackLockAt: null,
      lockAt: null,
      lockState: 'LOCKED',
      opponent: null,
    });
    mocks.ensureDefaultLineups.mockResolvedValue(1);
    mocks.loadMemberLineup.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'lineup-2',
      round: 2,
      lockedAt: null,
      players: [],
    });

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/lineups/2'),
      params
    );
    const body = await response.json();

    expect(mocks.ensureDefaultLineups).toHaveBeenCalledWith({
      leagueId: 'league-1',
      round: 2,
      memberIds: ['member-1'],
      now: expect.any(Date),
    });
    expect(body.data.savedRound).toBe(2);
    expect(body.data.carriedFromRound).toBeNull();
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
    expect(
      body.data.players.every((player: { lockedAt: unknown }) => player.lockedAt === null)
    ).toBe(true);
    expect(mocks.synchronizeLineupPlayerLocks).not.toHaveBeenCalled();
  });

  it('offers a lineup picked by position when nothing is saved or carried', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      ownerId: 'owner-1',
      settings: {
        competitionStatus: 'ACTIVE',
        competitionRulesJson: null,
        lineupSlotsJson: JSON.stringify({ DEF: 1, MID: 1, RUC: 0, FWD: 0, UTIL: 0 }),
      },
      members: [{ isCoCommissioner: false }],
    });
    mocks.loadMemberLineupRoundContext.mockResolvedValue({
      source: 'PUBLISHED',
      round: 2,
      aflRound: 17,
      phase: 'REGULAR',
      roundStatus: 'SCHEDULED',
      startsAt: new Date('2099-07-18T09:00:00.000Z'),
      fallbackLockAt: null,
      lockAt: null,
      lockState: 'OPEN',
      opponent: null,
    });
    mocks.rosterFindMany.mockResolvedValue([
      { playerId: 'mid', player: { name: 'Mid', club: 'GWS', position: 'MID' } },
      { playerId: 'def', player: { name: 'Def', club: 'GWS', position: 'DEF' } },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/lineups/2'),
      params
    );
    const body = await response.json();

    expect(body.data.defaultSource).toBe('AUTO');
    expect(body.data.savedRound).toBeNull();
    expect(body.data.players).toEqual(
      expect.arrayContaining([
        { playerId: 'def', slot: 'DEF', slotIndex: 0, lockedAt: null },
        { playerId: 'mid', slot: 'MID', slotIndex: 0, lockedAt: null },
      ])
    );
    expect(mocks.ensureDefaultLineups).not.toHaveBeenCalled();
  });
});

describe('squad fixture context', () => {
  it("adds each player's AFL opponent, bye, injury and both teams' records", async () => {
    mocks.loadMemberLineupRoundContext.mockResolvedValue({
      source: 'PUBLISHED',
      round: 2,
      aflRound: 17,
      phase: 'REGULAR',
      roundStatus: 'SCHEDULED',
      startsAt: new Date('2099-07-18T09:00:00.000Z'),
      fallbackLockAt: null,
      lockAt: null,
      lockState: 'OPEN',
      opponent: { id: 'member-2', teamName: 'Beta FC' },
    });
    mocks.rosterFindMany.mockResolvedValue([
      { playerId: 'player-1', player: { name: 'Player One', club: 'GWS', position: 'MID' } },
      { playerId: 'player-2', player: { name: 'Player Two', club: 'Sydney', position: 'FWD' } },
    ]);
    mocks.loadRoundPlayerFixtures.mockResolvedValue({
      ok: true,
      fixturesByPlayerId: new Map([
        [
          'player-1',
          {
            startsAt: new Date('2099-07-18T09:30:00.000Z'),
            opponent: 'Collingwood',
            isHome: true,
            bye: false,
            status: 'scheduled',
          },
        ],
        ['player-2', { startsAt: null, opponent: null, isHome: null, bye: true, status: null }],
      ]),
    });
    mocks.getPlayers.mockResolvedValue([
      { id: 'player-2', name: 'Player Two', injury: 'Hamstring' },
    ]);
    mocks.memberFindMany.mockResolvedValue([
      { id: 'member-1', teamName: 'Alpha FC', teamLogoUrl: null, draftSlot: 1 },
      { id: 'member-2', teamName: 'Beta FC', teamLogoUrl: null, draftSlot: 2 },
    ]);
    mocks.standingFindMany.mockResolvedValue([
      {
        id: 's1',
        memberId: 'member-1',
        wins: 1,
        losses: 2,
        draws: 0,
        categoryWins: 10,
        categoryLosses: 17,
        categoryDraws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
      {
        id: 's2',
        memberId: 'member-2',
        wins: 3,
        losses: 0,
        draws: 0,
        categoryWins: 20,
        categoryLosses: 7,
        categoryDraws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/lineups/2'),
      params
    );
    const body = await response.json();

    expect(body.data.rosterPlayers).toEqual([
      expect.objectContaining({
        playerId: 'player-1',
        opponent: 'Collingwood',
        isHome: true,
        bye: false,
        gameStartsAt: '2099-07-18T09:30:00.000Z',
        injury: null,
      }),
      expect.objectContaining({ playerId: 'player-2', bye: true, injury: 'Hamstring' }),
    ]);
    expect(body.data.team).toMatchObject({
      teamName: 'Alpha FC',
      record: { wins: 1, losses: 2, draws: 0 },
      rank: 2,
    });
    expect(body.data.opponentTeam).toMatchObject({ teamName: 'Beta FC', rank: 1, teams: 2 });
  });
});
