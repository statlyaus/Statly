/**
 * Draft Action API Routes
 * /api/drafts/[draftId]/start - Start a draft
 */

export const runtime = 'nodejs';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

// POST /api/drafts/[draftId]/start - Start a draft
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await context.params;

  try {
    logger.info('Starting draft via API', { draftId });

    const result = await draftApplicationService.startDraft({ draftId });

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

    const errorMessage = error instanceof Error ? error.message : 'Failed to start draft';
    const statusCode = errorMessage.includes('not found')
      ? 404
      : errorMessage.includes('not in a startable state')
        ? 400
        : 500;

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
