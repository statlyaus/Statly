import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getLobbyState } from '@/lib/draftLobby';
import { ensureLobbyColumns } from '@/lib/ensureLobbyColumns';
import type { LeagueParams } from '@/types/api';

/**
 * Get current lobby state
 */
export async function GET(
  request: NextRequest,
  { params }: LeagueParams
) {
  const { id: draftId } = params;
  if (typeof draftId !== 'string' || draftId.trim() === '') {
    logger.warn('Invalid draft id in lobby route', { draftId });
    return errorResponse('Invalid draft id', 400);
  }
  try {
    logger.info('Lobby API called', { draftId });

    // Ensure lobby columns exist before querying
    const columnsReady = await ensureLobbyColumns();
    if (!columnsReady) {
      logger.warn('Lobby columns not ready, using fallback');
    }

    const lobbyState = await getLobbyState(draftId);

    logger.info('Lobby state retrieved', { draftId, status: lobbyState.status });

    return successResponse(lobbyState);
  } catch (error) {
    logger.error(
      'Failed to get lobby state',
      error as Error,
      {
        draftId,
        path: request.nextUrl?.pathname ?? request.url,
        requestId: request.headers.get('x-request-id') ?? undefined,
      }
    );

    return errorResponse(
      `Failed to get lobby state: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}
