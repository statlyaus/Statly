import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    league: { findUnique: vi.fn() },
    leagueRosterPlayer: { findMany: vi.fn() },
    leagueCompetitionRound: { findUnique: vi.fn() },
    leagueLineup: { findUnique: vi.fn(), upsert: vi.fn() },
    leagueLineupPlayer: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { getRoundMatchesResult: vi.fn(), prisma };
});

vi.mock('@/lib/etlIntegration', () => ({
  getRoundMatchesResult: mocks.getRoundMatchesResult,
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

import {
  createSetupLineupRoundContext,
  loadRoundPlayerGameStarts,
  normalizeLegacyBenchAssignments,
  resolveRequestedLineupRound,
  saveMemberLineup,
  synchronizeLineupPlayerLocks,
  validateLineupSubmission,
} from './lineupService';
import { DEFAULT_ACTIVE_LINEUP_SLOTS } from './lineupSettings';

const settings = {
  competitionStatus: 'ACTIVE',
  competitionRulesVersion: 1,
  competitionRulesJson: JSON.stringify({ lockPolicy: 'INDIVIDUAL_GAME_START' }),
  lineupSlotsJson: null,
};

const scheduledRound = {
  aflRound: 17,
  status: 'SCHEDULED',
  lockedAt: null,
  fallbackLockAt: null,
  startsAt: new Date('2026-07-18T09:00:00.000Z'),
};

function rosterPlayer(playerId = 'player-1', club = 'GWS') {
  return {
    playerId,
    player: { id: playerId, club, name: 'Player One', position: 'MID' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) =>
    work(mocks.prisma)
  );
});

describe('lineup setup compatibility', () => {
  it('uses Round 1 while a setup league has no published competition', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'current',
        publishedCurrentRound: null,
      })
    ).toBe(1);
    expect(createSetupLineupRoundContext(1)).toMatchObject({
      source: 'SETUP_FALLBACK',
      round: 1,
      lockState: 'PUBLISHED_PENDING',
      opponent: null,
    });
  });

  it('keeps a published current round as the source of truth', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'current',
        publishedCurrentRound: 7,
      })
    ).toBe(7);
  });

  it('rejects invalid explicit rounds', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'invalid',
        publishedCurrentRound: null,
      })
    ).toBeNull();
  });

  it.each(['1x', '1.5', ' 1', '+1', '01', '9007199254740992', '0', '-1'])(
    'rejects non-canonical or unsafe explicit round %s',
    (requestedRound) => {
      expect(
        resolveRequestedLineupRound({ requestedRound, publishedCurrentRound: null })
      ).toBeNull();
    }
  );

  it('rejects an unsafe published current round', () => {
    expect(
      resolveRequestedLineupRound({
        requestedRound: 'current',
        publishedCurrentRound: Number.MAX_SAFE_INTEGER + 1,
      })
    ).toBeNull();
  });
});

