import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    league: { findUnique: vi.fn() },
    leagueRosterPlayer: { findMany: vi.fn() },
    leagueCompetitionRound: { findUnique: vi.fn(), findMany: vi.fn() },
    leagueMatchup: { findFirst: vi.fn() },
    leagueLineup: { findUnique: vi.fn(), upsert: vi.fn() },
    leagueLineupPlayer: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    player: { findMany: vi.fn() },
    playerExternalIdentity: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { getRoundMatchesResult: vi.fn(), prisma };
});

vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatchesResult: mocks.getRoundMatchesResult,
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

import {
  createSetupLineupRoundContext,
  loadLineupRoundSummaries,
  loadMemberLineupRoundContext,
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
  competitionRulesJson: { lockPolicy: 'INDIVIDUAL_GAME_START' },
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
  mocks.prisma.player.findMany.mockResolvedValue([{ id: 'player-1' }]);
  mocks.prisma.playerExternalIdentity.findMany.mockResolvedValue([]);
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
  it.each([
    {
      label: 'a Perth league in Sydney standard time',
      timeZone: 'Australia/Perth',
      roundStartsAt: '2026-07-18T09:00:00.000Z',
      expectedLockAt: '2026-07-16T09:00:00.000Z',
    },
    {
      label: 'a UTC league in Sydney standard time',
      timeZone: 'UTC',
      roundStartsAt: '2026-07-18T09:00:00.000Z',
      expectedLockAt: '2026-07-16T09:00:00.000Z',
    },
    {
      label: 'a Sydney league in Sydney standard time',
      timeZone: 'Australia/Sydney',
      roundStartsAt: '2026-07-18T09:00:00.000Z',
      expectedLockAt: '2026-07-16T09:00:00.000Z',
    },
    {
      label: 'a Sydney league in Sydney daylight time',
      timeZone: 'Australia/Sydney',
      roundStartsAt: '2026-12-19T08:00:00.000Z',
      expectedLockAt: '2026-12-17T08:00:00.000Z',
    },
  ])(
    'locks at Thursday 7:00 pm Sydney time for $label',
    async ({ timeZone, roundStartsAt, expectedLockAt }) => {
      mocks.prisma.league.findUnique.mockResolvedValue({
        settings: {
          ...settings,
          timeZone,
          competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
        },
      });
      mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
        ...scheduledRound,
        startsAt: new Date(roundStartsAt),
      });
      mocks.prisma.leagueMatchup.findFirst.mockResolvedValue(null);

      const context = await loadMemberLineupRoundContext({
        leagueId: 'league-1',
        memberId: 'member-1',
        round: 1,
        now: new Date('2026-01-01T00:00:00.000Z'),
      });

      expect(context?.lockAt?.toISOString()).toBe(expectedLockAt);
      expect(context?.lockState).toBe('OPEN');
    }
  );

  it('ignores the retired competition-rules timezone that older rule rows still carry', async () => {
    mocks.prisma.league.findUnique.mockResolvedValue({
      settings: {
        ...settings,
        timeZone: 'Australia/Perth',
        competitionRulesJson: {
          lockPolicy: 'THURSDAY_7PM_AEST',
          leagueTimeZone: 'America/New_York',
        },
      },
    });
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2026-07-18T09:00:00.000Z'),
    });
    mocks.prisma.leagueMatchup.findFirst.mockResolvedValue(null);

    const context = await loadMemberLineupRoundContext({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(context?.lockAt?.toISOString()).toBe('2026-07-16T09:00:00.000Z');
  });

  it('locks a Monday to Wednesday round at its own start, not the previous Thursday', async () => {
    mocks.prisma.league.findUnique.mockResolvedValue({
      settings: {
        ...settings,
        timeZone: 'Australia/Sydney',
        competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
      },
    });
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2026-04-22T09:30:00.000Z'),
    });
    mocks.prisma.leagueMatchup.findFirst.mockResolvedValue(null);

    const context = await loadMemberLineupRoundContext({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      now: new Date('2026-04-01T00:00:00.000Z'),
    });

    expect(context?.lockAt?.toISOString()).toBe('2026-04-22T09:30:00.000Z');
  });

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

  it('resolves a retired player alias before saving a lineup', async () => {
    const thursdaySettings = {
      ...settings,
      competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
    };
    mocks.prisma.playerExternalIdentity.findMany.mockResolvedValue([
      { externalId: 'retired-player-1', playerId: 'player-1' },
    ]);
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
      players: [{ playerId: 'retired-player-1', slot: 'MID', slotIndex: 1 }],
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.prisma.leagueLineupPlayer.createMany).toHaveBeenCalledWith({
      data: [
        {
          lineupId: 'lineup-1',
          playerId: 'player-1',
          slot: 'MID',
          slotIndex: 1,
        },
      ],
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
  it.each(['NO_MATCHUP', 'LOCKED', 'FINAL'])(
    'rejects an initially %s competition round',
    async (status) => {
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
    }
  );

  it.each(['NO_MATCHUP', 'LOCKED', 'FINAL'])(
    'rejects when the round becomes %s at the transactional save boundary',
    async (status) => {
      mocks.prisma.league.findUnique
        .mockResolvedValueOnce({ settings })
        .mockResolvedValueOnce({ settings });
      mocks.prisma.leagueRosterPlayer.findMany
        .mockResolvedValueOnce([rosterPlayer()])
        .mockResolvedValueOnce([rosterPlayer()]);
      mocks.prisma.leagueCompetitionRound.findUnique
        .mockResolvedValueOnce(scheduledRound)
        .mockResolvedValueOnce({ ...scheduledRound, status });
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
    }
  );

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
  ])('rejects a %s slot index instead of coercing it to zero', async (_label, slotIndex) => {
    const thursdaySettings = {
      ...settings,
      competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
    };
    mocks.prisma.league.findUnique.mockResolvedValue({ settings: thursdaySettings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2027-07-18T09:00:00.000Z'),
    });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [{ playerId: 'player-1', slot: 'MID', slotIndex }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_LINEUP',
      errors: ['Slot index for player-1 must be a non-negative integer.'],
    });
    expect(mocks.prisma.leagueLineup.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.leagueLineupPlayer.createMany).not.toHaveBeenCalled();
  });

  it('keeps an empty legacy BENCH slot index invalid during normalization', async () => {
    const thursdaySettings = {
      ...settings,
      competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
    };
    mocks.prisma.league.findUnique.mockResolvedValue({ settings: thursdaySettings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2027-07-18T09:00:00.000Z'),
    });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [{ playerId: 'player-1', slot: 'BENCH', slotIndex: '' }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_LINEUP',
      errors: ['Slot index for player-1 must be a non-negative integer.'],
    });
    expect(mocks.prisma.leagueLineup.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['number', 1],
    ['numeric string', '1'],
  ])('preserves a valid %s slot index', async (_label, slotIndex) => {
    const thursdaySettings = {
      ...settings,
      competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
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
      players: [{ playerId: 'player-1', slot: 'MID', slotIndex }],
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.prisma.leagueLineupPlayer.createMany).toHaveBeenCalledWith({
      data: [
        {
          lineupId: 'lineup-1',
          playerId: 'player-1',
          slot: 'MID',
          slotIndex: 1,
        },
      ],
    });
  });

  it('fails explicitly before mutation when official timing is unavailable mid-round', async () => {
    mocks.prisma.league.findUnique.mockResolvedValue({ settings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2026-01-01T09:00:00.000Z'),
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
      competitionRulesJson: { lockPolicy: 'THURSDAY_7PM_AEST' },
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

  it('saves before the round starts even when official timing is unavailable', async () => {
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
    mocks.prisma.leagueLineup.findUnique.mockResolvedValue(null);
    mocks.prisma.leagueLineup.upsert.mockResolvedValue({ id: 'lineup-1' });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({ ok: true });
  });
});

describe('players whose AFL game start is unknown', () => {
  const startedRound = { ...scheduledRound, startsAt: new Date('2026-01-01T09:00:00.000Z') };
  const futureGwsGame = {
    season: 2026,
    round_number: 17,
    home_team: 'GWS Giants',
    away_team: 'Sydney Swans',
    start_time_utc: '2099-07-18T09:00:00.000Z',
    status: 'scheduled',
    confirmed_bye_teams: ['Carlton'],
  };

  function arrangeStartedRound(existingPlayers: Array<Record<string, unknown>>) {
    mocks.prisma.player.findMany.mockResolvedValue([
      { id: 'player-1' },
      { id: 'unmatched-player' },
      { id: 'bye-player' },
    ]);
    mocks.prisma.league.findUnique.mockResolvedValue({ settings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([
      rosterPlayer('player-1', 'GWS'),
      rosterPlayer('unmatched-player', 'Unknown Club'),
      rosterPlayer('bye-player', 'Carlton'),
    ]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue(startedRound);
    mocks.getRoundMatchesResult.mockResolvedValue({ ok: true, matches: [futureGwsGame] });
    mocks.prisma.leagueLineup.findUnique.mockResolvedValue({
      id: 'lineup-1',
      players: existingPlayers,
    });
    mocks.prisma.leagueLineup.upsert.mockResolvedValue({ id: 'lineup-1' });
  }

  it('keeps an unmatched player in place once the round has started', async () => {
    arrangeStartedRound([
      { id: 'row-1', playerId: 'unmatched-player', slot: 'MID', slotIndex: 0, lockedAt: null },
    ]);

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_LINEUP',
      errors: ['Player unmatched-player is locked and must remain in place.'],
    });
    expect(mocks.prisma.leagueLineupPlayer.deleteMany).not.toHaveBeenCalled();
    // No lock time is invented for him: nothing is written to his row.
    expect(mocks.prisma.leagueLineupPlayer.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to bring an unmatched player into the lineup once the round has started', async () => {
    arrangeStartedRound([]);

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [{ playerId: 'unmatched-player', slot: 'MID', slotIndex: 0 }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_LINEUP',
      errors: [
        'Player unmatched-player is locked: his AFL game start time is not known and the round has started.',
      ],
    });
    expect(mocks.prisma.leagueLineupPlayer.createMany).not.toHaveBeenCalled();
  });

  it('still lets a manager move a player on a confirmed bye or with a later game', async () => {
    arrangeStartedRound([
      { id: 'row-1', playerId: 'bye-player', slot: 'MID', slotIndex: 0, lockedAt: null },
    ]);

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [{ playerId: 'player-1', slot: 'MID', slotIndex: 0 }],
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.prisma.leagueLineupPlayer.createMany).toHaveBeenCalledWith({
      data: [{ lineupId: 'lineup-1', playerId: 'player-1', slot: 'MID', slotIndex: 0 }],
    });
  });

  it('lets a manager move an unmatched player before the round starts', async () => {
    arrangeStartedRound([
      { id: 'row-1', playerId: 'unmatched-player', slot: 'MID', slotIndex: 0, lockedAt: null },
    ]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: new Date('2099-07-18T09:00:00.000Z'),
    });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({ ok: true });
  });

  it('treats the round as started once its first official game has started', async () => {
    arrangeStartedRound([
      { id: 'row-1', playerId: 'unmatched-player', slot: 'MID', slotIndex: 0, lockedAt: null },
    ]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue({
      ...scheduledRound,
      startsAt: null,
    });
    mocks.getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [{ ...futureGwsGame, start_time_utc: '2026-01-01T09:00:00.000Z' }],
    });

    const result = await saveMemberLineup({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
      players: [],
    });

    expect(result).toMatchObject({
      ok: false,
      errors: ['Player unmatched-player is locked and must remain in place.'],
    });
  });
});

