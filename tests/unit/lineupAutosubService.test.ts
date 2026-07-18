import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMocks = vi.hoisted(() => ({
  logLeagueActivity: vi.fn().mockResolvedValue(undefined),
}));

const txMocks = vi.hoisted(() => ({
  leagueLineupPlayer: { update: vi.fn() },
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
    txMocks.leagueLineupPlayer.update.mockResolvedValue({});
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
});
