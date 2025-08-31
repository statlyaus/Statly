export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';
import { z } from 'zod';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getLobbyState } from '@/lib/draftLobby';
import { ensureLobbyColumns } from '@/lib/ensureLobbyColumns';
import { registerHistogram, observeHistogram } from '@/server/metrics';

registerHistogram('api_draft_lobby_get_duration_seconds', [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
]);

/**
 * Get current lobby state
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  let draftId: string | undefined;
  try {
    const ParamsSchema = z.object({ id: z.string().min(1) });
    const parsedParams = ParamsSchema.parse(await params);
    draftId = parsedParams.id;

    // Attempt to verify session cookie; lobby data is still returned even if auth fails
    try {
      const sessionCookie = (await cookies()).get('statly_session')?.value;
      if (sessionCookie) {
        await adminAuth.verifySessionCookie(sessionCookie, true);
      }
    } catch (authErr) {
      logger.debug('Lobby request auth verification failed', { error: authErr });
    }

    logger.info('Lobby API called', { draftId });

    // Ensure lobby columns exist before querying
    const columnsReady = await ensureLobbyColumns();
    if (!columnsReady) {
      logger.warn('Lobby columns not ready, using fallback');
    }

    const lobbyState = await getLobbyState(draftId);

    logger.info('Lobby state retrieved', { draftId, status: lobbyState.status });

    observeHistogram(
      'api_draft_lobby_get_duration_seconds',
      (Date.now() - start) / 1000
    );

    return successResponse(lobbyState);
  } catch (error) {
    observeHistogram(
      'api_draft_lobby_get_duration_seconds',
      (Date.now() - start) / 1000
    );

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
