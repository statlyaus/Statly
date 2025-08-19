import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { subMinutes } from 'date-fns';

export type LobbyStatus = 'CLOSED' | 'OPEN' | 'COUNTDOWN' | 'LIVE';

export interface LobbyState {
  status: LobbyStatus;
  participantsOnline: string[];
  countdownStartsAt?: Date;
  draftStartsAt?: Date;
  timeRemaining?: number; // seconds
}

export interface WatchlistItem {
  id: string;
  playerId: string;
  priority: number;
  notes?: string;
  player: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
}

export interface PreDraftQueueItem {
  id: string;
  playerId: string;
  rank: number;
  notes?: string;
  player: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
}

/**
 * Open the draft lobby (5 minutes before draft start)
 */
export async function openDraftLobby(draftId: string): Promise<void> {
  try {
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!draft) {
      throw new Error('Draft not found');
    }

    const draftStartTime = draft.league?.settings?.startAt;
    if (!draftStartTime) {
      throw new Error('Draft start time not set');
    }

    const lobbyOpenTime = subMinutes(draftStartTime, 5); // 5 minutes before
    const _countdownStartTime = subMinutes(draftStartTime, 5); // Countdown starts immediately

    await prisma.draft.update({
      where: { id: draftId },
      data: {
        lobbyStatus: 'OPEN',
        lobbyOpenAt: lobbyOpenTime,
      },
    });

    logger.info('Draft lobby opened', {
      draftId,
      lobbyOpenTime: lobbyOpenTime.toISOString(),
      draftStartTime: draftStartTime.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to open draft lobby', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Start the 5-minute countdown
 */
export async function startDraftCountdown(draftId: string): Promise<void> {
  try {
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        lobbyStatus: 'COUNTDOWN',
      },
    });

    logger.info('Draft countdown started', { draftId });
  } catch (error) {
    logger.error('Failed to start draft countdown', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get current lobby state
 */
export async function getLobbyState(draftId: string): Promise<LobbyState> {
  try {
    logger.info('Getting lobby state for draft', { draftId });

    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!draft) {
      logger.error('Draft not found in database', {
        draftId,
        requestedId: draftId,
        idType: typeof draftId,
        idLength: draftId?.length
      });
      throw new Error(`Draft not found: ${draftId}`);
    }

    logger.info('Draft found', {
      draftId,
      status: draft.status,
      hasLobbyStatus: 'lobbyStatus' in draft,
      hasLobbyOpenAt: 'lobbyOpenAt' in draft
    });

    const now = new Date();
    const draftStartTime = draft.league?.settings?.startAt;

    // Handle legacy drafts that don't have lobby columns yet
    let lobbyStatus: LobbyStatus = 'CLOSED';

    // Check if this is a legacy draft or if lobby columns exist
    if ('lobbyStatus' in draft && draft.lobbyStatus) {
      lobbyStatus = draft.lobbyStatus as LobbyStatus;
    } else {
      // For legacy drafts, determine status based on draft status and timing
      if (draft.status === 'LIVE') {
        lobbyStatus = 'LIVE';
      } else if (draft.status === 'SCHEDULED' && draftStartTime) {
        const minutesUntilStart = (draftStartTime.getTime() - now.getTime()) / (1000 * 60);
        if (minutesUntilStart <= 5 && minutesUntilStart > 0) {
          lobbyStatus = 'COUNTDOWN';
        } else if (minutesUntilStart <= 0) {
          lobbyStatus = 'LIVE';
        } else {
          lobbyStatus = 'CLOSED';
        }
      }
    }

    // IMPORTANT FIX: For LIVE drafts without lobby status, force LIVE
    if (draft.status === 'LIVE' && lobbyStatus !== 'LIVE') {
      logger.info('Forcing LIVE status for legacy LIVE draft', { draftId, draftStatus: draft.status });
      lobbyStatus = 'LIVE';
    }

    // Special case: If draft is scheduled to start within 5 minutes and lobby isn't open yet,
    // automatically open the lobby and start countdown
    if (lobbyStatus === 'CLOSED' && draftStartTime && draft.status === 'SCHEDULED') {
      const minutesUntilStart = (draftStartTime.getTime() - now.getTime()) / (1000 * 60);
      if (minutesUntilStart <= 5 && minutesUntilStart > 0) {
        lobbyStatus = 'COUNTDOWN';
        // Update the draft to reflect this
        try {
          await prisma.draft.update({
            where: { id: draftId },
            data: {
              lobbyStatus: 'COUNTDOWN',
              lobbyOpenAt: now,
            },
          });
          logger.info('Auto-opened lobby for imminent draft', { draftId, minutesUntilStart });
        } catch (error) {
          logger.warn('Failed to auto-open lobby', { draftId, error });
        }
      }
    }

    let timeRemaining = 0;
    if (draftStartTime) {
      timeRemaining = Math.max(0, Math.floor((draftStartTime.getTime() - now.getTime()) / 1000));
    }

    const lobbyOpenAt = 'lobbyOpenAt' in draft ? draft.lobbyOpenAt : undefined;

    return {
      status: lobbyStatus,
      participantsOnline: [], // Will be populated by WebSocket
      countdownStartsAt: lobbyOpenAt || undefined,
      draftStartsAt: draftStartTime || undefined,
      timeRemaining,
    };
  } catch (error) {
    logger.error('Failed to get lobby state', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Add player to watchlist
 */
export async function addToWatchlist(
  draftId: string,
  memberId: string,
  playerId: string,
  priority: number = 1,
  notes?: string
): Promise<WatchlistItem> {
  try {
    const watchlistItem = await prisma.draftWatchlist.upsert({
      where: {
        draftId_memberId_playerId: {
          draftId,
          memberId,
          playerId,
        },
      },
      update: {
        priority,
        notes,
        updatedAt: new Date(),
      },
      create: {
        draftId,
        memberId,
        playerId,
        priority,
        notes,
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            club: true,
          },
        },
      },
    });

    // Log activity
    await logLobbyActivity(draftId, memberId, 'watchlist_updated', {
      playerId,
      action: 'added',
      priority,
    });

    return {
      ...watchlistItem,
      notes: watchlistItem.notes ?? undefined, // Convert null to undefined
    };
  } catch (error) {
    logger.error('Failed to add to watchlist', {
      draftId,
      memberId,
      playerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Remove player from watchlist
 */
export async function removeFromWatchlist(
  draftId: string,
  memberId: string,
  playerId: string
): Promise<void> {
  try {
    await prisma.draftWatchlist.delete({
      where: {
        draftId_memberId_playerId: {
          draftId,
          memberId,
          playerId,
        },
      },
    });

    // Log activity
    await logLobbyActivity(draftId, memberId, 'watchlist_updated', {
      playerId,
      action: 'removed',
    });

    logger.info('Player removed from watchlist', {
      draftId,
      memberId,
      playerId,
    });
  } catch (error) {
    logger.error('Failed to remove from watchlist', {
      draftId,
      memberId,
      playerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get member's watchlist
 */
export async function getWatchlist(draftId: string, memberId: string): Promise<WatchlistItem[]> {
  try {
    const watchlist = await prisma.draftWatchlist.findMany({
      where: {
        draftId,
        memberId,
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            club: true,
          },
        },
      },
      orderBy: {
        priority: 'asc',
      },
    });

    return watchlist.map(item => ({
      ...item,
      notes: item.notes ?? undefined, // Convert null to undefined
    }));
  } catch (error) {
    logger.error('Failed to get watchlist', {
      draftId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Update pre-draft queue
 */
export async function updatePreDraftQueue(
  draftId: string,
  memberId: string,
  queueItems: Array<{ playerId: string; rank: number; notes?: string }>
): Promise<PreDraftQueueItem[]> {
  try {
    // Delete existing queue items
    await prisma.preDraftQueue.deleteMany({
      where: {
        draftId,
        memberId,
      },
    });

    // Create new queue items
    const newQueueItems = await Promise.all(
      queueItems.map(async (item) => {
        return prisma.preDraftQueue.create({
          data: {
            draftId,
            memberId,
            playerId: item.playerId,
            rank: item.rank,
            notes: item.notes,
          },
          include: {
            player: {
              select: {
                id: true,
                name: true,
                position: true,
                club: true,
              },
            },
          },
        });
      })
    );

    // Log activity
    await logLobbyActivity(draftId, memberId, 'queue_updated', {
      queueSize: queueItems.length,
    });

    logger.info('Pre-draft queue updated', {
      draftId,
      memberId,
      queueSize: queueItems.length,
    });

    return newQueueItems.map(item => ({
      ...item,
      notes: item.notes ?? undefined, // Convert null to undefined
    }));
  } catch (error) {
    logger.error('Failed to update pre-draft queue', {
      draftId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get pre-draft queue
 */
export async function getPreDraftQueue(draftId: string, memberId: string): Promise<PreDraftQueueItem[]> {
  try {
    const queue = await prisma.preDraftQueue.findMany({
      where: {
        draftId,
        memberId,
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            club: true,
          },
        },
      },
      orderBy: {
        rank: 'asc',
      },
    });

    return queue.map(item => ({
      ...item,
      notes: item.notes ?? undefined, // Convert null to undefined
    }));
  } catch (error) {
    logger.error('Failed to get pre-draft queue', {
      draftId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Log lobby activity
 */
async function logLobbyActivity(
  draftId: string,
  memberId: string,
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.lobbyActivity.create({
      data: {
        draftId,
        memberId,
        action,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (error) {
    logger.error('Failed to log lobby activity', {
      draftId,
      memberId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
