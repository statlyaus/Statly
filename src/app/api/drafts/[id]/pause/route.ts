/**
 * Draft Control API Routes
 * /api/drafts/[id]/pause - Pause a draft
 * /api/drafts/[id]/resume - Resume a draft
 */

import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftStatus } from '@prisma/client';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';
import { revalidateTag } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await context.params;
  if (typeof draftId !== 'string' || draftId.trim().length === 0) {
    return errorResponse('Missing or invalid draftId', 400);
  }
  
  try {
    // Verify user authentication
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('statly_session')?.value;
    
    if (!sessionCookie) {
      return errorResponse('Unauthorized', 401);
    }

    let userId: string;
    try {
      const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
      userId = decoded.uid;
    } catch (err) {
      // Log error details in development for debugging
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Session cookie verification failed', {
          draftId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      // Log at debug level for production debugging
      logger.debug('Session cookie verification failed', { draftId, error: err });
      return errorResponse('Unauthorized', 401);
    }

    // Get draft and verify user is league owner
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    // Check if user is league owner
    const isOwner = draft.league.members.some(
      (member) => member.userId === userId && member.role === 'OWNER'
    );

    if (!isOwner) {
      return errorResponse('Only league owners can pause drafts', 403);
    }

    // Check if draft can be paused
    if (draft.status !== DraftStatus.LIVE) {
      return errorResponse('Only live drafts can be paused', 400);
    }

    // Pause the draft
    const updatedDraft = await prisma.draft.update({
      where: { id: draftId },
      data: { 
        status: DraftStatus.PAUSED,
        // Store the current pick number for resuming
        currentPick: draft.currentPick,
      },
    });

    // Revalidate cache
    try {
      await Promise.allSettled([
        revalidateTag(`draft:${draftId}`),
        revalidateTag('drafts'),
      ]);
    } catch (revalErr) {
      logger.warn('Failed to revalidate cache for draft pause', { draftId, error: revalErr });
    }

    // Emit real-time event
    try {
      getLiveDraftEngine().emit('draft:paused', draftId, {
        draftId,
        status: 'PAUSED',
        timestamp: new Date().toISOString(),
      });
    } catch (emitError) {
      logger.warn('Failed to emit draft pause event', { draftId, error: emitError });
    }

    logger.info('Draft paused successfully', {
      draftId,
      userId,
      previousStatus: draft.status,
      newStatus: updatedDraft.status,
    });

    return successResponse({
      message: 'Draft paused successfully',
      draft: {
        id: updatedDraft.id,
        status: updatedDraft.status,
        pausedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to pause draft', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to pause draft', 500);
  }
}
