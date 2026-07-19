import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMocks = vi.hoisted(() => ({
  logLeagueActivity: vi.fn().mockResolvedValue(undefined),
}));

const txMocks = vi.hoisted(() => ({
  leagueLineup: { findFirst: vi.fn() },
  leagueLineupPlayer: { findMany: vi.fn(), updateMany: vi.fn() },
  leagueLineupAutosub: { create: vi.fn() },
  leagueCompetitionAudit: { create: vi.fn() },
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn((work: (tx: typeof txMocks) => Promise<unknown>) => work(txMocks)),
}));

vi.mock('@/lib/activity', () => activityMocks);
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import { resolveAndPersistLineupAutosubs } from '@/server/leagues/lineupAutosubService';

describe('resolveAndPersistLineupAutosubs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.logLeagueActivity.mockResolvedValue(undefined);
    prismaMocks.$transaction.mockImplementation((work) => work(txMocks));
    txMocks.leagueLineup.findFirst.mockResolvedValue({ id: 'lineup-1' });
    txMocks.leagueLineupPlayer.findMany.mockResolvedValue([
      { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
      {
        id: 'assignment-2',
        playerId: 'interchange-1',
        slot: 'INTERCHANGE',
        slotIndex: 0,
      },
    ]);
    txMocks.leagueLineupPlayer.updateMany.mockResolvedValue({ count: 1 });
    txMocks.leagueLineupAutosub.create.mockResolvedValue({});
    txMocks.leagueCompetitionAudit.create.mockResolvedValue({});
  });

  it('swaps a confirmed non-player with the first scoring interchange player', async () => {
    const players = await resolveAndPersistLineupAutosubs({
      leagueId: 'league-1',
      lineupId: 'lineup-1',
      nonPlayingReasonByPlayerId: new Map([['active-1', 'DID_NOT_PLAY']]),
      players: [
        { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
      ],
    });

    expect(players).toEqual([
      { id: 'assignment-1', playerId: 'active-1', slot: 'INTERCHANGE', slotIndex: 0 },
      { id: 'assignment-2', playerId: 'interchange-1', slot: 'DEF', slotIndex: 0 },
    ]);
    expect(txMocks.leagueLineupAutosub.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lineupId: 'lineup-1',
        outgoingPlayerId: 'active-1',
        replacementPlayerId: 'interchange-1',
        reason: 'DID_NOT_PLAY',
      }),
    });
    expect(txMocks.leagueLineup.findFirst).toHaveBeenCalledWith({
      where: { id: 'lineup-1', leagueId: 'league-1' },
      select: { id: true },
    });
    expect(txMocks.leagueLineupPlayer.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'assignment-1',
        lineupId: 'lineup-1',
        playerId: 'active-1',
        slot: 'DEF',
        slotIndex: 0,
      },
      data: { slot: 'INTERCHANGE', slotIndex: 2 },
    });
    expect(txMocks.leagueLineupPlayer.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'assignment-2',
        lineupId: 'lineup-1',
        playerId: 'interchange-1',
        slot: 'INTERCHANGE',
        slotIndex: 0,
      },
      data: { slot: 'DEF', slotIndex: 0 },
    });
    expect(txMocks.leagueLineupPlayer.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        id: 'assignment-1',
        lineupId: 'lineup-1',
        playerId: 'active-1',
        slot: 'INTERCHANGE',
        slotIndex: 2,
      },
      data: { slot: 'INTERCHANGE', slotIndex: 0 },
    });
    expect(txMocks.leagueCompetitionAudit.create).toHaveBeenCalledOnce();
  });

  it('does not write when no active player is confirmed as a non-player', async () => {
    const input = [
      { id: 'assignment-1', playerId: 'active-1', slot: 'DEF' as const, slotIndex: 0 },
      {
        id: 'assignment-2',
        playerId: 'interchange-1',
        slot: 'INTERCHANGE' as const,
        slotIndex: 0,
      },
    ];

    await expect(
      resolveAndPersistLineupAutosubs({
        leagueId: 'league-1',
        lineupId: 'lineup-1',
        nonPlayingReasonByPlayerId: new Map(),
        players: input,
      })
    ).resolves.toEqual(input);
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });

  it('persists the club-bye reason from official fixture availability', async () => {
    await resolveAndPersistLineupAutosubs({
      leagueId: 'league-1',
      lineupId: 'lineup-1',
      nonPlayingReasonByPlayerId: new Map([['active-1', 'CLUB_BYE']]),
      players: [
        { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
      ],
    });

    expect(txMocks.leagueLineupAutosub.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outgoingPlayerId: 'active-1', reason: 'CLUB_BYE' }),
    });
  });

  it('rejects a lineup that does not belong to the requested league before any writes', async () => {
    txMocks.leagueLineup.findFirst.mockResolvedValue(null);

    await expect(
      resolveAndPersistLineupAutosubs({
        leagueId: 'league-1',
        lineupId: 'lineup-1',
        nonPlayingReasonByPlayerId: new Map([['active-1', 'DID_NOT_PLAY']]),
        players: [
          { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
          { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
        ],
      })
    ).rejects.toThrow('Autosub assignments changed before they could be persisted.');

    expect(txMocks.leagueLineupPlayer.findMany).not.toHaveBeenCalled();
    expect(txMocks.leagueLineupPlayer.updateMany).not.toHaveBeenCalled();
    expect(txMocks.leagueLineupAutosub.create).not.toHaveBeenCalled();
    expect(txMocks.leagueCompetitionAudit.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'outgoing lineup',
      [{ id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 }],
    ],
    [
      'outgoing player',
      [
        { id: 'assignment-1', playerId: 'other-player', slot: 'DEF', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
      ],
    ],
    [
      'outgoing slot',
      [
        { id: 'assignment-1', playerId: 'active-1', slot: 'FWD', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
      ],
    ],
    [
      'outgoing slot index',
      [
        { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 1 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
      ],
    ],
    [
      'replacement lineup',
      [{ id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 }],
    ],
    [
      'replacement player',
      [
        { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'other-player', slot: 'INTERCHANGE', slotIndex: 0 },
      ],
    ],
    [
      'replacement slot',
      [
        { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'UTILITY', slotIndex: 0 },
      ],
    ],
    [
      'replacement slot index',
      [
        { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
        { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 1 },
      ],
    ],
  ])('rejects stale or cross-lineup %s state before any writes', async (_case, persistedRows) => {
    txMocks.leagueLineupPlayer.findMany.mockResolvedValue(persistedRows);

    await expect(
      resolveAndPersistLineupAutosubs({
        leagueId: 'league-1',
        lineupId: 'lineup-1',
        nonPlayingReasonByPlayerId: new Map([['active-1', 'DID_NOT_PLAY']]),
        players: [
          { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
          { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
        ],
      })
    ).rejects.toThrow('Autosub assignments changed before they could be persisted.');

    expect(txMocks.leagueLineupPlayer.updateMany).not.toHaveBeenCalled();
    expect(txMocks.leagueLineupAutosub.create).not.toHaveBeenCalled();
    expect(txMocks.leagueCompetitionAudit.create).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])(
    'aborts before autosub and audit writes when guarded assignment update %i is stale',
    async (staleWriteNumber) => {
      txMocks.leagueLineupPlayer.updateMany.mockImplementation(async () => ({
        count: txMocks.leagueLineupPlayer.updateMany.mock.calls.length === staleWriteNumber ? 0 : 1,
      }));

      await expect(
        resolveAndPersistLineupAutosubs({
          leagueId: 'league-1',
          lineupId: 'lineup-1',
          nonPlayingReasonByPlayerId: new Map([['active-1', 'DID_NOT_PLAY']]),
          players: [
            { id: 'assignment-1', playerId: 'active-1', slot: 'DEF', slotIndex: 0 },
            { id: 'assignment-2', playerId: 'interchange-1', slot: 'INTERCHANGE', slotIndex: 0 },
          ],
        })
      ).rejects.toThrow('Autosub assignments changed before they could be persisted.');

      expect(txMocks.leagueLineupPlayer.updateMany).toHaveBeenCalledTimes(staleWriteNumber);
      expect(txMocks.leagueLineupAutosub.create).not.toHaveBeenCalled();
      expect(txMocks.leagueCompetitionAudit.create).not.toHaveBeenCalled();
    }
  );
});
