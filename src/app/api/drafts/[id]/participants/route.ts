/**
 * Draft Participant Management API Routes
 * /api/drafts/[id]/participants - Manage participant status
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { LeagueParams } from '@/types/api';

// Validation schema
const UpdateParticipantSchema = z.object({
  userId: z.string().min(1),
  isOnline: z.boolean().optional(),
});

// PUT /api/drafts/[id]/participants - Update participant status
export async function PUT(
  request: NextRequest,
  { params }: LeagueParams
) {
  const { id: draftId } = await params;
  if (typeof draftId !== 'string' || !draftId.trim()) {
    logger.warn('Invalid draft id in participants route', { draftId });
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
  }
  
  try {
    const body = await request.json();

    // Validate request body
    const validation = UpdateParticipantSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, isOnline } = validation.data;

    logger.debug('Updating participant status via API', { draftId, userId, isOnline });

    if (isOnline !== undefined) {
      await getLiveDraftEngine().updateParticipantStatus(draftId, userId, isOnline);
    }

    return NextResponse.json({
      success: true,
      message: 'Participant status updated successfully',
      draftId,
      userId,
      isOnline,
      updatedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error(
      'Failed to update participant status via API',
      error instanceof Error ? error : undefined,
      {
        draftId,
        path: request.nextUrl?.pathname ?? request.url,
        requestId: request.headers.get('x-request-id') ?? undefined,
      }
    );

    const errorMessage =
      error instanceof Error ? error.message : 'Failed to update participant status';
    const statusCode = errorMessage.includes('not found') ? 404 : 500;

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
