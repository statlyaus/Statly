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
        idLength: draftId?.length,
      });
      throw new Error(`Draft not found: ${draftId}`);
    }

    logger.info('Draft found', {
      draftId,
      status: draft.status,
      hasLobbyStatus: 'lobbyStatus' in draft,
      hasLobbyOpenAt: 'lobbyOpenAt' in draft,
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
      logger.info('Forcing LIVE status for legacy LIVE draft', {
        draftId,
        draftStatus: draft.status,
      });
      lobbyStatus = 'LIVE';
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
