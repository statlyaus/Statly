export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getLobbyState } from '@/lib/draftLobby';
import { getDraftMembershipAccess } from '@/server/leagues/membership';
import { observeHistogram, registerHistogram } from '@/server/metrics';

// Register histograms once in this module context
registerHistogram('lobby_action_duration_seconds', [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram('lobby_get_duration_seconds', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]);

/**
 * GET lobby state
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const t0 = Date.now();
  let draftId: string | undefined;
  try {
    const ParamsSchema = z.object({ id: z.string().min(1) });
    const resolvedParams = await params;
    const parsed = ParamsSchema.safeParse(resolvedParams);
    if (!parsed.success) {
      logger.warn('Invalid draft id', { issues: parsed.error.issues });
      return errorResponse('Invalid draft id', 400);
    }
    draftId = parsed.data.id;

    // Lobby state describes who is present in a draft, so it is scoped to that draft's membership
    // rather than being readable by any caller.
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const access = await getDraftMembershipAccess(draftId, userId);
    if (!access.isMember) {
      return errorResponse('Draft access required', 403);
    }

    logger.info('Lobby API called', { draftId });

    const lobbyState = await getLobbyState(draftId);

    const res = successResponse(lobbyState);
    observeHistogram('lobby_get_duration_seconds', (Date.now() - t0) / 1000, { outcome: 'ok' });
    return res;
  } catch (error) {
    logger.error('Failed to get lobby state', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    observeHistogram('lobby_get_duration_seconds', (Date.now() - t0) / 1000, { outcome: 'error' });
    return errorResponse('Failed to get lobby state', 500);
  }
}
