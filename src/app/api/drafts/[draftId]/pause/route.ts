/**
 * Draft Control API Routes
 * /api/drafts/[draftId]/pause - Pause a draft
 * /api/drafts/[draftId]/resume - Resume a draft
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { liveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';

// POST /api/drafts/[draftId]/pause - Pause a draft
export async function POST(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;

    logger.info('Pausing draft via API', { draftId });

    await liveDraftEngine.pauseDraft(draftId);

    return NextResponse.json({
      success: true,
      message: 'Draft paused successfully',
      draftId,
      pausedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Failed to pause draft via API', { 
      draftId: params.draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to pause draft';
    const statusCode = errorMessage.includes('not found') ? 404 : 
                      errorMessage.includes('not live') ? 400 : 500;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