describe('lineup timing follows the league season, not the calendar year', () => {
  const seasonRound = {
    ...scheduledRound,
    round: 1,
    phase: 'REGULAR',
    endsAt: null,
    startsAt: new Date('2099-07-18T09:00:00.000Z'),
    season: { year: 2025 },
  };

  it('reads AFL match times for the season the competition round belongs to', async () => {
    mocks.prisma.league.findUnique.mockResolvedValue({ settings });
    mocks.prisma.leagueRosterPlayer.findMany.mockResolvedValue([rosterPlayer()]);
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue(seasonRound);
    mocks.getRoundMatchesResult.mockResolvedValue({ ok: true, matches: [] });
    mocks.prisma.leagueLineup.findUnique.mockResolvedValue(null);
    mocks.prisma.leagueLineup.upsert.mockResolvedValue({ id: 'lineup-1' });

    await saveMemberLineup({ leagueId: 'league-1', memberId: 'member-1', round: 1, players: [] });

    expect(mocks.getRoundMatchesResult).toHaveBeenCalledWith(2025, 17);
  });

  it('reports the season year with the round context and round summaries', async () => {
    mocks.prisma.league.findUnique.mockResolvedValue({ settings });
    mocks.prisma.leagueCompetitionRound.findUnique.mockResolvedValue(seasonRound);
    mocks.prisma.leagueCompetitionRound.findMany.mockResolvedValue([seasonRound]);
    mocks.prisma.leagueMatchup.findFirst.mockResolvedValue(null);

    const context = await loadMemberLineupRoundContext({
      leagueId: 'league-1',
      memberId: 'member-1',
      round: 1,
    });
    const summaries = await loadLineupRoundSummaries('league-1');

    expect(context?.seasonYear).toBe(2025);
    expect(summaries[0]?.seasonYear).toBe(2025);
  });

  it('has no season year while the league is still in setup', () => {
    expect(createSetupLineupRoundContext(1).seasonYear).toBeNull();
  });
});
