/**
 * Draft Queue Management API Routes
 * /api/drafts/[draftId]/queue - Manage participant pick queues
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { liveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// Validation schema
const UpdateQueueSchema = z.object({
  userId: z.string().min(1),
  queue: z.array(z.string()).max(100),
});

// PUT /api/drafts/[draftId]/queue - Update participant queue
export async function PUT(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;
    const body = await request.json();

    // Validate request body
    const validation = UpdateQueueSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, queue } = validation.data;

    logger.debug('Updating queue via API', { draftId, userId, queueLength: queue.length });

    await liveDraftEngine.updateQueue(draftId, userId, queue);

    return NextResponse.json({
      success: true,
      message: 'Queue updated successfully',
      draftId,
      userId,
      queueLength: queue.length,
      updatedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Failed to update queue via API', { 
      draftId: params.draftId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to update queue';
    const statusCode = errorMessage.includes('not found') ? 404 : 500;
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
