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
  const { id: draftId } = await params;
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
    logger.error('Failed to get lobby state', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse(
      `Failed to get lobby state: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}
