/**
 * Draft Action API Routes
 * /api/drafts/[draftId]/start - Start a draft
 */

export const runtime = 'nodejs';
import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';

// POST /api/drafts/[draftId]/start - Start a draft
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await context.params;

  try {
    logger.info('Starting draft via API', { draftId });

    const engine = getLiveDraftEngine();
    await engine.startDraft(draftId);

    const draft = await engine.getDraft(draftId);

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found after start' }, { status: 404 });
    }

    if (draft.leagueId) {
      const results = await Promise.allSettled([
        revalidateTag(tags.draft(draft.leagueId)),
        revalidateTag(tags.league(draft.leagueId)),
      ]);
      const rejected = results.filter((r) => r.status === 'rejected');
      if (rejected.length) {
        logger.warn('Revalidation failed after start', {
          draftId,
          leagueId: draft.leagueId,
          failed: rejected.length,
        });
      }
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
