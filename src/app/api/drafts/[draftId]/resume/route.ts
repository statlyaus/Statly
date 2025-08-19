/**
 * Draft Resume API Routes
 * /api/drafts/[draftId]/resume - Resume a paused draft
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { liveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';

// POST /api/drafts/[draftId]/resume - Resume a draft
export async function POST(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;

    logger.info('Resuming draft via API', { draftId });

    await liveDraftEngine.resumeDraft(draftId);

    return NextResponse.json({
      success: true,
      message: 'Draft resumed successfully',
      draftId,
      resumedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Failed to resume draft via API', { 
      draftId: params.draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to resume draft';
    const statusCode = errorMessage.includes('not found') ? 404 : 
                      errorMessage.includes('not paused') ? 400 : 500;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
