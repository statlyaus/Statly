import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getLobbyState } from '@/lib/draftLobby';
import { ensureLobbyColumns } from '@/lib/ensureLobbyColumns';

/**
 * Get current lobby state
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  let draftId: string | undefined;
  try {
    draftId = params.id?.trim();
    if (!draftId) {
      logger.warn('Missing draft id in route params');
      return errorResponse('Missing draft id', 400);
    }
    logger.info('Lobby API called', { draftId });

    // Ensure lobby columns exist before querying
    const columnsReady = await ensureLobbyColumns();
    if (!columnsReady) {
      logger.warn('Lobby columns not ready, using fallback');
    }

    const lobbyState = await getLobbyState(draftId);

    logger.info('Lobby state retrieved', { draftId, status: lobbyState.status });

    return successResponse(lobbyState);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get lobby state', err, { draftId });

    return errorResponse('Failed to get lobby state', 500);
  }
}
