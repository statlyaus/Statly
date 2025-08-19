import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getLobbyState } from '@/lib/draftLobby';

/**
 * Get current lobby state
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;

    const lobbyState = await getLobbyState(draftId);

    return successResponse(lobbyState);
  } catch (error) {
    logger.error('Failed to get lobby state', {
      draftId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get lobby state', 500);
  }
}
