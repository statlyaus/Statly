import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import type { MultiIdParams } from '@/types/api';

// GET /api/leagues/[id]/actions/[userId] - Get user's team actions
export async function GET(
  request: NextRequest,
  { params }: MultiIdParams
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    await ensureRosterTables();

    // Get user's member record
    const member = await prisma.leagueMember.findFirst({
      where: {
        leagueId,
        userId,
      },
    });

    if (!member) {
      return errorResponse('User is not a member of this league', 404);
    }

    // Get user's actions using raw SQL as fallback
    const actions = await prisma.$queryRaw`
      SELECT * FROM TeamAction 
      WHERE leagueId = ${leagueId} AND memberId = ${member.id}
      ORDER BY createdAt DESC
      LIMIT 50
    ` as Record<string, unknown>[];

    const formattedActions = actions.map((action: Record<string, unknown>) => ({
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      details: JSON.parse(String(action.details || '{}')),
      targetMemberId: action.targetMemberId,
      processingAt: action.processingAt,
      processedAt: action.processedAt,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
    }));

    return successResponse({
      actions: formattedActions,
    });

  } catch (error) {
    logger.error('Failed to get team actions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to retrieve team actions', 500);
  }
}

// POST /api/leagues/[id]/actions/[userId] - Create new team action
export async function POST(
  request: NextRequest,
  { params }: MultiIdParams
) {
  try {
    const { id: leagueId, userId } = await params;
    const body = await request.json();

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    const { actionType, details, targetMemberId } = body;

    if (!actionType || !details) {
      return errorResponse('Action type and details are required', 400);
    }

    await ensureRosterTables();

    // Get user's member record
    const member = await prisma.leagueMember.findFirst({
      where: {
        leagueId,
        userId,
      },
    });

    if (!member) {
      return errorResponse('User is not a member of this league', 404);
    }

    // Validate action based on type
    const validationResult = await validateTeamAction(actionType, details, leagueId, member.id, targetMemberId);
    if (!validationResult.valid) {
      return errorResponse(validationResult.error || 'Invalid action', 400);
    }

    // Calculate processing time based on action type
    let processingAt: Date | null = null;
    if (actionType === 'WAIVER_CLAIM') {
      // Waivers process at next waiver period (typically daily)
      processingAt = new Date();
      processingAt.setHours(23, 59, 59, 999); // End of day
    } else if (actionType === 'TRADE_PROPOSAL') {
      // Trades can be processed immediately if no review period
      processingAt = new Date();
    }

    // Create the action using raw SQL
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await prisma.$executeRaw`
      INSERT INTO TeamAction (id, leagueId, memberId, actionType, details, targetMemberId, processingAt, createdAt, updatedAt)
      VALUES (${actionId}, ${leagueId}, ${member.id}, ${actionType}, ${JSON.stringify(details)}, ${targetMemberId}, ${processingAt}, datetime('now'), datetime('now'))
    `;

    const action = {
      id: actionId,
      leagueId,
      memberId: member.id,
      actionType,
      details: JSON.stringify(details),
      targetMemberId,
      processingAt,
      createdAt: new Date(),
      status: 'PENDING'
    };

    // Process immediate actions
    if (shouldProcessImmediately(actionType)) {
      await processTeamAction(action.id);
    }

    logger.info('Created team action', {
      leagueId,
      memberId: member.id,
      actionType,
      actionId: action.id,
    });

    return successResponse({
      action: {
        id: action.id,
        actionType: action.actionType,
        status: action.status,
        details: JSON.parse(action.details),
        targetMemberId: action.targetMemberId,
        processingAt: action.processingAt,
        createdAt: action.createdAt,
      },
    });

  } catch (error) {
    logger.error('Failed to create team action', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create team action', 500);
  }
}

// Validation logic for different action types
async function validateTeamAction(
  actionType: string,
  details: Record<string, unknown>,
  leagueId: string,
  memberId: string,
  targetMemberId?: string
): Promise<{ valid: boolean; error?: string }> {
  switch (actionType) {
    case 'SET_CAPTAIN':
    case 'SET_VICE_CAPTAIN': {
      if (!details.playerId) {
        return { valid: false, error: 'Player ID is required' };
      }
      
      // Check if captain system is enabled
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        include: { settings: true },
      });
      
      // For now, assume captain system is enabled if settings exist
      // TODO: Add enableCaptainSystem field to league settings
      if (!league?.settings) {
        return { valid: false, error: 'League settings not found' };
      }
      
      // Check if player is in user's roster using raw SQL
      const rosterRows = await prisma.$queryRaw`
        SELECT * FROM LeagueRoster 
        WHERE leagueId = ${leagueId} AND memberId = ${memberId}
        LIMIT 1
      ` as Record<string, unknown>[];
      
      const roster = rosterRows[0];
      if (!roster) {
        return { valid: false, error: 'User has no roster in this league' };
      }
      
      const playerIds = JSON.parse(String(roster.playerIds || '[]'));
      if (!playerIds.includes(details.playerId)) {
        return { valid: false, error: 'Player is not in your roster' };
      }
      
      return { valid: true };
    }

    case 'TRADE_PROPOSAL': {
      if (!details.offeredPlayers || !details.requestedPlayers || !targetMemberId) {
        return { valid: false, error: 'Trade must include offered players, requested players, and target member' };
      }
      
      // Additional trade validation would go here
      return { valid: true };
    }

    case 'WAIVER_CLAIM': {
      if (!details.playerId || !details.dropPlayerId) {
        return { valid: false, error: 'Waiver claim must include player to claim and player to drop' };
      }
      
      // Additional waiver validation would go here
      return { valid: true };
    }

    case 'DROP_PLAYER': {
      if (!details.playerId) {
        return { valid: false, error: 'Player ID is required' };
      }
      return { valid: true };
    }

    case 'OPTIMIZE_LINEUP': {
      // Optimization requests are always valid
      return { valid: true };
    }

    default:
      return { valid: false, error: 'Unknown action type' };
  }
}