describe('authoritative lineup timing', () => {
  it('maps official round match starts to players by canonical club aliases', async () => {
    mocks.getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [
        {
          season: 2026,
          round_number: 17,
          home_team: 'GWS Giants',
          away_team: 'Sydney Swans',
          start_time_utc: '2026-07-18T09:00:00.000Z',
          status: 'scheduled',
        },
      ],
    });

    const result = await loadRoundPlayerGameStarts({
      aflRound: 17,
      season: 2026,
      players: [
        { playerId: 'gws-player', club: 'GWS' },
        { playerId: 'sydney-player', club: 'Sydney' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timingStatus).toBe('AVAILABLE');
    expect(result.gameStartsByPlayerId.get('gws-player')?.toISOString()).toBe(
      '2026-07-18T09:00:00.000Z'
    );
    expect(result.gameStartsByPlayerId.get('sydney-player')?.toISOString()).toBe(
      '2026-07-18T09:00:00.000Z'
    );
  });

  it('distinguishes a successful pending round from a provider failure', async () => {
    mocks.getRoundMatchesResult.mockResolvedValueOnce({ ok: true, matches: [] });
    await expect(
      loadRoundPlayerGameStarts({
        aflRound: 17,
        season: 2026,
        players: [{ playerId: 'player-1', club: 'GWS' }],
      })
    ).resolves.toMatchObject({ ok: true, timingStatus: 'PUBLISHED_PENDING' });

    mocks.getRoundMatchesResult.mockResolvedValueOnce({
      ok: false,
      error: new Error('provider unavailable'),
    });
    await expect(
      loadRoundPlayerGameStarts({
        aflRound: 17,
        season: 2026,
        players: [{ playerId: 'player-1', club: 'GWS' }],
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Official AFL match timing is temporarily unavailable.',
    });
  });
});

describe('legacy lineup normalization and locks', () => {
  it('converts BENCH rows to collision-free INTERCHANGE slots without dropping overflow or locks', () => {
    const lockedAt = new Date('2026-07-18T09:00:00.000Z');
    const normalized = normalizeLegacyBenchAssignments([
      { id: 'existing', slot: 'INTERCHANGE', slotIndex: 0, lockedAt: null },
      { id: 'locked', slot: 'BENCH', slotIndex: 0, lockedAt },
      { id: 'overflow', slot: 'BENCH', slotIndex: 7, lockedAt: null },
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized).toEqual([
      { id: 'existing', slot: 'INTERCHANGE', slotIndex: 0, lockedAt: null },
      { id: 'locked', slot: 'INTERCHANGE', slotIndex: 1, lockedAt },
      { id: 'overflow', slot: 'INTERCHANGE', slotIndex: 7, lockedAt: null },
    ]);
  });

  it('allows an unchanged locked overflow assignment to remain in place', () => {
    const result = validateLineupSubmission({
      lineupSlots: DEFAULT_ACTIVE_LINEUP_SLOTS,
      rosterPlayers: [{ playerId: 'player-1', position: 'MID' }],
      existingLockedPlayers: [{ playerId: 'player-1', slot: 'INTERCHANGE', slotIndex: 7 }],
      submittedPlayers: [{ playerId: 'player-1', slot: 'INTERCHANGE', slotIndex: 7 }],
      interchangeSlots: 3,
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('persists newly discovered locks without overwriting known lock timestamps', async () => {
    const knownLockedAt = new Date('2026-07-17T09:00:00.000Z');
    const newLockedAt = new Date('2026-07-18T09:00:00.000Z');

    const locks = await synchronizeLineupPlayerLocks({
      now: new Date('2026-07-18T10:00:00.000Z'),
      players: [
        { id: 'known', playerId: 'known-player', lockedAt: knownLockedAt },
        { id: 'new', playerId: 'new-player', lockedAt: null },
      ],
      gameStartsByPlayerId: new Map([
        ['known-player', new Date('2026-07-18T08:00:00.000Z')],
        ['new-player', newLockedAt],
      ]),
    });

    expect(locks.get('known-player')).toEqual(knownLockedAt);
    expect(locks.get('new-player')).toEqual(newLockedAt);
    expect(mocks.prisma.leagueLineupPlayer.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.leagueLineupPlayer.updateMany).toHaveBeenCalledWith({
      where: { id: 'new', lockedAt: null },
      data: { lockedAt: newLockedAt },
    });
  });
});

describe('save boundary invariants', () => {
  it.each(['LOCKED', 'FINAL'])('rejects an initially %s competition round', async (status) => {
    mocks.prisma.league.findUnique.mockResolvedValue({ settings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      status,
    });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({ ok: false, errors: ['This round is locked.'] });
    expect(mocks.getRoundMatchesResult).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when the round becomes FINAL at the transactional save boundary', async () => {
    mocks.prisma.league.findUnique
      .mockResolvedValueOnce({ settings })
      .mockResolvedValueOnce({ settings });
    mocks.prisma.leagueRosterPlayer.findMany
      .mockResolvedValueOnce([rosterPlayer()])
      .mockResolvedValueOnce([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique
      .mockResolvedValueOnce(scheduledRound)
      .mockResolvedValueOnce({ ...scheduledRound, status: 'FINAL' });
    mocks.getRoundMatchesResult.mockResolvedValue({ ok: true, matches: [] });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({ ok: false, errors: ['This round is locked.'] });
    expect(mocks.prisma.leagueLineup.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.leagueLineupPlayer.deleteMany).not.toHaveBeenCalled();
  });

  it('fails explicitly before mutation when official timing cannot be loaded', async () => {
    mocks.prisma.league.findUnique.mockResolvedValue({ settings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2027-07-18T09:00:00.000Z'),
    });
    mocks.getRoundMatchesResult.mockResolvedValue({
      ok: false,
      error: new Error('provider unavailable'),
    });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({ ok: false, code: 'TIMING_UNAVAILABLE' });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.leagueLineupPlayer.deleteMany).not.toHaveBeenCalled();
  });

  it('does not require per-player fixture timing for a Thursday round lock', async () => {
    const thursdaySettings = {
      ...settings,
      competitionRulesJson: JSON.stringify({ lockPolicy: 'THURSDAY_7PM_AEST' }),
    };
    mocks.prisma.league.findUnique.mockResolvedValue({ settings: thursdaySettings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2027-07-18T09:00:00.000Z'),
    });
    mocks.prisma.leagueLineup.findUnique.mockResolvedValue(null);
    mocks.prisma.leagueLineup.upsert.mockResolvedValue({ id: 'lineup-1' });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.getRoundMatchesResult).not.toHaveBeenCalled();
  });
});
