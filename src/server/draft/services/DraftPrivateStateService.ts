import 'server-only';

import { DraftStatus, type Prisma } from '@prisma/client';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { draftRepository } from '@/server/draft/repository/DraftRepository';
import { getDraftMembershipAccess, isActivePrismaMembership } from '@/server/leagues/membership';
import {
  resolveCanonicalPlayerIds,
  STATLY_LEGACY_PLAYER_PROVIDER,
} from '@/server/players/playerIdentityService';

import type { PreDraftQueueItem, WatchlistItem } from '@/lib/draftLobby';

export class DraftPrivateStateAccessError extends Error {
  readonly kind = 'forbidden' as const;

  constructor(message = 'Not a member of this draft') {
    super(message);
    this.name = 'DraftPrivateStateAccessError';
  }
}

export class DraftPrivateStateValidationError extends Error {
  readonly kind = 'bad_request' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DraftPrivateStateValidationError';
  }
}

export class DraftPrivateStateConflictError extends Error {
  readonly kind = 'conflict' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DraftPrivateStateConflictError';
  }
}

interface ActorDraftInput {
  draftId: string;
  actorUserId: string;
}

interface AddWatchlistItemInput extends ActorDraftInput {
  playerId: string;
  priority?: number;
  notes?: string;
}

interface RemoveWatchlistItemInput extends ActorDraftInput {
  playerId: string;
}

interface AddPreDraftQueueItemInput extends ActorDraftInput {
  playerId: string;
  rank?: number;
  notes?: string;
}

interface RemovePreDraftQueueItemInput extends ActorDraftInput {
  playerId: string;
}

interface ReplacePreDraftQueueInput extends ActorDraftInput {
  unresolvedPlayerPolicy: 'reject' | 'remove';
  queue: Array<{
    playerId: string;
    rank: number;
    notes?: string;
  }>;
}

export interface ReplacePreDraftQueueResult {
  memberId: string;
  queue: PreDraftQueueItem[];
  removedPlayerIds: string[];
}

const privatePlayerSelect = {
  id: true,
  name: true,
  position: true,
  club: true,
  active: true,
} as const;

type DraftOrderReadClient = Pick<Prisma.TransactionClient, 'draftOrder'>;

type QueueWriteItem = {
  playerId: string;
  notes?: string;
};

async function resolveActiveMemberId(input: ActorDraftInput): Promise<string> {
  const access = await getDraftMembershipAccess(input.draftId, input.actorUserId);
  if (!access.isMember || !access.memberId) {
    throw new DraftPrivateStateAccessError();
  }

  return access.memberId;
}

