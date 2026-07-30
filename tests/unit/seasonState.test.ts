import { describe, expect, it, vi } from 'vitest';

import { getAuthorizedLeagueSeasonState } from '@/server/leagues/seasonState';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(),
  isLeagueManagerRole: vi.fn(),
}));

function buildLeague(overrides: Record<string, unknown> = {}) {
  return {
    id: 'league-1',
    activeSeason: {
      id: 'season-1',
      label: '2026 Season',
      year: 2026,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T23:59:59.999Z'),
    },
    settings: {
      competitionStatus: 'SETUP',
      competitionRulesVersion: 0,
    },
    members: [{ isActive: true, status: 'ACTIVE' }],
    ...overrides,
  };
}

function buildClient(input: { league?: unknown; rounds?: unknown[] }) {
  return {
    league: {
      findUnique: vi.fn().mockResolvedValue(input.league),
    },
    leagueCompetitionRound: {
      findMany: vi.fn().mockResolvedValue(input.rounds ?? []),
    },
  };
}

describe('getAuthorizedLeagueSeasonState', () => {
  it('returns an honest empty setup state for a newly created league', async () => {
    const client = buildClient({ league: buildLeague(), rounds: [] });

    const result = await getAuthorizedLeagueSeasonState(
      { leagueId: 'league-1', userId: 'user-1', now: new Date('2026-07-29T00:00:00.000Z') },
      client as never
    );

    expect(result).toEqual({
      ok: true,
      data: {
        leagueId: 'league-1',
        season: {
          id: 'season-1',
          label: '2026 Season',
          year: 2026,
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-12-31T23:59:59.999Z',
        },
        competitionStatus: 'SETUP',
        fixtureVersion: 0,
        schedule: [],
      },
    });
    expect(client.leagueCompetitionRound.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1', seasonId: 'season-1', fixtureVersion: 0 },
      })
    );
  });

  it('maps versioned rounds and marks only the active round as current', async () => {
    const client = buildClient({
      league: buildLeague({
        settings: { competitionStatus: 'ACTIVE', competitionRulesVersion: 3 },
      }),
      rounds: [
        {
          id: 'round-1',
          round: 1,
          aflRound: 5,
          phase: 'REGULAR',
          status: 'FINAL',
          startsAt: new Date('2026-04-01T00:00:00.000Z'),
          endsAt: new Date('2026-04-05T00:00:00.000Z'),
        },
        {
          id: 'round-2',
          round: 2,
          aflRound: 6,
          phase: 'REGULAR',
          status: 'LOCKED',
          startsAt: new Date('2026-04-08T00:00:00.000Z'),
          endsAt: new Date('2026-04-12T00:00:00.000Z'),
        },
        {
          id: 'round-3',
          round: 3,
          aflRound: 7,
          phase: 'FINALS',
          status: 'SCHEDULED',
          startsAt: new Date('2026-04-15T00:00:00.000Z'),
          endsAt: new Date('2026-04-19T00:00:00.000Z'),
        },
      ],
    });

    const result = await getAuthorizedLeagueSeasonState(
      { leagueId: 'league-1', userId: 'user-1', now: new Date('2026-04-10T00:00:00.000Z') },
      client as never
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fixtureVersion).toBe(3);
    expect(result.data.schedule).toMatchObject([
      { id: 'round-1', status: 'final', current: false, phase: 'regular' },
      { id: 'round-2', status: 'in_progress', current: true, phase: 'regular' },
      { id: 'round-3', status: 'scheduled', current: false, phase: 'finals' },
    ]);
  });

  it('keeps timing-pending rounds scheduled until their known window begins', async () => {
    const client = buildClient({
      league: buildLeague({
        settings: { competitionStatus: 'PUBLISHED', competitionRulesVersion: 1 },
      }),
      rounds: [
        {
          id: 'timing-pending',
          round: 1,
          aflRound: 1,
          phase: 'REGULAR',
          status: 'PENDING',
          startsAt: null,
          endsAt: null,
        },
        {
          id: 'timed-round',
          round: 2,
          aflRound: 2,
          phase: 'REGULAR',
          status: 'PENDING',
          startsAt: new Date('2026-04-08T00:00:00.000Z'),
          endsAt: new Date('2026-04-12T00:00:00.000Z'),
        },
      ],
    });

    const result = await getAuthorizedLeagueSeasonState(
      { leagueId: 'league-1', userId: 'user-1', now: new Date('2026-04-10T00:00:00.000Z') },
      client as never
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schedule).toMatchObject([
      { id: 'timing-pending', status: 'scheduled', current: false },
      { id: 'timed-round', status: 'in_progress', current: true },
    ]);
  });

  it('prefers the current time window over stale locked-round fallbacks', async () => {
    const client = buildClient({
      league: buildLeague({
        settings: { competitionStatus: 'ACTIVE', competitionRulesVersion: 4 },
      }),
      rounds: [
        {
          id: 'old-locked-round',
          round: 1,
          aflRound: 1,
          phase: 'REGULAR',
          status: 'LOCKED',
          startsAt: new Date('2026-03-01T00:00:00.000Z'),
          endsAt: new Date('2026-03-05T00:00:00.000Z'),
        },
        {
          id: 'current-timed-round',
          round: 2,
          aflRound: 2,
          phase: 'REGULAR',
          status: 'SCHEDULED',
          startsAt: new Date('2026-04-08T00:00:00.000Z'),
          endsAt: new Date('2026-04-12T00:00:00.000Z'),
        },
      ],
    });

    const result = await getAuthorizedLeagueSeasonState(
      { leagueId: 'league-1', userId: 'user-1', now: new Date('2026-04-10T00:00:00.000Z') },
      client as never
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schedule).toMatchObject([
      { id: 'old-locked-round', status: 'scheduled', current: false },
      { id: 'current-timed-round', status: 'in_progress', current: true },
    ]);
  });

  it('rejects inactive or missing memberships before querying rounds', async () => {
    const client = buildClient({
      league: buildLeague({ members: [{ isActive: false, status: 'REMOVED' }] }),
    });

    const result = await getAuthorizedLeagueSeasonState(
      { leagueId: 'league-1', userId: 'former-user' },
      client as never
    );

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(client.leagueCompetitionRound.findMany).not.toHaveBeenCalled();
  });

  it('distinguishes a missing league from forbidden membership', async () => {
    const client = buildClient({ league: null });

    await expect(
      getAuthorizedLeagueSeasonState(
        { leagueId: 'missing-league', userId: 'user-1' },
        client as never
      )
    ).resolves.toEqual({ ok: false, status: 404, error: 'League not found' });
  });
});
