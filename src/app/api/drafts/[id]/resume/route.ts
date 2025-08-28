/**
 * Draft Resume API Routes
 * /api/drafts/[draftId]/resume - Resume a paused draft
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';

// POST /api/drafts/[draftId]/resume - Resume a draft
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: draftId } = await params;
  
  try {
    logger.info('Resuming draft via API', { draftId });

    await getLiveDraftEngine().resumeDraft(draftId);
    (async () => {
      try {
        const draft = await getLiveDraftEngine().getDraft(draftId);
        if (draft?.leagueId) {
          revalidateTag(tags.draft(draft.leagueId));
          revalidateTag(tags.league(draft.leagueId));
        }
      } catch (err) {
        logger.error('Failed to revalidate tags after draft resume', err, { draftId });
      }
    })();

    return NextResponse.json({
      success: true,
      message: 'Draft resumed successfully',
      draftId,
      resumedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Failed to resume draft via API', { 
      draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to resume draft';
    const statusCode = errorMessage.includes('not found') ? 404 : 
                      errorMessage.includes('not paused') ? 400 : 500;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
