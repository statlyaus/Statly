import { beforeEach, describe, expect, it, vi } from 'vitest';

const lockMocks = vi.hoisted(() => ({
  findPlayersLockedForMove: vi.fn(),
  removePlayersFromOpenLineups: vi.fn(),
}));
const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/server/leagues/playerMoveLock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/leagues/playerMoveLock')>()),
  findPlayersLockedForMove: lockMocks.findPlayersLockedForMove,
  removePlayersFromOpenLineups: lockMocks.removePlayersFromOpenLineups,
}));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(),
}));

import {
  assertRosterPlayersMovable,
  refreshOwnershipProjection,
  swapRosterPlayers,
  type RosterSwapInput,
} from '@/server/leagues/rosterSwap';

const now = new Date('2026-11-11T00:00:00Z');

function makeTx(counts: { from: number; to: number }, conflicts: unknown[] = []) {
  return {
    leagueRosterPlayer: {
      updateMany: vi
        .fn()
        .mockResolvedValueOnce({ count: counts.from })
        .mockResolvedValueOnce({ count: counts.to }),
    },
    leagueTradeThread: {
      findMany: vi.fn().mockResolvedValue(conflicts),
      updateMany: vi.fn().mockResolvedValue({ count: conflicts.length }),
    },
    leagueTradeOffer: { updateMany: vi.fn().mockResolvedValue({ count: conflicts.length }) },
    leagueTradeEvent: { createMany: vi.fn().mockResolvedValue({ count: conflicts.length }) },
    leagueTradeOutboxEvent: { createMany: vi.fn().mockResolvedValue({ count: conflicts.length }) },
  };
}

const bite: RosterSwapInput = {
  leagueId: 'league-1',
  seasonId: 'season-1',
  fromMemberId: 'loser',
  toMemberId: 'bloodsucker',
  fromPlayerIds: ['player-taken'],
  toPlayerIds: ['player-given'],
  acquiredBy: 'BLOODSUCKER',
  invalidationReason: 'PLAYER_BITTEN',
  now,
};

describe('assertRosterPlayersMovable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a swap that includes a player whose game has started', async () => {
    lockMocks.findPlayersLockedForMove.mockResolvedValue({
      ok: true,
      lockedPlayers: [{ playerId: 'player-taken', name: 'Sam Locked' }],
    });

    await expect(
      assertRosterPlayersMovable({ leagueId: 'league-1', playerIds: ['player-taken'], now })
    ).rejects.toMatchObject({ code: 'PLAYER_LOCKED', status: 409 });
  });

  it('refuses when match timing cannot be read', async () => {
    lockMocks.findPlayersLockedForMove.mockResolvedValue({ ok: false, error: 'no fixture' });

    await expect(
      assertRosterPlayersMovable({ leagueId: 'league-1', playerIds: ['player-taken'], now })
    ).rejects.toMatchObject({ code: 'TIMING_UNAVAILABLE', status: 503 });
  });

  it('allows a swap when no player is locked', async () => {
    lockMocks.findPlayersLockedForMove.mockResolvedValue({ ok: true, lockedPlayers: [] });

    await expect(
      assertRosterPlayersMovable({ leagueId: 'league-1', playerIds: ['player-taken'], now })
    ).resolves.toBeUndefined();
  });
});

describe('swapRosterPlayers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves each player only from its current owner and clears both lineups', async () => {
    const tx = makeTx({ from: 1, to: 1 });

    await swapRosterPlayers(tx as never, bite);

    expect(tx.leagueRosterPlayer.updateMany).toHaveBeenNthCalledWith(1, {
      where: { leagueId: 'league-1', memberId: 'loser', playerId: { in: ['player-taken'] } },
      data: { memberId: 'bloodsucker', acquiredBy: 'BLOODSUCKER', acquiredAt: now },
    });
    expect(tx.leagueRosterPlayer.updateMany).toHaveBeenNthCalledWith(2, {
      where: { leagueId: 'league-1', memberId: 'bloodsucker', playerId: { in: ['player-given'] } },
      data: { memberId: 'loser', acquiredBy: 'BLOODSUCKER', acquiredAt: now },
    });
    expect(lockMocks.removePlayersFromOpenLineups).toHaveBeenCalledWith(tx, {
      leagueId: 'league-1',
      memberId: 'loser',
      playerIds: ['player-taken'],
      now,
    });
    expect(lockMocks.removePlayersFromOpenLineups).toHaveBeenCalledWith(tx, {
      leagueId: 'league-1',
      memberId: 'bloodsucker',
      playerIds: ['player-given'],
      now,
    });
  });

  it('fails with ROSTER_CHANGED when a player changed owner concurrently', async () => {
    const tx = makeTx({ from: 1, to: 0 });

    await expect(swapRosterPlayers(tx as never, bite)).rejects.toMatchObject({
      code: 'ROSTER_CHANGED',
      status: 409,
    });
    expect(lockMocks.removePlayersFromOpenLineups).not.toHaveBeenCalled();
    expect(tx.leagueTradeThread.findMany).not.toHaveBeenCalled();
  });

  it("invalidates pending trades for the swapped players in the swap's season (NFR-4) with the caller reason", async () => {
    const tx = makeTx({ from: 1, to: 1 }, [
      { id: 'thread-b', currentOfferId: 'offer-b', status: 'OPEN' },
    ]);

    await swapRosterPlayers(tx as never, bite);

    expect(tx.leagueTradeThread.findMany).toHaveBeenCalledWith({
      where: {
        leagueId: 'league-1',
        seasonId: 'season-1',
        status: { in: ['OPEN', 'PENDING_ADMIN_REVIEW', 'PENDING_VETO_REVIEW'] },
        currentOffer: {
          players: { some: { playerId: { in: ['player-taken', 'player-given'] } } },
        },
      },
      select: { id: true, currentOfferId: true, status: true },
    });
    expect(tx.leagueTradeEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ threadId: 'thread-b', reasonCode: 'PLAYER_BITTEN' })],
    });
    expect(tx.leagueTradeOutboxEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leagueId: 'league-1',
          seasonId: 'season-1',
          threadId: 'thread-b',
          eventType: 'trade:invalidated',
        }),
      ],
    });
  });

  it('leaves the completing trade thread out of invalidation', async () => {
    const tx = makeTx({ from: 1, to: 1 });

    await swapRosterPlayers(tx as never, { ...bite, excludeThreadId: 'thread-a' });

    expect(tx.leagueTradeThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'thread-a' } }),
      })
    );
  });
});

describe('refreshOwnershipProjection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-projects the league ownerships', async () => {
    const projection = { projectLeague: vi.fn().mockResolvedValue({ owned: 2, available: 9 }) };

    await refreshOwnershipProjection('league-1', projection);

    expect(projection.projectLeague).toHaveBeenCalledWith({ leagueId: 'league-1' });
  });

  it('logs and swallows a projection failure', async () => {
    const projection = { projectLeague: vi.fn().mockRejectedValue(new Error('firestore down')) };

    await expect(refreshOwnershipProjection('league-1', projection)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Ownership projection refresh failed after a roster swap',
      { leagueId: 'league-1', error: 'firestore down' }
    );
  });
});