// Determine if action should be processed immediately
function shouldProcessImmediately(actionType: string): boolean {
  return ['SET_CAPTAIN', 'SET_VICE_CAPTAIN', 'OPTIMIZE_LINEUP'].includes(actionType);
}

// Process team action
async function processTeamAction(actionId: string): Promise<void> {
  try {
    const actionRows = await prisma.$queryRaw`
      SELECT * FROM TeamAction WHERE id = ${actionId} LIMIT 1
    ` as Record<string, unknown>[];
    
    const action = actionRows[0];
    if (!action || action.status !== 'PENDING') {
      return;
    }

    const details = JSON.parse(String(action.details || '{}'));

    switch (action.actionType) {
      case 'SET_CAPTAIN':
        await prisma.$executeRaw`
          UPDATE LeagueRoster 
          SET captainId = ${details.playerId}
          WHERE leagueId = ${action.leagueId} AND memberId = ${action.memberId}
        `;
        break;

      case 'SET_VICE_CAPTAIN':
        await prisma.$executeRaw`
          UPDATE LeagueRoster 
          SET viceCaptainId = ${details.playerId}
          WHERE leagueId = ${action.leagueId} AND memberId = ${action.memberId}
        `;
        break;

      case 'OPTIMIZE_LINEUP':
        // Implement lineup optimization logic
        await optimizeLineup(String(action.leagueId), String(action.memberId));
        break;

      // Additional action processing...
    }

    // Mark action as processed
    await prisma.$executeRaw`
      UPDATE TeamAction 
      SET status = 'PROCESSED', processedAt = datetime('now')
      WHERE id = ${actionId}
    `;

    logger.info('Processed team action', {
      actionId,
      actionType: action.actionType,
    });

  } catch (error) {
    logger.error('Failed to process team action', {
      actionId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Mark action as failed
    await prisma.$executeRaw`
      UPDATE TeamAction 
      SET status = 'REJECTED', processedAt = datetime('now')
      WHERE id = ${actionId}
    `;
  }
}

// Optimize lineup logic
async function optimizeLineup(leagueId: string, memberId: string): Promise<void> {
  try {
    // Get current roster
    const rosterRows = await prisma.$queryRaw`
      SELECT * FROM LeagueRoster 
      WHERE leagueId = ${leagueId} AND memberId = ${memberId}
      LIMIT 1
    ` as Record<string, unknown>[];
    
    const roster = rosterRows[0];
    if (!roster) {
      throw new Error('Roster not found');
    }

    const playerList = JSON.parse(String(roster.playerList || '[]'));
    
    // Implement basic optimization logic
    // This is a simplified example - real optimization would be more complex
    const optimizedLineup = playerList.sort((a: {averagePoints?: number}, b: {averagePoints?: number}) => {
      return (b.averagePoints || 0) - (a.averagePoints || 0);
    });

    await prisma.$executeRaw`
      UPDATE LeagueRoster 
      SET playerList = ${JSON.stringify(optimizedLineup)}
      WHERE leagueId = ${leagueId} AND memberId = ${memberId}
    `;

    logger.info('Optimized lineup', { leagueId, memberId });
  } catch (error) {
    logger.error('Failed to optimize lineup', {
      leagueId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
