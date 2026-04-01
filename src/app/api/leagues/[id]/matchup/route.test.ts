import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const ensureLeagueSeasonMaterializedMock = vi.fn();
const getComputedLeagueSeasonStateMock = vi.fn();
const getComputedLeagueRoundMock = vi.fn();
const selectComputedLeagueRoundMatchupsMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/leagueSeason', () => ({
  ensureLeagueSeasonMaterialized: ensureLeagueSeasonMaterializedMock,
  getComputedLeagueSeasonState: getComputedLeagueSeasonStateMock,
  getComputedLeagueRound: getComputedLeagueRoundMock,
  selectComputedLeagueRoundMatchups: selectComputedLeagueRoundMatchupsMock,
  deriveSeasonRoundsFromMatchDocuments: (matches: Array<Record<string, unknown>>) => {
    const byRound = new Map<
      number,
      { round: number; label: string; statuses: Set<'scheduled' | 'in_progress' | 'final'> }
    >();

    for (const match of matches) {
      const round = Number(match.round_number ?? match.round ?? Number.NaN);
      if (!Number.isFinite(round)) continue;

      const normalizedStatus =
        match.status === 'final'
          ? 'final'
          : match.status === 'in_progress'
            ? 'in_progress'
            : 'scheduled';
      const entry = byRound.get(round) ?? {
        round,
        label: String(match.round_label ?? `Round ${round}`),
        statuses: new Set<'scheduled' | 'in_progress' | 'final'>(),
      };
      entry.statuses.add(normalizedStatus);
      byRound.set(round, entry);
    }

    return Array.from(byRound.values())
      .map((entry) => ({
        round: entry.round,
        label: entry.label,
        status: entry.statuses.has('in_progress')
          ? 'in_progress'
          : entry.statuses.has('final') && entry.statuses.has('scheduled')
            ? 'in_progress'
            : entry.statuses.has('final')
              ? 'final'
              : 'scheduled',
      }))
      .sort((left, right) => left.round - right.round);
  },
  determineCurrentLeagueRound: (
    rounds: Array<{ round: number; status: 'scheduled' | 'in_progress' | 'final' }>
  ) => {
    const inProgress = rounds.filter((round) => round.status === 'in_progress');
    if (inProgress.length > 0) {
      return Math.max(...inProgress.map((round) => round.round));
    }

    const finalRounds = rounds.filter((round) => round.status === 'final');
    const latestFinal = finalRounds.length > 0 ? Math.max(...finalRounds.map((round) => round.round)) : null;
    const upcoming = rounds.find(
      (round) => round.status === 'scheduled' && (latestFinal == null || round.round > latestFinal)
    );
    return upcoming?.round ?? latestFinal;
  },
}));

const firestoreGetMock = vi.fn();
const firestoreCollectionMock = vi.fn();
const redisGetMock = vi.fn();
const redisSetMock = vi.fn();
const redisConnectMock = vi.fn();
const redisIsConnectedMock = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: firestoreCollectionMock,
  },
}));

vi.mock('@/lib/redis', () => ({
  redisClient: {
    get: redisGetMock,
    set: redisSetMock,
    connect: redisConnectMock,
    isConnected: redisIsConnectedMock,
  },
}));

