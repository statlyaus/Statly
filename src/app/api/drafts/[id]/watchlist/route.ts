import type { NextRequest } from 'next/server';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { addToWatchlist, removeFromWatchlist, getWatchlist } from '@/lib/draftLobby';
import { logger } from '@/lib/logger';

interface WatchlistRequest {
  playerId: string;
  memberId: string;
  priority?: number;
  notes?: string;
}

/**
 * Get member's watchlist
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params;
  try {
    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');

    if (!memberId) {
      return errorResponse('Missing memberId parameter', 400);
    }

    const watchlist = await getWatchlist(draftId, memberId);

    return successResponse({ watchlist });
  } catch (error) {
    logger.error('Failed to get watchlist', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get watchlist', 500);
  }
}

/**
 * Add player to watchlist
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params;
  try {
    const body: WatchlistRequest = await request.json();

    if (!body.playerId || !body.memberId) {
      return errorResponse('Missing playerId or memberId', 400);
    }

    const watchlistItem = await addToWatchlist(
      draftId,
      body.memberId,
      body.playerId,
      body.priority || 1,
      body.notes
    );

    return successResponse({ watchlistItem });
  } catch (error) {
    logger.error('Failed to add to watchlist', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to add to watchlist', 500);
  }
}

/**
 * Remove player from watchlist
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: draftId } = await params;
  try {
    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');
    const playerId = url.searchParams.get('playerId');

    if (!memberId || !playerId) {
      return errorResponse('Missing memberId or playerId parameters', 400);
    }

    await removeFromWatchlist(draftId, memberId, playerId);

    return successResponse({ message: 'Player removed from watchlist' });
  } catch (error) {
    logger.error('Failed to remove from watchlist', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to remove from watchlist', 500);
  }
}
