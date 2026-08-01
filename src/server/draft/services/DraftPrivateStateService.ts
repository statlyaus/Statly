import 'server-only';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getDraftMembershipAccess } from '@/server/leagues/membership';

import type { PreDraftQueueItem, WatchlistItem } from '@/lib/draftLobby';

export class DraftPrivateStateAccessError extends Error {
  readonly kind = 'forbidden' as const;

  constructor(message = 'Not a member of this draft') {
    super(message);
    this.name = 'DraftPrivateStateAccessError';
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

interface ReplacePreDraftQueueInput extends ActorDraftInput {
  queue: Array<{
    playerId: string;
    rank: number;
    notes?: string;
  }>;
}

const privatePlayerSelect = {
  id: true,
  name: true,
  position: true,
  club: true,
} as const;

async function resolveActiveMemberId(input: ActorDraftInput): Promise<string> {
  const access = await getDraftMembershipAccess(input.draftId, input.actorUserId);
  if (!access.isMember || !access.memberId) {
    throw new DraftPrivateStateAccessError();
  }

  return access.memberId;
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
    const memberId = await resolveActiveMemberId(input);
    const queue = await prisma.preDraftQueue.findMany({
      where: { draftId: input.draftId, memberId },
      include: { player: { select: privatePlayerSelect } },
      orderBy: { rank: 'asc' },
    });

    return queue.map((item) => ({
      ...item,
      notes: item.notes ?? undefined,
    }));
  }

  async replacePreDraftQueue(input: ReplacePreDraftQueueInput): Promise<PreDraftQueueItem[]> {
    const memberId = await resolveActiveMemberId(input);
    const queue = await prisma.$transaction(async (tx) => {
      await tx.preDraftQueue.deleteMany({
        where: { draftId: input.draftId, memberId },
      });

      for (const item of input.queue) {
        await tx.preDraftQueue.create({
          data: {
            draftId: input.draftId,
            memberId,
            playerId: item.playerId,
            rank: item.rank,
            notes: item.notes,
          },
        });
      }

      return tx.preDraftQueue.findMany({
        where: { draftId: input.draftId, memberId },
        include: { player: { select: privatePlayerSelect } },
        orderBy: { rank: 'asc' },
      });
    });

    await logPrivateStateActivity({
      draftId: input.draftId,
      memberId,
      action: 'queue_updated',
      details: { queueSize: input.queue.length },
    });

    return queue.map((item) => ({
      ...item,
      notes: item.notes ?? undefined,
    }));
  }
}

export const draftPrivateStateService = new DraftPrivateStateService();
