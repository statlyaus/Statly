/**
 * Draft Resume API Routes
 * /api/drafts/[draftId]/resume - Resume a paused draft
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
    } catch (_verifyErr) {
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
      return errorResponse('Only league owners can resume drafts', 403);
    }

    // Check if draft can be resumed
    if (draft.status !== DraftStatus.PAUSED) {
      return errorResponse('Only paused drafts can be resumed', 400);
    }

    // Resume the draft
    const updatedDraft = await prisma.draft.update({
      where: { id: draftId },
      data: {
        status: DraftStatus.LIVE,
        startedAt: new Date(), // Update start time
      },
    });

    // Revalidate cache
    try {
      await Promise.allSettled([revalidateTag(`draft:${draftId}`), revalidateTag('drafts')]);
    } catch (revalErr) {
      logger.warn('Failed to revalidate cache for draft resume', { draftId, error: revalErr });
    }

    // Emit real-time event
    try {
      getLiveDraftEngine().emit('draft:resumed', draftId, {
        draftId,
        status: 'LIVE',
        resumedAt: new Date().toISOString(),
        resumedBy: userId,
        currentPick: updatedDraft.currentPick,
      });
    } catch (emitError) {
      logger.warn('Failed to emit draft resume event', { draftId, error: emitError });
    }

    logger.info('Draft resumed successfully', {
      draftId,
      userId,
      previousStatus: draft.status,
      newStatus: updatedDraft.status,
    });

    return successResponse({
      message: 'Draft resumed successfully',
      draft: {
        id: updatedDraft.id,
        status: updatedDraft.status,
        resumedAt: new Date().toISOString(),
        currentPick: updatedDraft.currentPick,
      },
    });
  } catch (error) {
    logger.error('Failed to resume draft', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to resume draft', 500);
  }
}
