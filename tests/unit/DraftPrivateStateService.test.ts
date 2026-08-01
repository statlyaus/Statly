import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftMembershipAccess, prisma } = vi.hoisted(() => {
  const transactionClient = {
    preDraftQueue: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };

  return {
    getDraftMembershipAccess: vi.fn(),
    prisma: {
      draftWatchlist: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      preDraftQueue: {
        findMany: vi.fn(),
      },
      lobbyActivity: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient)
      ),
      transactionClient,
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/leagues/membership', () => ({ getDraftMembershipAccess }));

import {
  DraftPrivateStateAccessError,
  DraftPrivateStateService,
} from '@/server/draft/services/DraftPrivateStateService';

const actor = { draftId: 'draft-1', actorUserId: 'user-1' };
const player = { id: 'player-1', name: 'Player One', position: 'MID', club: 'CAR' };

describe('DraftPrivateStateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDraftMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: actor.actorUserId,
      memberId: 'member-1',
      isMember: true,
      canManage: false,
    });
  });

  it('rejects inactive or cross-league actors before reading private state', async () => {
    getDraftMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: actor.actorUserId,
      isMember: false,
      canManage: false,
    });

    const service = new DraftPrivateStateService();

    await expect(service.getWatchlist(actor)).rejects.toBeInstanceOf(DraftPrivateStateAccessError);
    expect(prisma.draftWatchlist.findMany).not.toHaveBeenCalled();
    expect(prisma.preDraftQueue.findMany).not.toHaveBeenCalled();
  });

  it('scopes watchlist reads and writes to the server-resolved member', async () => {
    prisma.draftWatchlist.findMany.mockResolvedValue([
      {
        id: 'watch-1',
        draftId: actor.draftId,
        memberId: 'member-1',
        playerId: player.id,
        priority: 1,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        player,
      },
    ]);
    prisma.draftWatchlist.upsert.mockResolvedValue({
      id: 'watch-1',
      draftId: actor.draftId,
      memberId: 'member-1',
      playerId: player.id,
      priority: 2,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      player,
    });

    const service = new DraftPrivateStateService();
    const watchlist = await service.getWatchlist(actor);
    await service.addToWatchlist({ ...actor, playerId: player.id, priority: 2 });

    expect(getDraftMembershipAccess).toHaveBeenCalledWith(actor.draftId, actor.actorUserId);
    expect(prisma.draftWatchlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { draftId: actor.draftId, memberId: 'member-1' } })
    );
    expect(prisma.draftWatchlist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ memberId: 'member-1', playerId: player.id }),
      })
    );
    expect(watchlist[0]?.notes).toBeUndefined();
  });

  it('makes watchlist deletion idempotent', async () => {
    prisma.draftWatchlist.deleteMany.mockResolvedValue({ count: 0 });

    const service = new DraftPrivateStateService();
    await expect(
      service.removeFromWatchlist({ ...actor, playerId: player.id })
    ).resolves.toBeUndefined();

    expect(prisma.draftWatchlist.deleteMany).toHaveBeenCalledWith({
      where: { draftId: actor.draftId, memberId: 'member-1', playerId: player.id },
    });
    expect(prisma.lobbyActivity.create).not.toHaveBeenCalled();
  });

  it('replaces the authenticated member queue atomically', async () => {
    prisma.transactionClient.preDraftQueue.deleteMany.mockResolvedValue({ count: 1 });
    prisma.transactionClient.preDraftQueue.create.mockResolvedValue({ id: 'queue-1' });
    prisma.transactionClient.preDraftQueue.findMany.mockResolvedValue([
      {
        id: 'queue-1',
        draftId: actor.draftId,
        memberId: 'member-1',
        playerId: player.id,
        rank: 1,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        player,
      },
    ]);

    const service = new DraftPrivateStateService();
    const queue = await service.replacePreDraftQueue({
      ...actor,
      queue: [{ playerId: player.id, rank: 1 }],
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.preDraftQueue.deleteMany).toHaveBeenCalledWith({
      where: { draftId: actor.draftId, memberId: 'member-1' },
    });
    expect(prisma.transactionClient.preDraftQueue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        draftId: actor.draftId,
        memberId: 'member-1',
        playerId: player.id,
        rank: 1,
      }),
    });
    expect(queue.map((item) => item.playerId)).toEqual([player.id]);
  });
});