async function resolveDraftParticipant(
  client: DraftOrderReadClient,
  input: ActorDraftInput,
  requireMutableQueue = false
): Promise<string> {
  const participant = await client.draftOrder.findFirst({
    where: {
      draftId: input.draftId,
      member: { userId: input.actorUserId },
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

  if (
    !participant ||
    participant.member.leagueId !== participant.draft.leagueId ||
    !isActivePrismaMembership(participant.member)
  ) {
    throw new DraftPrivateStateAccessError();
  }

  if (requireMutableQueue && participant.draft.status === DraftStatus.COMPLETED) {
    throw new DraftPrivateStateConflictError('A completed draft queue cannot be changed');
  }

  return participant.memberId;
}

function normalizeRequestedQueue(
  queue: ReplacePreDraftQueueInput['queue']
): Array<ReplacePreDraftQueueInput['queue'][number] & { inputIndex: number }> {
  const normalized = queue.map((item, inputIndex) => ({
    ...item,
    playerId: String(item.playerId ?? '').trim(),
    inputIndex,
  }));

  if (
    normalized.some(
      (item) => !item.playerId || !Number.isInteger(item.rank) || Number(item.rank) <= 0
    )
  ) {
    throw new DraftPrivateStateValidationError('Queue items require a player and positive rank');
  }

  return normalized.sort((a, b) => a.rank - b.rank || a.inputIndex - b.inputIndex);
}

async function replaceQueueRows(
  tx: Prisma.TransactionClient,
  draftId: string,
  memberId: string,
  queue: QueueWriteItem[]
): Promise<PreDraftQueueItem[]> {
  await tx.preDraftQueue.deleteMany({ where: { draftId, memberId } });

  if (queue.length > 0) {
    await tx.preDraftQueue.createMany({
      data: queue.map((item, index) => ({
        draftId,
        memberId,
        playerId: item.playerId,
        rank: index + 1,
        notes: item.notes,
      })),
    });
  }

  const persistedQueue = await tx.preDraftQueue.findMany({
    where: { draftId, memberId },
    include: { player: { select: privatePlayerSelect } },
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
  });

  return persistedQueue.map((item) => ({
    ...item,
    notes: item.notes ?? undefined,
  }));
}

async function logPrivateStateActivity(input: {
  draftId: string;
  memberId: string;
  action: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.lobbyActivity.create({
      data: {
        draftId: input.draftId,
        memberId: input.memberId,
        action: input.action,
        details: JSON.stringify(input.details),
      },
    });
  } catch (error) {
    logger.warn('Failed to record private draft state activity', {
      draftId: input.draftId,
      memberId: input.memberId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class DraftPrivateStateService {
  async getWatchlist(input: ActorDraftInput): Promise<WatchlistItem[]> {
    const memberId = await resolveActiveMemberId(input);
    const watchlist = await prisma.draftWatchlist.findMany({
      where: { draftId: input.draftId, memberId },
      include: { player: { select: privatePlayerSelect } },
      orderBy: { priority: 'asc' },
    });

    return watchlist.map((item) => ({
      ...item,
      notes: item.notes ?? undefined,
    }));
  }

  async addToWatchlist(input: AddWatchlistItemInput): Promise<WatchlistItem> {
    const memberId = await resolveActiveMemberId(input);
    const watchlistItem = await prisma.draftWatchlist.upsert({
      where: {
        draftId_memberId_playerId: {
          draftId: input.draftId,
          memberId,
          playerId: input.playerId,
        },
      },
      update: {
        priority: input.priority ?? 1,
        notes: input.notes,
      },
      create: {
        draftId: input.draftId,
        memberId,
        playerId: input.playerId,
        priority: input.priority ?? 1,
        notes: input.notes,
      },
      include: { player: { select: privatePlayerSelect } },
    });

    await logPrivateStateActivity({
      draftId: input.draftId,
      memberId,
      action: 'watchlist_updated',
      details: {
        playerId: input.playerId,
        action: 'added',
        priority: input.priority ?? 1,
      },
    });

    return {
      ...watchlistItem,
      notes: watchlistItem.notes ?? undefined,
    };
  }

  async removeFromWatchlist(input: RemoveWatchlistItemInput): Promise<void> {
    const memberId = await resolveActiveMemberId(input);
    const deleted = await prisma.draftWatchlist.deleteMany({
      where: {
        draftId: input.draftId,
        memberId,
        playerId: input.playerId,
      },
    });

    if (deleted.count > 0) {
      await logPrivateStateActivity({
        draftId: input.draftId,
        memberId,
        action: 'watchlist_updated',
        details: { playerId: input.playerId, action: 'removed' },
      });
    }
  }

  async getPreDraftQueue(input: ActorDraftInput): Promise<PreDraftQueueItem[]> {
    const memberId = await resolveDraftParticipant(prisma, input);
    const queue = await prisma.preDraftQueue.findMany({
      where: {
        draftId: input.draftId,
        memberId,
        player: {
          active: true,
          picks: { none: { draftId: input.draftId } },
        },
      },
      include: { player: { select: privatePlayerSelect } },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });

    return queue.map((item) => ({
      ...item,
      notes: item.notes ?? undefined,
    }));
  }

  async addToPreDraftQueue(input: AddPreDraftQueueItemInput): Promise<PreDraftQueueItem> {
    const result = await draftRepository.transaction(
      async (tx) => {
        const memberId = await resolveDraftParticipant(tx, input, true);

        const requestedId = String(input.playerId ?? '').trim();
        if (!requestedId) {
          throw new DraftPrivateStateValidationError('Player is required');
        }
        if (
          input.rank !== undefined &&
          (!Number.isInteger(input.rank) || Number(input.rank) <= 0)
        ) {
          throw new DraftPrivateStateValidationError('Queue rank must be a positive integer');
        }

        const resolvedIds = await resolveCanonicalPlayerIds(
          [requestedId],
          STATLY_LEGACY_PLAYER_PROVIDER,
          tx
        );
        const playerId = resolvedIds.get(requestedId);
        if (!playerId) {
          throw new DraftPrivateStateValidationError('Player not found');
        }

        const [player, picked, currentQueue] = await Promise.all([
          tx.player.findUnique({
            where: { id: playerId },
            select: { id: true, active: true },
          }),
          tx.pick.findUnique({
            where: { draftId_playerId: { draftId: input.draftId, playerId } },
            select: { id: true },
          }),
          tx.preDraftQueue.findMany({
            where: {
              draftId: input.draftId,
              memberId,
              player: {
                active: true,
                picks: { none: { draftId: input.draftId } },
              },
            },
            orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
            select: { playerId: true, notes: true },
          }),
        ]);

        if (!player?.active || picked) {
          throw new DraftPrivateStateConflictError('Player is no longer available');
        }

        const existing = currentQueue.find((item) => item.playerId === playerId);
        const nextQueue = currentQueue
          .filter((item) => item.playerId !== playerId)
          .map((item) => ({
            playerId: item.playerId,
            notes: item.notes ?? undefined,
          }));
        const targetIndex =
          input.rank === undefined
            ? existing
              ? currentQueue.indexOf(existing)
              : nextQueue.length
            : Math.min(Math.max(input.rank - 1, 0), nextQueue.length);
        nextQueue.splice(targetIndex, 0, {
          playerId,
          notes: input.notes ?? existing?.notes ?? undefined,
        });

        const persistedQueue = await replaceQueueRows(tx, input.draftId, memberId, nextQueue);
        const persisted = persistedQueue.find((item) => item.playerId === playerId);
        if (!persisted) {
          throw new DraftPrivateStateConflictError('Queue changed while it was being updated');
        }
        return { memberId, queueItem: persisted };
      },
      { retryPolicy: 'idempotent' }
    );

    await logPrivateStateActivity({
      draftId: input.draftId,
      memberId: result.memberId,
      action: 'queue_updated',
      details: {
        playerId: result.queueItem.playerId,
        action: 'added',
        rank: result.queueItem.rank,
      },
    });

    return result.queueItem;
  }

  async removeFromPreDraftQueue(input: RemovePreDraftQueueItemInput): Promise<boolean> {
    const deleted = await draftRepository.transaction(
      async (tx) => {
        const memberId = await resolveDraftParticipant(tx, input, true);
        const requestedId = String(input.playerId ?? '').trim();
        const resolvedIds = await resolveCanonicalPlayerIds(
          requestedId ? [requestedId] : [],
          STATLY_LEGACY_PLAYER_PROVIDER,
          tx
        );
        const playerId = resolvedIds.get(requestedId);
        if (!playerId) return { count: 0, memberId, playerId: requestedId };

        const currentQueue = await tx.preDraftQueue.findMany({
          where: { draftId: input.draftId, memberId },
          orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
          select: { playerId: true, notes: true },
        });
        const containsPlayer = currentQueue.some((item) => item.playerId === playerId);
        if (!containsPlayer) return { count: 0, memberId, playerId };

        await replaceQueueRows(
          tx,
          input.draftId,
          memberId,
          currentQueue
            .filter((item) => item.playerId !== playerId)
            .map((item) => ({
              playerId: item.playerId,
              notes: item.notes ?? undefined,
            }))
        );

        return { count: 1, memberId, playerId };
      },
      { retryPolicy: 'idempotent' }
    );

    if (deleted.count > 0) {
      await logPrivateStateActivity({
        draftId: input.draftId,
        memberId: deleted.memberId,
        action: 'queue_updated',
        details: { playerId: deleted.playerId, action: 'removed' },
      });
    }

    return deleted.count > 0;
  }

  async replacePreDraftQueue(
    input: ReplacePreDraftQueueInput
  ): Promise<ReplacePreDraftQueueResult> {
    const result = await draftRepository.transaction(
      async (tx) => {
        const memberId = await resolveDraftParticipant(tx, input, true);
        const orderedInput = normalizeRequestedQueue(input.queue);
        const requestedIds = orderedInput.map((item) => item.playerId);
        const resolvedIds = await resolveCanonicalPlayerIds(
          requestedIds,
          STATLY_LEGACY_PLAYER_PROVIDER,
          tx
        );
        const unresolvedIds = requestedIds.filter((playerId) => !resolvedIds.has(playerId));
        if (input.unresolvedPlayerPolicy === 'reject' && unresolvedIds.length > 0) {
          throw new DraftPrivateStateValidationError('Queue contains an unknown player');
        }

        const seenPlayerIds = new Set<string>();
        const canonicalQueue: QueueWriteItem[] = [];
        for (const item of orderedInput) {
          const playerId = resolvedIds.get(item.playerId);
          if (!playerId || seenPlayerIds.has(playerId)) continue;
          seenPlayerIds.add(playerId);
          canonicalQueue.push({ playerId, notes: item.notes });
        }

        const canonicalIds = canonicalQueue.map((item) => item.playerId);
        const [players, picks] = await Promise.all([
          tx.player.findMany({
            where: { id: { in: canonicalIds } },
            select: { id: true, active: true },
          }),
          tx.pick.findMany({
            where: { draftId: input.draftId, playerId: { in: canonicalIds } },
            select: { playerId: true },
          }),
        ]);
        const activePlayerIds = new Set(
          players.filter((player) => player.active).map((player) => player.id)
        );
        const pickedPlayerIds = new Set(picks.map((pick) => pick.playerId));
        const unavailablePlayerIds = canonicalIds.filter(
          (playerId) => !activePlayerIds.has(playerId) || pickedPlayerIds.has(playerId)
        );
        const removedPlayerIds = Array.from(new Set([...unresolvedIds, ...unavailablePlayerIds]));
        const acceptedQueue = canonicalQueue.filter(
          (item) => activePlayerIds.has(item.playerId) && !pickedPlayerIds.has(item.playerId)
        );

        const queue = await replaceQueueRows(tx, input.draftId, memberId, acceptedQueue);

        return { memberId, queue, removedPlayerIds };
      },
      { retryPolicy: 'idempotent' }
    );

    await logPrivateStateActivity({
      draftId: input.draftId,
      memberId: result.memberId,
      action: 'queue_updated',
      details: {
        queueSize: result.queue.length,
        removedUnavailableCount: result.removedPlayerIds.length,
      },
    });

    return result;
  }
}

export const draftPrivateStateService = new DraftPrivateStateService();
