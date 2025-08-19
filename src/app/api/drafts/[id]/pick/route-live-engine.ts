/**
 * Draft Pick API Routes
 * /api/drafts/[draftId]/pick - Make a pick in a draft
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { liveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// Validation schema
const MakePickSchema = z.object({
  userId: z.string().min(1),
  playerId: z.string().min(1),
});

// POST /api/drafts/[draftId]/pick - Make a pick
export async function POST(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;
    const body = await request.json();

    // Validate request body
    const validation = MakePickSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, playerId } = validation.data;

    logger.info('Making pick via API', { draftId, userId, playerId });

    const pick = await liveDraftEngine.makePick({
      draftId,
      userId,
      playerId,
    });

    return NextResponse.json({
      success: true,
      message: 'Pick made successfully',
      pick: {
        id: pick.id,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        player: pick.player,
        member: pick.member,
        auto: pick.auto,
        madeAt: pick.madeAt,
      }
    }, { status: 201 });

  } catch (error) {
    logger.error('Failed to make pick via API', { 
      draftId: params.draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to make pick';
    
    let statusCode = 500;
    if (errorMessage.includes('not found')) statusCode = 404;
    else if (errorMessage.includes('not live') || errorMessage.includes('paused') || 
             errorMessage.includes('not') && errorMessage.includes('turn')) statusCode = 400;
    else if (errorMessage.includes('not authorized')) statusCode = 403;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
