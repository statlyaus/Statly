import { DraftStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, getDraftMembershipAccess, prisma, resolveCanonicalPlayerIds } = vi.hoisted(
  () => {
    const transactionClient = {
      draftOrder: { findFirst: vi.fn() },
      player: { findMany: vi.fn(), findUnique: vi.fn() },
      pick: { findMany: vi.fn(), findUnique: vi.fn() },
      preDraftQueue: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn(),
      },
    };

    return {
      draftRepository: {
        transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) =>
          callback(transactionClient)
        ),
      },
      getDraftMembershipAccess: vi.fn(),
      resolveCanonicalPlayerIds: vi.fn(),
      prisma: {
        draftOrder: { findFirst: vi.fn() },
        draftWatchlist: {
          findMany: vi.fn(),
          upsert: vi.fn(),
          deleteMany: vi.fn(),
        },
        preDraftQueue: { findMany: vi.fn() },
        lobbyActivity: { create: vi.fn() },
        transactionClient,
      },
    };
  }
);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/draft/repository/DraftRepository', () => ({
  draftRepository,
}));
vi.mock('@/server/leagues/membership', () => ({
  getDraftMembershipAccess,
  isActivePrismaMembership: (membership: { isActive: boolean; status: string }) =>
    membership.isActive &&
    !['declined', 'inactive', 'removed'].includes(membership.status.trim().toLowerCase()),
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  STATLY_LEGACY_PLAYER_PROVIDER: 'statly-legacy',
  resolveCanonicalPlayerIds,
}));

import {
  DraftPrivateStateAccessError,
  DraftPrivateStateConflictError,
  DraftPrivateStateService,
  DraftPrivateStateValidationError,
} from '@/server/draft/services/DraftPrivateStateService';

const actor = { draftId: 'draft-1', actorUserId: 'user-1' };
const memberId = 'member-1';
const player = {
  id: 'player-1',
  name: 'Player One',
  position: 'MID',
  club: 'CAR',
  active: true,
};

function participant(
  draftStatus: DraftStatus = DraftStatus.LIVE,
  membership: { isActive: boolean; status: string } = { isActive: true, status: 'ACTIVE' }
) {
  return {
    memberId,
    member: { leagueId: 'league-1', ...membership },
    draft: { leagueId: 'league-1', status: draftStatus },
  };
}

function queueRow(playerId: string, rank: number, active = true) {
  return {
    id: `queue-${playerId}`,
    draftId: actor.draftId,
    memberId,
    playerId,
    rank,
    notes: null,
    createdAt: new Date(`2026-08-01T00:00:0${rank}.000Z`),
    updatedAt: new Date(`2026-08-01T00:00:0${rank}.000Z`),
    player: {
      id: playerId,
      name: `Player ${playerId}`,
      position: 'MID',
      club: 'CAR',
      active,
    },
  };
}

