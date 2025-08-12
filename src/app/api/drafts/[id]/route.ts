import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // For demo purposes, return mock data
    const mockDraft = {
      id,
      name: 'Mock AFL Draft',
      leagueSize: 12,
      draftType: 'snake' as const,
      timePerPick: 120,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      currentPick: 1,
      currentRound: 1,
      participants: Array.from({ length: 12 }, (_, i) => `participant_${i}`),
      players: [
        { id: '1', name: 'Marcus Bontempelli', position: 'MID' },
        { id: '2', name: 'Clayton Oliver', position: 'MID' },
        { id: '3', name: 'Sam Walsh', position: 'MID' },
        { id: '4', name: 'Lachie Neale', position: 'MID' },
        { id: '5', name: 'Christian Petracca', position: 'MID' },
        { id: '6', name: 'Max Gawn', position: 'RUC' },
        { id: '7', name: 'Brodie Grundy', position: 'RUC' },
        { id: '8', name: 'Jeremy Cameron', position: 'FWD' },
        { id: '9', name: 'Charlie Curnow', position: 'FWD' },
        { id: '10', name: 'Tom Lynch', position: 'FWD' },
      ],
      picks: []
    };
    
    logger.info('Draft retrieved successfully', {
      draftId: id,
      status: mockDraft.status,
    });

    return successResponse(mockDraft);
    
  } catch (error) {
    logger.error('Failed to retrieve draft', { 
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    });
    
    return errorResponse('Failed to retrieve draft', 500);
  }
}
