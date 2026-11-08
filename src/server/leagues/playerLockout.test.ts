import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadRoundPlayerGameStarts: vi.fn(),
  prisma: {
    leagueSettings: { findFirst: vi.fn() },
    leagueCompetitionRound: { findFirst: vi.fn() },
    player: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/server/leagues/lineupService', () => ({
  loadRoundPlayerGameStarts: mocks.loadRoundPlayerGameStarts,
}));

import { findLockedOutPlayers } from './playerLockout';

const NOW = new Date('2026-07-04T05:00:00.000Z');
const STARTED = new Date('2026-07-03T09:40:00.000Z');
const LATER = new Date('2026-07-05T03:10:00.000Z');

function timing(overrides: Partial<{ starts: Record<string, Date>; unknown: string[] }> = {}) {
  return {
    ok: true,
    gameStartsByPlayerId: new Map(Object.entries(overrides.starts ?? {})),
    timingStatus: 'AVAILABLE',
    startUnknownPlayerIds: new Set(overrides.unknown ?? []),
    firstGameStartsAt: STARTED,
  };
}

describe('findLockedOutPlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.leagueSettings.findFirst.mockResolvedValue({ competitionRulesVersion: 2 });
    mocks.prisma.leagueCompetitionRound.findFirst.mockResolvedValue({
      aflRound: 17,
      season: { year: 2026 },
    });
    mocks.prisma.player.findMany.mockResolvedValue([
      { id: 'played', club: 'Carlton' },
      { id: 'later', club: 'Sydney' },
      { id: 'unknown', club: 'Nowhere' },
    ]);
    mocks.loadRoundPlayerGameStarts.mockResolvedValue(
      timing({ starts: { played: STARTED, later: LATER }, unknown: ['unknown'] })
    );
  });

  it('locks players whose AFL game has started in the round in progress, and unknown starts', async () => {
    const result = await findLockedOutPlayers({
      leagueId: 'league-1',
      playerIds: ['played', 'later', 'unknown'],
      now: NOW,
    });

    expect(result).toEqual({ ok: true, lockedPlayerIds: new Set(['played', 'unknown']) });
    expect(mocks.prisma.leagueCompetitionRound.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          leagueId: 'league-1',
          fixtureVersion: 2,
          status: { notIn: ['NO_MATCHUP', 'FINAL'] },
          startsAt: { lte: NOW },
          OR: [{ endsAt: null }, { endsAt: { gt: NOW } }],
        },
      })
    );
    expect(mocks.loadRoundPlayerGameStarts).toHaveBeenCalledWith({
      aflRound: 17,
      season: 2026,
      players: [
        { playerId: 'played', club: 'Carlton' },
        { playerId: 'later', club: 'Sydney' },
        { playerId: 'unknown', club: 'Nowhere' },
      ],
    });
  });

  it('locks nobody between rounds', async () => {
    mocks.prisma.leagueCompetitionRound.findFirst.mockResolvedValue(null);

    await expect(
      findLockedOutPlayers({ leagueId: 'league-1', playerIds: ['played'], now: NOW })
    ).resolves.toEqual({ ok: true, lockedPlayerIds: new Set() });
    expect(mocks.loadRoundPlayerGameStarts).not.toHaveBeenCalled();
  });

  it('locks nobody before the league has published fixtures', async () => {
    mocks.prisma.leagueSettings.findFirst.mockResolvedValue({ competitionRulesVersion: 0 });

    await expect(
      findLockedOutPlayers({ leagueId: 'league-1', playerIds: ['played'], now: NOW })
    ).resolves.toEqual({ ok: true, lockedPlayerIds: new Set() });
  });

  it('fails closed when official AFL match timing cannot be read', async () => {
    mocks.loadRoundPlayerGameStarts.mockResolvedValue({ ok: false, error: 'down' });

    await expect(
      findLockedOutPlayers({ leagueId: 'league-1', playerIds: ['played'], now: NOW })
    ).resolves.toEqual({
      ok: false,
      code: 'LOCK_TIMING_UNAVAILABLE',
      reason:
        'Official AFL match times are unavailable right now, so drops and trades are paused. Try again soon.',
    });
  });
});
