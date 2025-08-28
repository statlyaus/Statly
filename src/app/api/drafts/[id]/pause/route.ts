/**
 * Draft Control API Routes
 * /api/drafts/[id]/pause - Pause a draft
 * /api/drafts/[id]/resume - Resume a draft
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';

// POST /api/drafts/[id]/pause - Pause a draft
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: draftId } = params;
  
  try {
    logger.info('Pausing draft via API', { draftId });

    const engine = getLiveDraftEngine();
    await engine.pauseDraft(draftId);
    const draft = await engine.getDraft(draftId);
    if (draft?.leagueId) {
      const results = await Promise.allSettled([
        revalidateTag(tags.draft(draft.leagueId)),
        revalidateTag(tags.league(draft.leagueId)),
      ]);
      const rejected = results.filter(r => r.status === 'rejected');
      if (rejected.length > 0) {
        logger.warn('Revalidation failed after pause', { draftId, leagueId: draft.leagueId, failed: rejected.length });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Draft paused successfully',
      draftId,
      pausedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Failed to pause draft via API', { 
      draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to pause draft';
    const statusCode = errorMessage.includes('not found') ? 404 : 
                      errorMessage.includes('not live') ? 400 : 500;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
