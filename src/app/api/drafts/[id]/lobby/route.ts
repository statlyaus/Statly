export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';
import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getLobbyState } from '@/lib/draftLobby';
import { ensureLobbyColumns } from '@/lib/ensureLobbyColumns';
import { prisma } from '@/lib/prisma';
import { draftRoomStore } from '@/server/roomStore';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { draftPubSub } from '@/services/realtime/pubsub';
import { incCounter, observeHistogram, registerHistogram } from '@/server/metrics';
import { executeSafely } from '@/lib/errorHandling';

// Register histograms once in this module context
registerHistogram('lobby_action_duration_seconds', [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram('lobby_get_duration_seconds', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]);

/**
 * GET lobby state
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Optional auth check
    try {
      const sessionCookie = cookies().get('statly_session')?.value;
      if (sessionCookie) {
        await adminAuth.verifySessionCookie(sessionCookie, true);
      }
    } catch (authErr) {
      logger.debug('Lobby request auth verification failed', { error: authErr });
    }

    logger.info('Lobby API called', { draftId });

    const columnsReady = await ensureLobbyColumns();
    if (!columnsReady) {
      logger.warn('Lobby columns not ready, using fallback');
    }

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

// POST stays as you pasted (already unified), no markers needed
