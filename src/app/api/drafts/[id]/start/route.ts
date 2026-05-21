/**
 * Draft Action API Routes
 * /api/drafts/[draftId]/start - Start a draft
 */

export const runtime = 'nodejs';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

// POST /api/drafts/[draftId]/start - Start a draft
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await context.params;

  try {
    const actorUserId = await getAuthenticatedUserId(request);
    if (!actorUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('Starting draft via API', { draftId });

    const result = await draftApplicationService.startDraft({ draftId, actorUserId });

    const snapshot = await draftRealtimePublisher.publishCommandResult(result);

    if (!snapshot) {
      return NextResponse.json({ error: 'Draft state unavailable after start' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Draft started successfully',
      draft: {
        draftId: snapshot.draftId,
        status: snapshot.status,
        currentPick: {
          userId: snapshot.currentPick.userId,
          pickNumber: snapshot.currentPick.pickNumber,
          expiresAt: snapshot.currentPick.expiresAt,
        },
        startedAt: snapshot.currentPick.startedAt,
      },
    });
  } catch (error) {
    logger.error('Failed to start draft via API', {
      draftId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const rawMessage = error instanceof Error ? error.message : 'Failed to start draft';
    const [kind, detail] = rawMessage.includes(':')
      ? rawMessage.split(':', 2)
      : ['internal', rawMessage];
    const errorMessage = detail || rawMessage;
    const statusCode =
      kind === 'not_found'
        ? 404
        : kind === 'bad_request' || rawMessage.includes('not in a startable state')
          ? 400
          : kind === 'conflict'
            ? 409
            : kind === 'forbidden'
              ? 403
              : 500;

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
