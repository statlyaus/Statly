import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';

interface CreateDraftRequest {
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime?: string;
}

interface Draft {
  id: string;
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  status: 'pending' | 'active' | 'completed';
  scheduledTime?: string;
  createdAt: string;
  currentPick?: number;
  currentRound?: number;
  participants: string[];
  picks: Array<{
    round: number;
    pick: number;
    playerId?: string;
    participantId: string;
    timestamp?: string;
  }>;
}

// In-memory storage for demo purposes - in production, use a database
const drafts = new Map<string, Draft>();

export async function POST(request: NextRequest) {
  try {
    const body: CreateDraftRequest = await request.json();
    
    // Validation
    if (!body.name?.trim()) {
      return errorResponse('Draft name is required', 400);
    }
    
    if (!body.leagueSize || body.leagueSize < 4 || body.leagueSize > 20) {
      return errorResponse('League size must be between 4 and 20', 400);
    }
    
    if (!['snake', 'linear'].includes(body.draftType)) {
      return errorResponse('Draft type must be "snake" or "linear"', 400);
    }
    
    if (!body.timePerPick || body.timePerPick < 30 || body.timePerPick > 600) {
      return errorResponse('Time per pick must be between 30 and 600 seconds', 400);
    }

    // Generate draft ID
    const draftId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create draft order
    const picks: Draft['picks'] = [];
    
    for (let round = 1; round <= 18; round++) {
      for (let pickInRound = 1; pickInRound <= body.leagueSize; pickInRound++) {
        let participantIndex: number;
        
        if (body.draftType === 'snake') {
          // Snake draft: reverse order on even rounds
          participantIndex = round % 2 === 1 
            ? pickInRound - 1 
            : body.leagueSize - pickInRound;
        } else {
          // Linear draft: same order every round
          participantIndex = pickInRound - 1;
        }
        
        picks.push({
          round,
          pick: (round - 1) * body.leagueSize + pickInRound,
          participantId: `participant_${participantIndex}`,
        });
      }
    }

    const draft: Draft = {
      id: draftId,
      name: body.name.trim(),
      leagueSize: body.leagueSize,
      draftType: body.draftType,
      timePerPick: body.timePerPick,
      status: body.scheduledTime ? 'pending' : 'active',
      scheduledTime: body.scheduledTime,
      createdAt: new Date().toISOString(),
      currentPick: body.scheduledTime ? undefined : 1,
      currentRound: body.scheduledTime ? undefined : 1,
      participants: Array.from({ length: body.leagueSize }, (_, i) => `participant_${i}`),
      picks,
    };

    // Store draft
    drafts.set(draftId, draft);

    logger.info('Draft created successfully', {
      draftId,
      name: draft.name,
      leagueSize: draft.leagueSize,
      draftType: draft.draftType,
      status: draft.status,
    });

    return successResponse(draft, 201);
    
  } catch (error) {
    logger.error('Failed to create draft', { 
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    });
    
    return errorResponse('Failed to create draft', 500);
  }
}

export async function GET() {
  try {
    // Return all drafts (in production, filter by user)
    const allDrafts = Array.from(drafts.values());
    
    logger.info('Drafts retrieved successfully', {
      count: allDrafts.length,
    });

    return successResponse(allDrafts);
    
  } catch (error) {
    logger.error('Failed to retrieve drafts', { 
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    });
    
    return errorResponse('Failed to retrieve drafts', 500);
  }
}
