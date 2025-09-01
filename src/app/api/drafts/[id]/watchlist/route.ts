import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { addToWatchlist, removeFromWatchlist, getWatchlist } from '@/lib/draftLobby';
import type { LeagueParams } from '@/types/api';

interface WatchlistRequest {
  playerId: string;
  memberId: string;
  priority?: number;
  notes?: string;
}

/**
 * Get member's watchlist
 */
export async function GET(
  request: NextRequest,
  { params }: LeagueParams
) {
  let draftId: string;
  
  try {
    const resolvedParams = await params;
    draftId = resolvedParams.id;

    if (!draftId || typeof draftId !== 'string' || draftId.trim() === '') {
      logger.error('Invalid draftId in GET watchlist params', {
        draftId,
        params: resolvedParams,
      });
      return errorResponse('Invalid draft ID', 400);
    }
  } catch (error) {
    logger.error(
      'Failed to resolve params for GET watchlist',
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to resolve request parameters', 500);
  }

  try {
    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');

    if (!memberId) {
      return errorResponse('Missing memberId parameter', 400);
    }

    const watchlist = await getWatchlist(draftId, memberId);

    return successResponse({ watchlist });
  } catch (error) {
    logger.error(
      'Failed to get watchlist',
      error instanceof Error ? error : undefined,
      { draftId: draftId ?? 'unknown' }
    );

    return errorResponse('Failed to get watchlist', 500);
  }
}

/**
 * Add player to watchlist
 */
export async function POST(
  request: NextRequest,
  { params }: LeagueParams
) {
  let draftId: string;
  
  try {
    const resolvedParams = await params;
    draftId = resolvedParams.id;
    
    if (!draftId || typeof draftId !== 'string' || draftId.trim() === '') {
      logger.error('Invalid draftId in POST watchlist params', {
        draftId,
        params: resolvedParams,
      });
      return errorResponse('Invalid draft ID', 400);
    }
  } catch (error) {
    logger.error(
      'Failed to resolve params for POST watchlist',
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to resolve request parameters', 500);
  }

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
    logger.error(
      'Failed to add to watchlist',
      error instanceof Error ? error : undefined,
      { draftId: draftId ?? 'unknown' }
    );

    return errorResponse('Failed to add to watchlist', 500);
  }
}

/**
 * Remove player from watchlist
 */
export async function DELETE(
  request: NextRequest,
  { params }: LeagueParams
) {
  let draftId: string;
  
  try {
    const resolvedParams = await params;
    draftId = resolvedParams.id;
    
    if (!draftId || typeof draftId !== 'string' || draftId.trim() === '') {
      logger.error('Invalid draftId in DELETE watchlist params', {
        draftId,
        params: resolvedParams,
      });
      return errorResponse('Invalid draft ID', 400);
    }
  } catch (error) {
    logger.error(
      'Failed to resolve params for DELETE watchlist',
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to resolve request parameters', 500);
  }

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
    logger.error(
      'Failed to remove from watchlist',
      error instanceof Error ? error : undefined,
      { draftId: draftId ?? 'unknown' }
    );

    return errorResponse('Failed to remove from watchlist', 500);
  }
}
