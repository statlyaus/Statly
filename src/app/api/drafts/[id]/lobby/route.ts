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
import { SESSION_COOKIE_NAME } from '@/constants';

const API_DRAFT_LOBBY_GET_DURATION_SECONDS =
  'api_draft_lobby_get_duration_seconds';

registerHistogram(API_DRAFT_LOBBY_GET_DURATION_SECONDS, [
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
  _request: NextRequest,
  { params }: { params: { id: string } }
) : Promise<Response> {
  const startMs = Date.now();
  let outcome: 'success' | 'error' = 'success';
  let auth: 'none' | 'verified' | 'invalid' = 'none';
  let draftId = '';

  try {
    const ParamsSchema = z.object({ id: z.string().min(1) });
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      outcome = 'error';
      logger.warn('Invalid draft id', { issues: parsed.error.issues });
      return errorResponse('Invalid draft id', 400);
    }
    draftId = parsed.data.id;

    // Attempt to verify session cookie; lobby data is still returned even if auth fails
    try {
      const sessionCookie = cookies().get(SESSION_COOKIE_NAME)?.value;
      if (sessionCookie) {
        await adminAuth.verifySessionCookie(sessionCookie, true);
        auth = 'verified';
      }
    } catch (authErr) {
      auth = 'invalid';
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

    return successResponse(lobbyState);
  } catch (error) {
    outcome = 'error';
    logger.error('Failed to get lobby state', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse('Failed to get lobby state', 500);
  } finally {
    observeHistogram(
      API_DRAFT_LOBBY_GET_DURATION_SECONDS,
      (Date.now() - startMs) / 1000,
      { outcome, auth }
    );
  }
}