const prismaMock = {
  league: { findUnique: vi.fn() },
  leagueMember: { findFirst: vi.fn(), findMany: vi.fn() },
  leagueRosterPlayer: { findMany: vi.fn() },
  player: { findMany: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function createQuery(chainState: {
  collectionName: string;
  filters: Array<{ field: string; value: unknown }>;
}) {
  const query: Record<string, unknown> = {
    collectionName: chainState.collectionName,
    where: vi.fn((field: string, _op: string, value: unknown) => {
      chainState.filters.push({ field, value });
      return query;
    }),
    limit: vi.fn(() => query),
    get: firestoreGetMock,
  };
  return query;
}

describe('GET /api/leagues/[id]/matchup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T00:00:00.000Z'));

    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    ensureLeagueSeasonMaterializedMock.mockResolvedValue({ bootstrapped: false, reason: null });
    const computedState = {
      matchups: [
        {
          id: 'matchup-1',
          leagueId: 'league-1',
          participants: ['user-1', 'user-2'],
          homeUserId: 'user-1',
          awayUserId: 'user-2',
          current: true,
          roundLabel: 'Round 1',
          aflRound: 1,
          status: 'in_progress',
        },
        {
          id: 'matchup-2',
          leagueId: 'league-1',
          participants: ['user-3', 'user-4'],
          homeUserId: 'user-3',
          awayUserId: 'user-4',
          current: true,
          roundLabel: 'Round 1',
          aflRound: 1,
          status: 'final',
        },
      ],
      scheduleWeeks: [
        { week: 1, aflRound: 1, roundLabel: 'Round 1', status: 'in_progress', matchupIds: ['matchup-1', 'matchup-2'], current: true },
      ],
      memberSnapshots: [],
    };
    getComputedLeagueSeasonStateMock.mockResolvedValue(computedState);
    getComputedLeagueRoundMock.mockImplementation(
      ({ state, requestedRound }: { state: typeof computedState; requestedRound: number | null }) =>
        requestedRound ??
        state.scheduleWeeks.find((week) => week.current)?.aflRound ??
        state.matchups[0]?.aflRound ??
        null
    );
    selectComputedLeagueRoundMatchupsMock.mockImplementation(
      ({ state, round }: { state: typeof computedState; round: number }) =>
        state.matchups.filter((matchup) => Number(matchup.aflRound) === round)
    );
    redisIsConnectedMock.mockReturnValue(true);
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue(undefined);
    redisConnectMock.mockResolvedValue(undefined);

    prismaMock.league.findUnique.mockResolvedValue({
      id: 'league-1',
      name: 'Example League',
    });
    prismaMock.leagueMember.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.userId === 'user-1') {
        return { id: 'member-1', userId: 'user-1', teamName: 'My Team' };
      }
      if (where.userId === 'user-2') {
        return { id: 'member-2', userId: 'user-2', teamName: 'Opponent Team' };
      }
      return null;
    });
    prismaMock.leagueMember.findMany.mockImplementation(async ({ where }: any) => {
      const ids = new Set((where.userId?.in ?? []).map(String));
      return [
        { id: 'member-1', userId: 'user-1', teamName: 'My Team' },
        { id: 'member-2', userId: 'user-2', teamName: 'Opponent Team' },
        { id: 'member-3', userId: 'user-3', teamName: 'Third Team' },
        { id: 'member-4', userId: 'user-4', teamName: 'Fourth Team' },
      ].filter((member) => ids.has(member.userId));
    });
    prismaMock.leagueRosterPlayer.findMany.mockImplementation(async ({ where }: any) => {
      const memberIds = Array.isArray(where.memberId?.in)
        ? where.memberId.in.map((memberId: unknown) => String(memberId))
        : [String(where.memberId)];
      const rows: Record<string, Array<{ memberId?: string; playerId: string }>> = {
        'member-1': [
          { memberId: 'member-1', playerId: 'ply_a' },
          { memberId: 'member-1', playerId: 'ply_b' },
        ],
        'member-2': [
          { memberId: 'member-2', playerId: 'ply_c' },
          { memberId: 'member-2', playerId: 'ply_d' },
        ],
        'member-3': [
          { memberId: 'member-3', playerId: 'ply_e' },
          { memberId: 'member-3', playerId: 'ply_f' },
        ],
        'member-4': [
          { memberId: 'member-4', playerId: 'ply_g' },
          { memberId: 'member-4', playerId: 'ply_h' },
        ],
      };
      return memberIds.flatMap((memberId: string) => rows[memberId] ?? []);
    });
    prismaMock.player.findMany.mockResolvedValue([
      { id: 'ply_a', name: 'Player A', club: 'AAA', position: 'MID' },
      { id: 'ply_b', name: 'Player B', club: 'AAA', position: 'FWD' },
      { id: 'ply_c', name: 'Player C', club: 'BBB', position: 'MID' },
      { id: 'ply_d', name: 'Player D', club: 'BBB', position: 'DEF' },
      { id: 'ply_e', name: 'Player E', club: 'CCC', position: 'MID' },
      { id: 'ply_f', name: 'Player F', club: 'CCC', position: 'FWD' },
      { id: 'ply_g', name: 'Player G', club: 'DDD', position: 'MID' },
      { id: 'ply_h', name: 'Player H', club: 'DDD', position: 'DEF' },
    ]);

    firestoreCollectionMock.mockImplementation((collectionName: string) =>
      createQuery({ collectionName, filters: [] })
    );

    firestoreGetMock.mockImplementation(function (this: any) {
      const filters = this.where.mock.calls.map(([field, , value]: [string, string, unknown]) => ({
        field,
        value,
      }));
      const season = filters.find(
        (entry: { field: string; value: unknown }) => entry.field === 'season'
      )?.value;
      const collectionName = this.collectionName;

      if (
        collectionName === 'matchups' &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'leagueId')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'matchup-1',
              data: () => ({
                id: 'matchup-1',
                participants: ['user-1', 'user-2'],
                homeUserId: 'user-1',
                awayUserId: 'user-2',
                current: true,
                roundLabel: 'Round 1',
                aflRound: 1,
                status: 'in_progress',
              }),
            },
            {
              id: 'matchup-2',
              data: () => ({
                id: 'matchup-2',
                participants: ['user-3', 'user-4'],
                homeUserId: 'user-3',
                awayUserId: 'user-4',
                current: true,
                roundLabel: 'Round 1',
                aflRound: 1,
                status: 'final',
              }),
            },
          ],
        });
      }

      if (
        collectionName === 'matches' &&
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [{ data: () => ({ season: 2026, round_number: 1, status: 'in_progress' }) }],
        });
      }

      if (
        collectionName === 'player_match_stats' &&
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 's1',
              data: () => ({
                player_id: 'ext_ply_a',
                player_name: 'Player A',
                team: 'AAA',
                stats: { goals: 2, tackles: 3, inside50s: 4 },
                updated_at: '2026-03-14T00:10:00.000Z',
              }),
            },
            {
              id: 's2',
              data: () => ({
                player_id: 'ext_ply_b',
                player_name: 'Player B',
                team: 'AAA',
                stats: { goals: 1, tackles: 5, inside50s: 2 },
                updated_at: '2026-03-14T00:11:00.000Z',
              }),
            },
            {
              id: 's4',
              data: () => ({
                player_id: 'ext_ply_c',
                player_name: 'Player C',
                team: 'BBB',
                stats: { goals: 3, tackles: 2, inside50s: 4 },
                updated_at: '2026-03-14T00:09:00.000Z',
              }),
            },
            {
              id: 's5',
              data: () => ({
                player_id: 'ext_ply_d',
                player_name: 'Player D',
                team: 'BBB',
                stats: { goals: 0, tackles: 6, inside50s: 1 },
                updated_at: '2026-03-14T00:08:00.000Z',
              }),
            },
            {
              id: 's6',
              data: () => ({
                player_id: 'ext_ply_e',
                player_name: 'Player E',
                team: 'CCC',
                stats: { goals: 1, tackles: 4, inside50s: 1 },
                updated_at: '2026-03-14T00:07:00.000Z',
              }),
            },
            {
              id: 's7',
              data: () => ({
                player_id: 'ext_ply_f',
                player_name: 'Player F',
                team: 'CCC',
                stats: { goals: 1, tackles: 1, inside50s: 2 },
                updated_at: '2026-03-14T00:06:00.000Z',
              }),
            },
            {
              id: 's8',
              data: () => ({
                player_id: 'ext_ply_g',
                player_name: 'Player G',
                team: 'DDD',
                stats: { goals: 0, tackles: 2, inside50s: 5 },
                updated_at: '2026-03-14T00:05:00.000Z',
              }),
            },
            {
              id: 's9',
              data: () => ({
                player_id: 'ext_ply_h',
                player_name: 'Player H',
                team: 'DDD',
                stats: { goals: 1, tackles: 0, inside50s: 1 },
                updated_at: '2026-03-14T00:04:00.000Z',
              }),
            },
          ],
        });
      }
      return Promise.resolve({ empty: true, docs: [] });
    });
  });

  it('returns a live category matchup for the authenticated league member', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/leagues/league-1/matchup?categories=goals,tackles,inside50s'
      ),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ensureLeagueSeasonMaterializedMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(body.success).toBe(true);
    expect(body.data.live).toBe(true);
    expect(body.data.status).toBe('in_progress');
    expect(body.data.lastUpdated).toBe('2026-03-14T00:11:00.000Z');
    expect(body.data.round).toBe(1);
    expect(body.data.roundLabel).toBe('Round 1');
    expect(body.data.home.teamName).toBe('My Team');
    expect(body.data.away.teamName).toBe('Opponent Team');
    expect(body.data.home.summary).toEqual({ wins: 1, losses: 0, ties: 2 });
    expect(body.data.categories).toEqual([
      { key: 'goals', label: 'Goals', home: 3, away: 3, winner: 'tie' },
      { key: 'tackles', label: 'Tackles', home: 8, away: 8, winner: 'tie' },
      { key: 'inside50s', label: 'Inside 50s', home: 6, away: 5, winner: 'home' },
    ]);
    expect(body.data.otherMatchups).toEqual([
      {
        matchupId: 'matchup-2',
        homeTeamName: 'Third Team',
        awayTeamName: 'Fourth Team',
        homeScore: 2,
        awayScore: 1,
        leaderText: 'Third Team leads 2-1',
        isSelected: false,
      },
    ]);
    expect(redisSetMock).toHaveBeenCalledWith(
      expect.stringContaining('league-matchup:league-1:2026:1'),
      expect.any(String),
      15
    );
  });

  it('returns a cached matchup slate without recomputing rosters and players', async () => {
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        leagueId: 'league-1',
        leagueName: 'Example League',
        season: 2026,
        round: 1,
        roundLabel: 'Round 1',
        status: 'in_progress',
        live: true,
        lastUpdated: '2026-03-14T00:11:00.000Z',
        matchups: [
          {
            matchupId: 'matchup-1',
            home: {
              userId: 'user-1',
              memberId: 'member-1',
              teamName: 'My Team',
              starters: [
                {
                  id: 'ply_a',
                  name: 'Player A',
                  team: 'AAA',
                  position: 'MID',
                  stats: { goals: 2 },
                },
              ],
              summary: { wins: 2, losses: 1, ties: 0 },
            },
            away: {
              userId: 'user-2',
              memberId: 'member-2',
              teamName: 'Opponent Team',
              starters: [
                {
                  id: 'ply_c',
                  name: 'Player C',
                  team: 'BBB',
                  position: 'MID',
                  stats: { goals: 1 },
                },
              ],
              summary: { wins: 1, losses: 2, ties: 0 },
            },
            categories: [{ key: 'goals', label: 'Goals', home: 2, away: 1, winner: 'home' }],
          },
          {
            matchupId: 'matchup-2',
            home: {
              userId: 'user-3',
              memberId: 'member-3',
              teamName: 'Third Team',
              starters: [],
              summary: { wins: 0, losses: 1, ties: 0 },
            },
            away: {
              userId: 'user-4',
              memberId: 'member-4',
              teamName: 'Fourth Team',
              starters: [],
              summary: { wins: 1, losses: 0, ties: 0 },
            },
            categories: [{ key: 'goals', label: 'Goals', home: 0, away: 1, winner: 'away' }],
          },
        ],
      })
    );

    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/matchup?categories=goals'),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.home.teamName).toBe('My Team');
    expect(body.data.away.teamName).toBe('Opponent Team');
    expect(body.data.categories).toEqual([
      { key: 'goals', label: 'Goals', home: 2, away: 1, winner: 'home' },
    ]);
    expect(body.data.otherMatchups).toEqual([
      {
        matchupId: 'matchup-2',
        homeTeamName: 'Third Team',
        awayTeamName: 'Fourth Team',
        homeScore: 0,
        awayScore: 1,
        leaderText: 'Fourth Team leads 1-0',
        isSelected: false,
      },
    ]);
    expect(prismaMock.leagueRosterPlayer.findMany).not.toHaveBeenCalled();
    expect(prismaMock.player.findMany).not.toHaveBeenCalled();
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  it('allows viewing another current league matchup by matchupId', async () => {
    firestoreGetMock.mockImplementation(function (this: any) {
      const filters = this.where.mock.calls.map(([field, , value]: [string, string, unknown]) => ({
        field,
        value,
      }));
      const season = filters.find(
        (entry: { field: string; value: unknown }) => entry.field === 'season'
      )?.value;

      if (filters.some((entry: { field: string; value: unknown }) => entry.field === 'leagueId')) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'matchup-1',
              data: () => ({
                id: 'matchup-1',
                leagueId: 'league-1',
                participants: ['user-1', 'user-2'],
                homeUserId: 'user-1',
                awayUserId: 'user-2',
                current: true,
                roundLabel: 'Round 1',
                aflRound: 1,
                status: 'in_progress',
              }),
            },
            {
              id: 'matchup-2',
              data: () => ({
                id: 'matchup-2',
                leagueId: 'league-1',
                participants: ['user-3', 'user-4'],
                homeUserId: 'user-3',
                awayUserId: 'user-4',
                current: true,
                roundLabel: 'Round 1',
                aflRound: 1,
                status: 'final',
              }),
            },
          ],
        });
      }

      if (
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 's1',
              data: () => ({
                player_id: 'ext_ply_a',
                player_name: 'Player A',
                team: 'AAA',
                stats: { goals: 2, tackles: 3, inside50s: 4 },
                updated_at: '2026-03-14T00:10:00.000Z',
              }),
            },
            {
              id: 's2',
              data: () => ({
                player_id: 'ext_ply_b',
                player_name: 'Player B',
                team: 'AAA',
                stats: { goals: 1, tackles: 5, inside50s: 2 },
                updated_at: '2026-03-14T00:11:00.000Z',
              }),
            },
            {
              id: 's4',
              data: () => ({
                player_id: 'ext_ply_c',
                player_name: 'Player C',
                team: 'BBB',
                stats: { goals: 3, tackles: 2, inside50s: 4 },
                updated_at: '2026-03-14T00:09:00.000Z',
              }),
            },
            {
              id: 's5',
              data: () => ({
                player_id: 'ext_ply_d',
                player_name: 'Player D',
                team: 'BBB',
                stats: { goals: 0, tackles: 6, inside50s: 1 },
                updated_at: '2026-03-14T00:08:00.000Z',
              }),
            },
            {
              id: 's6',
              data: () => ({
                player_id: 'ext_ply_e',
                player_name: 'Player E',
                team: 'CCC',
                stats: { goals: 1, tackles: 4, inside50s: 1 },
                updated_at: '2026-03-14T00:07:00.000Z',
              }),
            },
            {
              id: 's7',
              data: () => ({
                player_id: 'ext_ply_f',
                player_name: 'Player F',
                team: 'CCC',
                stats: { goals: 1, tackles: 1, inside50s: 2 },
                updated_at: '2026-03-14T00:06:00.000Z',
              }),
            },
            {
              id: 's8',
              data: () => ({
                player_id: 'ext_ply_g',
                player_name: 'Player G',
                team: 'DDD',
                stats: { goals: 0, tackles: 2, inside50s: 5 },
                updated_at: '2026-03-14T00:05:00.000Z',
              }),
            },
            {
              id: 's9',
              data: () => ({
                player_id: 'ext_ply_h',
                player_name: 'Player H',
                team: 'DDD',
                stats: { goals: 1, tackles: 0, inside50s: 1 },
                updated_at: '2026-03-14T00:04:00.000Z',
              }),
            },
          ],
        });
      }

      return Promise.resolve({ empty: true, docs: [] });
    });

    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/leagues/league-1/matchup?categories=goals,tackles,inside50s&matchupId=matchup-2'
      ),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.matchupId).toBe('matchup-2');
    expect(body.data.home.teamName).toBe('Third Team');
    expect(body.data.away.teamName).toBe('Fourth Team');
    expect(body.data.categories).toEqual([
      { key: 'goals', label: 'Goals', home: 2, away: 1, winner: 'home' },
      { key: 'tackles', label: 'Tackles', home: 5, away: 2, winner: 'home' },
      { key: 'inside50s', label: 'Inside 50s', home: 3, away: 6, winner: 'away' },
    ]);
    expect(body.data.otherMatchups).toEqual([
      {
        matchupId: 'matchup-1',
        homeTeamName: 'My Team',
        awayTeamName: 'Opponent Team',
        homeScore: 1,
        awayScore: 0,
        leaderText: 'My Team leads 1-0',
        isSelected: false,
      },
    ]);
  });

  it('returns a historical round matchup when a round is requested explicitly', async () => {
    firestoreGetMock.mockImplementation(function (this: any) {
      const filters = this.where.mock.calls.map(([field, , value]: [string, string, unknown]) => ({
        field,
        value,
      }));
      const season = filters.find(
        (entry: { field: string; value: unknown }) => entry.field === 'season'
      )?.value;
      const collectionName = this.collectionName;

      if (
        collectionName === 'matchups' &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'leagueId')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'matchup-r1',
              data: () => ({
                id: 'matchup-r1',
                participants: ['user-1', 'user-2'],
                homeUserId: 'user-1',
                awayUserId: 'user-2',
                current: false,
                roundLabel: 'Round 1',
                aflRound: 1,
                status: 'final',
              }),
            },
            {
              id: 'matchup-r2',
              data: () => ({
                id: 'matchup-r2',
                participants: ['user-1', 'user-2'],
                homeUserId: 'user-1',
                awayUserId: 'user-2',
                current: true,
                roundLabel: 'Round 2',
                aflRound: 2,
                status: 'in_progress',
              }),
            },
          ],
        });
      }

      if (
        collectionName === 'matches' &&
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        const roundNumber = filters.find(
          (entry: { field: string; value: unknown }) => entry.field === 'round_number'
        )?.value;
        if (roundNumber === 1) {
          return Promise.resolve({
            empty: false,
            docs: [{ data: () => ({ season: 2026, round_number: 1, status: 'final' }) }],
          });
        }

        return Promise.resolve({
          empty: false,
          docs: [{ data: () => ({ season: 2026, round_number: 2, status: 'in_progress' }) }],
        });
      }

      if (
        collectionName === 'player_match_stats' &&
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 's1',
              data: () => ({
                player_id: 'ext_ply_a',
                player_name: 'Player A',
                team: 'AAA',
                stats: { goals: 2, tackles: 3, inside50s: 4 },
                updated_at: '2026-03-14T00:10:00.000Z',
              }),
            },
            {
              id: 's2',
              data: () => ({
                player_id: 'ext_ply_b',
                player_name: 'Player B',
                team: 'AAA',
                stats: { goals: 1, tackles: 5, inside50s: 2 },
                updated_at: '2026-03-14T00:11:00.000Z',
              }),
            },
            {
              id: 's3',
              data: () => ({
                player_id: 'ext_ply_c',
                player_name: 'Player C',
                team: 'BBB',
                stats: { goals: 3, tackles: 2, inside50s: 4 },
                updated_at: '2026-03-14T00:09:00.000Z',
              }),
            },
            {
              id: 's4',
              data: () => ({
                player_id: 'ext_ply_d',
                player_name: 'Player D',
                team: 'BBB',
                stats: { goals: 0, tackles: 6, inside50s: 1 },
                updated_at: '2026-03-14T00:08:00.000Z',
              }),
            },
          ],
        });
      }

      return Promise.resolve({ empty: true, docs: [] });
    });

    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/leagues/league-1/matchup?categories=goals,tackles,inside50s&round=1'
      ),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.round).toBe(1);
    expect(body.data.roundLabel).toBe('Round 1');
    expect(body.data.status).toBe('final');
    expect(body.data.live).toBe(false);
    expect(body.data.home.teamName).toBe('My Team');
    expect(body.data.away.teamName).toBe('Opponent Team');
  });

  it('uses live round status from matches collection when matchup docs are stale', async () => {
    firestoreGetMock.mockImplementation(function (this: any) {
      const filters = this.where.mock.calls.map(([field, , value]: [string, string, unknown]) => ({
        field,
        value,
      }));
      const season = filters.find(
        (entry: { field: string; value: unknown }) => entry.field === 'season'
      )?.value;
      const collectionName = this.collectionName;

      if (
        collectionName === 'matchups' &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'leagueId')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'matchup-1',
              data: () => ({
                id: 'matchup-1',
                participants: ['user-1', 'user-2'],
                homeUserId: 'user-1',
                awayUserId: 'user-2',
                current: true,
                roundLabel: 'Round 1',
                aflRound: 1,
                status: 'final',
              }),
            },
          ],
        });
      }

      if (
        collectionName === 'matches' &&
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            { data: () => ({ season: 2026, round_number: 1, status: 'in_progress' }) },
            { data: () => ({ season: 2026, round_number: 1, status: 'scheduled' }) },
          ],
        });
      }

      if (
        collectionName === 'player_match_stats' &&
        season === 2026 &&
        filters.some((entry: { field: string; value: unknown }) => entry.field === 'round_number')
      ) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 's1',
              data: () => ({
                player_id: 'ext_ply_a',
                player_name: 'Player A',
                team: 'AAA',
                stats: { goals: 2, tackles: 3, inside50s: 4 },
                updated_at: '2026-03-14T00:10:00.000Z',
              }),
            },
          ],
        });
      }

      return Promise.resolve({ empty: true, docs: [] });
    });

    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/leagues/league-1/matchup?categories=goals,tackles,inside50s'
      ),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('in_progress');
    expect(body.data.live).toBe(true);
  });
});
