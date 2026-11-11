import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  leagueSettings: { findFirst: vi.fn() },
  leagueCompetitionRound: { findMany: vi.fn() },
  player: { findMany: vi.fn() },
}));
const getRoundMatchesResult = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/etl/etlRoundData', () => ({ getRoundMatchesResult }));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerIds: vi.fn(),
}));

import {
  describeLockedPlayers,
  findFirstOpenRound,
  findPlayersLockedForMove,
  findRoundInProgress,
} from '@/server/leagues/playerMoveLock';

const NOW = new Date('2026-07-18T06:00:00.000Z');
const round = (
  number: number,
  startsAt: string | null,
  endsAt: string | null,
  status: 'SCHEDULED' | 'NO_MATCHUP' | 'PENDING' | 'LOCKED' | 'FINAL' = 'SCHEDULED'
) => ({
  round: number,
  aflRound: number,
  status,
  startsAt: startsAt ? new Date(startsAt) : null,
  endsAt: endsAt ? new Date(endsAt) : null,
  season: { year: 2026 },
});

const roundOne = round(1, '2026-07-09T09:00:00.000Z', '2026-07-12T09:00:00.000Z', 'FINAL');
const roundTwo = round(2, '2026-07-16T09:00:00.000Z', '2026-07-19T09:00:00.000Z');
const roundThree = round(3, '2026-07-23T09:00:00.000Z', '2026-07-26T09:00:00.000Z');

function match(home: string, away: string, start: string) {
  return { home_team: home, away_team: away, start_time_utc: start };
}

describe('round in progress', () => {
  it('is the started round that has not ended or been finalized', () => {
    expect(findRoundInProgress([roundOne, roundTwo, roundThree], NOW)?.round).toBe(2);
    expect(findRoundInProgress([roundOne, roundThree], NOW)).toBeNull();
    expect(
      findRoundInProgress([{ ...roundTwo, status: 'NO_MATCHUP' as const }, roundThree], NOW)
    ).toBeNull();
  });

  it('opens lineups from the round in progress, else the next round to start', () => {
    expect(findFirstOpenRound([roundOne, roundTwo, roundThree], NOW)).toBe(2);
    expect(findFirstOpenRound([roundOne, roundThree], NOW)).toBe(3);
    expect(findFirstOpenRound([roundOne], NOW)).toBeNull();
  });
});

describe('findPlayersLockedForMove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.leagueSettings.findFirst.mockResolvedValue({ competitionRulesVersion: 1 });
    prismaMocks.leagueCompetitionRound.findMany.mockResolvedValue([roundOne, roundTwo, roundThree]);
    prismaMocks.player.findMany.mockResolvedValue([
      { id: 'started', name: 'Started Player', club: 'Carlton' },
      { id: 'later', name: 'Later Player', club: 'Geelong' },
      { id: 'bye', name: 'Bye Player', club: 'Sydney' },
    ]);
    getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [
        match('Carlton', 'Collingwood', '2026-07-17T09:30:00.000Z'),
        match('Geelong', 'Hawthorn', '2026-07-19T04:00:00.000Z'),
        {
          ...match('Essendon', 'Richmond', '2026-07-18T03:00:00.000Z'),
          confirmed_bye_teams: ['Sydney'],
        },
      ],
    });
  });

  it("locks a player whose game in the round in progress has started, from the fixture's start time", async () => {
    const result = await findPlayersLockedForMove({
      leagueId: 'league-1',
      playerIds: ['started', 'later', 'bye'],
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      lockedPlayers: [{ playerId: 'started', name: 'Started Player' }],
    });
    expect(getRoundMatchesResult).toHaveBeenCalledWith(2026, 2);
    expect(prismaMocks.leagueCompetitionRound.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1', fixtureVersion: 1 } })
    );
  });

  it('locks nothing between rounds, without reading the fixture', async () => {
    prismaMocks.leagueCompetitionRound.findMany.mockResolvedValue([roundOne, roundThree]);

    await expect(
      findPlayersLockedForMove({ leagueId: 'league-1', playerIds: ['started'], now: NOW })
    ).resolves.toEqual({ ok: true, lockedPlayers: [] });
    expect(getRoundMatchesResult).not.toHaveBeenCalled();
  });

  it('locks nothing before the competition is published', async () => {
    prismaMocks.leagueSettings.findFirst.mockResolvedValue({ competitionRulesVersion: 0 });

    await expect(
      findPlayersLockedForMove({ leagueId: 'league-1', playerIds: ['started'], now: NOW })
    ).resolves.toEqual({ ok: true, lockedPlayers: [] });
    expect(prismaMocks.leagueCompetitionRound.findMany).not.toHaveBeenCalled();
  });

  it('holds a player whose game start is unknown once the round has started', async () => {
    prismaMocks.player.findMany.mockResolvedValue([
      { id: 'unknown', name: 'Unknown Club', club: 'Nowhere FC' },
    ]);

    await expect(
      findPlayersLockedForMove({ leagueId: 'league-1', playerIds: ['unknown'], now: NOW })
    ).resolves.toEqual({
      ok: true,
      lockedPlayers: [{ playerId: 'unknown', name: 'Unknown Club' }],
    });
  });

  it('fails closed when official match timing cannot be read during a round', async () => {
    getRoundMatchesResult.mockResolvedValue({ ok: false, error: new Error('firestore down') });

    await expect(
      findPlayersLockedForMove({ leagueId: 'league-1', playerIds: ['later'], now: NOW })
    ).resolves.toEqual({
      ok: false,
      error: 'Official AFL match timing is temporarily unavailable.',
    });
  });
});

describe('describeLockedPlayers', () => {
  it('names the players and says when they can move', () => {
    expect(describeLockedPlayers([{ playerId: 'a', name: 'Sam Walsh' }])).toBe(
      "Sam Walsh's game has started; he can be moved after the round ends."
    );
    expect(
      describeLockedPlayers([
        { playerId: 'a', name: 'Sam Walsh' },
        { playerId: 'b', name: 'Nick Daicos' },
      ])
    ).toBe(
      'Games have started for Sam Walsh and Nick Daicos; they can be moved after the round ends.'
    );
  });
});
