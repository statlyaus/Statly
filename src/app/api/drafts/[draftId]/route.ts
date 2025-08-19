/**
 * Individual Draft Management API Routes
 * /api/drafts/[draftId]/* endpoints for live draft operations
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { liveDraftEngine } from '@/services/liveDraftEngine';
import { logger } from '@/lib/logger';

// Helper function to handle API errors
function handleError(error: Error, context: string) {
  logger.error(`API Error in ${context}`, { error: error.message, stack: error.stack });
  
  if (error.message.includes('not found')) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  
  if (error.message.includes('not authorized') || error.message.includes('Access denied')) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  
  if (error.message.includes('validation') || error.message.includes('Invalid')) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  
  return NextResponse.json(
    { error: 'Internal server error' }, 
    { status: 500 }
  );
}

// GET /api/drafts/[draftId] - Get draft state
export async function GET(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;

    logger.debug('Fetching draft state via API', { draftId });

    const draft = await liveDraftEngine.getDraft(draftId);
    
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    // Format response for client consumption
    const response = {
      draftId: draft.draftId,
      leagueId: draft.leagueId,
      status: draft.status,
      currentPick: {
        userId: draft.currentPick.userId,
        pickNumber: draft.currentPick.pickNumber,
        round: draft.currentPick.round,
        slot: draft.currentPick.slot,
        expiresAt: draft.currentPick.expiresAt,
        timeRemaining: Math.max(0, Math.floor((draft.currentPick.expiresAt.getTime() - Date.now()) / 1000)),
      },
      picks: draft.picks.map(pick => ({
        playerId: pick.playerId,
        userId: pick.userId,
        pickNumber: pick.pickNumber,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        timestamp: pick.timestamp,
      })),
      participants: draft.participants.map(p => ({
        userId: p.userId,
        displayName: p.displayName,
        draftOrder: p.draftOrder,
        isOnline: p.isOnline,
        queueSize: p.queue.length,
        autoPickEnabled: p.autoPickEnabled,
        lastActivity: p.lastActivity,
      })),
      settings: {
        totalRounds: draft.draftSettings.totalRounds,
        totalTeams: draft.draftSettings.totalTeams,
        draftType: draft.draftSettings.draftType,
        pickTimeLimit: draft.draftSettings.pickTimeLimit,
      },
      timerSettings: draft.timerSettings,
      paused: draft.paused,
      progress: {
        totalPicks: draft.draftSettings.totalRounds * draft.draftSettings.totalTeams,
        completedPicks: draft.picks.length,
        remainingPicks: (draft.draftSettings.totalRounds * draft.draftSettings.totalTeams) - draft.picks.length,
        percentComplete: (draft.picks.length / (draft.draftSettings.totalRounds * draft.draftSettings.totalTeams)) * 100,
      },
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      lastActivity: draft.lastActivity,
    };

    return NextResponse.json({ success: true, draft: response });

  } catch (error) {
    return handleError(error instanceof Error ? error : new Error('Unknown error'), `GET /api/drafts/${params.draftId}`);
  }
}

// DELETE /api/drafts/[draftId] - End/cancel draft
export async function DELETE(
  request: NextRequest,
  { params }: { params: { draftId: string } }
) {
  try {
    const { draftId } = params;

    logger.info('Ending draft via API', { draftId });

    // This would require implementing an end/cancel method in the engine
    // For now, we'll just log the request
    
    return NextResponse.json({ 
      success: true, 
      message: 'Draft end requested',
      draftId 
    });

  } catch (error) {
    return handleError(error instanceof Error ? error : new Error('Unknown error'), `DELETE /api/drafts/${params.draftId}`);
  }
}