describe('DraftPrivateStateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDraftMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: actor.actorUserId,
      memberId,
      isMember: true,
      canManage: false,
    });
    prisma.draftOrder.findFirst.mockResolvedValue(participant());
    prisma.transactionClient.draftOrder.findFirst.mockResolvedValue(participant());
    prisma.transactionClient.preDraftQueue.deleteMany.mockResolvedValue({ count: 0 });
    prisma.transactionClient.preDraftQueue.createMany.mockResolvedValue({ count: 0 });
    prisma.transactionClient.preDraftQueue.findMany.mockResolvedValue([]);
    prisma.transactionClient.pick.findMany.mockResolvedValue([]);
    resolveCanonicalPlayerIds.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, id]))
    );
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
        memberId,
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
      memberId,
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
      expect.objectContaining({ where: { draftId: actor.draftId, memberId } })
    );
    expect(prisma.draftWatchlist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ memberId, playerId: player.id }),
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
      where: { draftId: actor.draftId, memberId, playerId: player.id },
    });
    expect(prisma.lobbyActivity.create).not.toHaveBeenCalled();
  });

  it('filters inactive and already-picked players from private queue reads', async () => {
    prisma.preDraftQueue.findMany.mockResolvedValue([queueRow('available-player', 2)]);

    const queue = await new DraftPrivateStateService().getPreDraftQueue(actor);

    expect(prisma.draftOrder.findFirst).toHaveBeenCalledWith({
      where: {
        draftId: actor.draftId,
        member: { userId: actor.actorUserId },
      },
      select: {
        memberId: true,
        member: {
          select: {
            leagueId: true,
            isActive: true,
            status: true,
          },
        },
        draft: { select: { leagueId: true, status: true } },
      },
    });
    expect(prisma.preDraftQueue.findMany).toHaveBeenCalledWith({
      where: {
        draftId: actor.draftId,
        memberId,
        player: {
          active: true,
          picks: { none: { draftId: actor.draftId } },
        },
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            club: true,
            active: true,
          },
        },
      },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
    expect(queue.map((item) => item.playerId)).toEqual(['available-player']);
  });

  it('keeps an already queued player at its existing rank when compatibility add omits rank', async () => {
    prisma.transactionClient.player.findUnique.mockResolvedValue({
      id: 'queued-player',
      active: true,
    });
    prisma.transactionClient.pick.findUnique.mockResolvedValue(null);
    prisma.transactionClient.preDraftQueue.findMany
      .mockResolvedValueOnce([
        { playerId: 'first-player', notes: 'first note' },
        { playerId: 'queued-player', notes: 'queued note' },
        { playerId: 'third-player', notes: null },
      ])
      .mockResolvedValueOnce([
        { ...queueRow('first-player', 1), notes: 'first note' },
        { ...queueRow('queued-player', 2), notes: 'queued note' },
        queueRow('third-player', 3),
      ]);

    const result = await new DraftPrivateStateService().addToPreDraftQueue({
      ...actor,
      playerId: 'queued-player',
    });

    expect(prisma.transactionClient.preDraftQueue.createMany).toHaveBeenCalledWith({
      data: [
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'first-player',
          rank: 1,
          notes: 'first note',
        },
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'queued-player',
          rank: 2,
          notes: 'queued note',
        },
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'third-player',
          rank: 3,
          notes: undefined,
        },
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({ playerId: 'queued-player', rank: 2, notes: 'queued note' })
    );
  });

  it('reorders an existing player, removes filtered stale rows, and preserves contiguous noted entries', async () => {
    prisma.transactionClient.player.findUnique.mockResolvedValue({
      id: 'queued-player',
      active: true,
    });
    prisma.transactionClient.pick.findUnique.mockResolvedValue(null);
    prisma.transactionClient.preDraftQueue.findMany
      .mockResolvedValueOnce([
        { playerId: 'first-player', notes: 'first note' },
        { playerId: 'second-player', notes: 'second note' },
        { playerId: 'queued-player', notes: 'queued note' },
      ])
      .mockResolvedValueOnce([
        { ...queueRow('queued-player', 1), notes: 'queued note' },
        { ...queueRow('first-player', 2), notes: 'first note' },
        { ...queueRow('second-player', 3), notes: 'second note' },
      ]);

    const result = await new DraftPrivateStateService().addToPreDraftQueue({
      ...actor,
      playerId: 'queued-player',
      rank: 1,
    });

    expect(prisma.transactionClient.preDraftQueue.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        draftId: actor.draftId,
        memberId,
        player: {
          active: true,
          picks: { none: { draftId: actor.draftId } },
        },
      },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      select: { playerId: true, notes: true },
    });
    expect(prisma.transactionClient.preDraftQueue.deleteMany).toHaveBeenCalledWith({
      where: { draftId: actor.draftId, memberId },
    });
    expect(prisma.transactionClient.preDraftQueue.createMany).toHaveBeenCalledWith({
      data: [
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'queued-player',
          rank: 1,
          notes: 'queued note',
        },
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'first-player',
          rank: 2,
          notes: 'first note',
        },
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'second-player',
          rank: 3,
          notes: 'second note',
        },
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({ playerId: 'queued-player', rank: 1, notes: 'queued note' })
    );
  });

  it('resolves a compatibility alias, deletes the intended item, and compacts remaining ranks', async () => {
    resolveCanonicalPlayerIds.mockResolvedValue(
      new Map([['legacy-player-id', 'canonical-player-id']])
    );
    prisma.transactionClient.preDraftQueue.deleteMany.mockResolvedValue({ count: 1 });
    prisma.transactionClient.preDraftQueue.findMany
      .mockResolvedValueOnce([
        { playerId: 'first-player', notes: 'first note' },
        { playerId: 'canonical-player-id', notes: 'removed note' },
        { playerId: 'third-player', notes: 'third note' },
      ])
      .mockResolvedValueOnce([
        { ...queueRow('first-player', 1), notes: 'first note' },
        { ...queueRow('third-player', 2), notes: 'third note' },
      ]);

    await expect(
      new DraftPrivateStateService().removeFromPreDraftQueue({
        ...actor,
        playerId: 'legacy-player-id',
      })
    ).resolves.toBe(true);

    expect(draftRepository.transaction).toHaveBeenCalledWith(expect.any(Function), {
      retryPolicy: 'idempotent',
    });
    expect(resolveCanonicalPlayerIds).toHaveBeenCalledWith(
      ['legacy-player-id'],
      'statly-legacy',
      prisma.transactionClient
    );
    expect(prisma.transactionClient.preDraftQueue.createMany).toHaveBeenCalledWith({
      data: [
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'first-player',
          rank: 1,
          notes: 'first note',
        },
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'third-player',
          rank: 2,
          notes: 'third note',
        },
      ],
    });
    expect(prisma.transactionClient.preDraftQueue.deleteMany).toHaveBeenCalledWith({
      where: { draftId: actor.draftId, memberId },
    });
  });

  it('canonicalizes, deduplicates, filters unavailable players, and persists contiguous ranks', async () => {
    resolveCanonicalPlayerIds.mockResolvedValue(
      new Map([
        ['picked-alias', 'picked-player'],
        ['inactive-alias', 'inactive-player'],
        ['available-alias', 'available-player'],
        ['available-player', 'available-player'],
      ])
    );
    prisma.transactionClient.player.findMany.mockResolvedValue([
      { id: 'picked-player', active: true },
      { id: 'inactive-player', active: false },
      { id: 'available-player', active: true },
    ]);
    prisma.transactionClient.pick.findMany.mockResolvedValue([{ playerId: 'picked-player' }]);
    prisma.transactionClient.preDraftQueue.createMany.mockResolvedValue({ count: 1 });
    prisma.transactionClient.preDraftQueue.findMany.mockResolvedValue([
      queueRow('available-player', 1),
    ]);

    const result = await new DraftPrivateStateService().replacePreDraftQueue({
      ...actor,
      unresolvedPlayerPolicy: 'reject',
      queue: [
        { playerId: 'available-player', rank: 40 },
        { playerId: 'available-alias', rank: 30, notes: 'keep this note' },
        { playerId: 'inactive-alias', rank: 20 },
        { playerId: 'picked-alias', rank: 10 },
      ],
    });

    expect(draftRepository.transaction).toHaveBeenCalledWith(expect.any(Function), {
      retryPolicy: 'idempotent',
    });
    expect(resolveCanonicalPlayerIds).toHaveBeenCalledWith(
      ['picked-alias', 'inactive-alias', 'available-alias', 'available-player'],
      'statly-legacy',
      prisma.transactionClient
    );
    expect(prisma.transactionClient.player.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['picked-player', 'inactive-player', 'available-player'] },
      },
      select: { id: true, active: true },
    });
    expect(prisma.transactionClient.pick.findMany).toHaveBeenCalledWith({
      where: {
        draftId: actor.draftId,
        playerId: { in: ['picked-player', 'inactive-player', 'available-player'] },
      },
      select: { playerId: true },
    });
    expect(prisma.transactionClient.preDraftQueue.deleteMany).toHaveBeenCalledWith({
      where: { draftId: actor.draftId, memberId },
    });
    expect(prisma.transactionClient.preDraftQueue.createMany).toHaveBeenCalledWith({
      data: [
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'available-player',
          rank: 1,
          notes: 'keep this note',
        },
      ],
    });
    expect(result).toEqual({
      memberId,
      queue: [expect.objectContaining({ playerId: 'available-player', rank: 1 })],
      removedPlayerIds: ['picked-player', 'inactive-player'],
    });
  });

  it('rejects unknown players without replacing the persisted queue', async () => {
    resolveCanonicalPlayerIds.mockResolvedValue(new Map());

    await expect(
      new DraftPrivateStateService().replacePreDraftQueue({
        ...actor,
        unresolvedPlayerPolicy: 'reject',
        queue: [{ playerId: 'unknown-player', rank: 1 }],
      })
    ).rejects.toBeInstanceOf(DraftPrivateStateValidationError);

    expect(prisma.transactionClient.preDraftQueue.deleteMany).not.toHaveBeenCalled();
    expect(prisma.transactionClient.preDraftQueue.createMany).not.toHaveBeenCalled();
  });

  it('reports unknown players while persisting valid entries for compatibility callers', async () => {
    resolveCanonicalPlayerIds.mockResolvedValue(
      new Map([['available-player', 'available-player']])
    );
    prisma.transactionClient.player.findMany.mockResolvedValue([
      { id: 'available-player', active: true },
    ]);
    prisma.transactionClient.preDraftQueue.createMany.mockResolvedValue({ count: 1 });
    prisma.transactionClient.preDraftQueue.findMany.mockResolvedValue([
      queueRow('available-player', 1),
    ]);

    const result = await new DraftPrivateStateService().replacePreDraftQueue({
      ...actor,
      unresolvedPlayerPolicy: 'remove',
      queue: [
        { playerId: 'unknown-player', rank: 1 },
        { playerId: 'available-player', rank: 2 },
      ],
    });

    expect(prisma.transactionClient.preDraftQueue.deleteMany).toHaveBeenCalledWith({
      where: { draftId: actor.draftId, memberId },
    });
    expect(prisma.transactionClient.preDraftQueue.createMany).toHaveBeenCalledWith({
      data: [
        {
          draftId: actor.draftId,
          memberId,
          playerId: 'available-player',
          rank: 1,
          notes: undefined,
        },
      ],
    });
    expect(result).toEqual({
      memberId,
      queue: [expect.objectContaining({ playerId: 'available-player', rank: 1 })],
      removedPlayerIds: ['unknown-player'],
    });
  });

  it('revalidates active membership when the repository retries a queue write', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.transactionClient.draftOrder.findFirst
      .mockResolvedValueOnce(participant())
      .mockResolvedValueOnce(participant(DraftStatus.LIVE, { isActive: false, status: 'REMOVED' }));
    resolveCanonicalPlayerIds.mockRejectedValueOnce(conflict);
    draftRepository.transaction.mockImplementationOnce(
      async (callback: (tx: typeof prisma.transactionClient) => unknown) => {
        await expect(callback(prisma.transactionClient)).rejects.toBe(conflict);
        return callback(prisma.transactionClient);
      }
    );

    await expect(
      new DraftPrivateStateService().addToPreDraftQueue({
        ...actor,
        playerId: 'available-player',
      })
    ).rejects.toBeInstanceOf(DraftPrivateStateAccessError);

    expect(prisma.transactionClient.draftOrder.findFirst).toHaveBeenCalledTimes(2);
    expect(draftRepository.transaction).toHaveBeenCalledWith(expect.any(Function), {
      retryPolicy: 'idempotent',
    });
    expect(resolveCanonicalPlayerIds).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.preDraftQueue.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects invalid ranks and completed draft mutations with typed errors', async () => {
    const service = new DraftPrivateStateService();

    await expect(
      service.replacePreDraftQueue({
        ...actor,
        unresolvedPlayerPolicy: 'reject',
        queue: [{ playerId: player.id, rank: 0 }],
      })
    ).rejects.toBeInstanceOf(DraftPrivateStateValidationError);

    prisma.transactionClient.draftOrder.findFirst.mockResolvedValue(
      participant(DraftStatus.COMPLETED)
    );
    await expect(
      service.replacePreDraftQueue({
        ...actor,
        unresolvedPlayerPolicy: 'reject',
        queue: [{ playerId: player.id, rank: 1 }],
      })
    ).rejects.toBeInstanceOf(DraftPrivateStateConflictError);
  });

  it('requires the authenticated league member to be a persisted draft participant', async () => {
    prisma.draftOrder.findFirst.mockResolvedValue(null);

    await expect(new DraftPrivateStateService().getPreDraftQueue(actor)).rejects.toBeInstanceOf(
      DraftPrivateStateAccessError
    );
    expect(prisma.preDraftQueue.findMany).not.toHaveBeenCalled();
  });
});
