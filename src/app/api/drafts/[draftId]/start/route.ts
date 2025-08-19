/**
 * Draft Action API Routes
 * /api/drafts/[draftId]/start - Start a draft
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { liveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';

// POST /api/drafts/[draftId]/start - Start a draft
export async function POST(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;

    logger.info('Starting draft via API', { draftId });

    await liveDraftEngine.startDraft(draftId);

    const draft = await liveDraftEngine.getDraft(draftId);
    
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found after start' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Draft started successfully',
      draft: {
        draftId: draft.draftId,
        status: draft.status,
        currentPick: {
          userId: draft.currentPick.userId,
          pickNumber: draft.currentPick.pickNumber,
          expiresAt: draft.currentPick.expiresAt,
        },
        startedAt: draft.updatedAt,
      }
    });

  } catch (error) {
    logger.error('Failed to start draft via API', { 
      draftId: params.draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to start draft';
    const statusCode = errorMessage.includes('not found') ? 404 : 
                      errorMessage.includes('not in a startable state') ? 400 : 500;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
