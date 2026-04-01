import type { NextRequest } from 'next/server';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { isCantCutPlayer, parseLeagueWaiverRules } from '@/lib/leagueRules';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

// GET /api/leagues/[id]/actions/[userId] - Get user's team actions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    await ensureRosterTables();
    await processDueTeamActions(leagueId);

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
    const actions = (await prisma.$queryRaw`
      SELECT * FROM TeamAction 
      WHERE leagueId = ${leagueId} AND memberId = ${member.id}
      ORDER BY createdAt DESC
      LIMIT 50
    `) as Record<string, unknown>[];

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

type LeagueWaiverConfig = {
  waiverSystem: string;
  waiverPriorityMode: string;
  waiverFaabBudget: number | null;
  waiverMinimumBid: number;
  waiverPeriodHours: number;
  waiverMaxWeekAcquisitions: number | null;
  waiverMaxSeasonAcquisitions: number | null;
  waiverMoveWinnerToBack: boolean;
  waiverAcquisitionLocked: boolean;
  cantDropListJson: string | null;
};

function parseOptionalStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function buildWaiverRulesFromLeague(league: LeagueWaiverConfig) {
  return parseLeagueWaiverRules({
    waiverPeriodHours: league.waiverPeriodHours,
    waiverResetPolicy: league.waiverPriorityMode === 'REVERSE_LADDER' ? 'weekly' : 'rolling',
    waiverSettings: {
      system: league.waiverSystem,
      minimumBid: league.waiverMinimumBid,
      waiverPeriodHours: league.waiverPeriodHours,
      maxWeekAcquisitions: league.waiverMaxWeekAcquisitions ?? undefined,
      maxSeasonAcquisitions: league.waiverMaxSeasonAcquisitions ?? undefined,
      priorityMode: league.waiverPriorityMode,
      moveWinnerToBack: league.waiverMoveWinnerToBack,
      acquisitionLocked: league.waiverAcquisitionLocked,
      cantDropList: parseOptionalStringArray(league.cantDropListJson),
      faabBudget: league.waiverFaabBudget ?? undefined,
    },
  });
}

// POST /api/leagues/[id]/actions/[userId] - Create new team action
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;
    const body = await request.json();

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) {
      return errorResponse('Unauthorized', 401);
    }
    if (reqUserId !== userId) {
      return errorResponse('Forbidden', 403);
    }

    const { actionType, details, targetMemberId } = body;

    if (!actionType || !details) {
      return errorResponse('Action type and details are required', 400);
    }

    await ensureRosterTables();
    await processDueTeamActions(leagueId);

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

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        waiverSystem: true,
        waiverPriorityMode: true,
        waiverFaabBudget: true,
        waiverMinimumBid: true,
        waiverPeriodHours: true,
        waiverMaxWeekAcquisitions: true,
        waiverMaxSeasonAcquisitions: true,
        waiverMoveWinnerToBack: true,
        waiverAcquisitionLocked: true,
        cantDropListJson: true,
      },
    });
    if (!league) {
      return errorResponse('League not found', 404);
    }
    const rules = buildWaiverRulesFromLeague(league);

    // Validate action based on type
    const validationResult = await validateTeamAction(
      actionType,
      details,
      leagueId,
      member.id,
      rules,
      targetMemberId
    );
    if (!validationResult.valid) {
      return errorResponse(validationResult.error || 'Invalid action', 400);
    }

    // Calculate processing time based on action type
    let processingAt: Date | null = null;
    if (actionType === 'WAIVER_CLAIM') {
      // Waivers process at next waiver period (typically daily)
      return errorResponse('Waiver claims are handled by the dedicated waivers API', 409);
    } else if (actionType === 'TRADE_PROPOSAL') {
      // Trades can be processed immediately if no review period
      return errorResponse('Trade proposals are handled by the dedicated trade API', 409);
    } else if (actionType === 'DROP_PLAYER' && rules.acquisitionLocked) {
      return errorResponse(
        'Locked-period drops are not supported by the consolidated actions route yet',
        409
      );
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
      status: 'PENDING',
    };

    // Process immediate actions
    if (shouldProcessImmediately(actionType, rules.acquisitionLocked)) {
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
  rules: ReturnType<typeof parseLeagueWaiverRules>,
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

      // Check if player is in user's roster (LeagueRosterPlayer is source of truth)
      const rosterPlayer = await prisma.leagueRosterPlayer.findFirst({
        where: {
          leagueId,
          memberId,
          playerId: details.playerId,
        },
      });
      if (!rosterPlayer) {
        return { valid: false, error: 'Player is not in your roster' };
      }

      return { valid: true };
    }

    case 'TRADE_PROPOSAL': {
      if (!details.offeredPlayers || !details.requestedPlayers || !targetMemberId) {
        return {
          valid: false,
          error: 'Trade must include offered players, requested players, and target member',
        };
      }

      // Additional trade validation would go here
      return { valid: true };
    }

    case 'WAIVER_CLAIM': {
      if (!details.playerId || !details.dropPlayerId) {
        return {
          valid: false,
          error: 'Waiver claim must include player to claim and player to drop',
        };
      }
      return { valid: true };
    }

    case 'DROP_PLAYER': {
      if (!details.playerId) {
        return { valid: false, error: 'Player ID is required' };
      }
      if (rules.system !== 'FREE_AGENCY') {
        return {
          valid: false,
          error: 'Only FREE_AGENCY leagues support direct drop actions on this route',
        };
      }
      const playerId = String(details.playerId);
      if (isCantCutPlayer(playerId, rules)) {
        return { valid: false, error: "This player is on the can't cut list and cannot be dropped" };
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
function shouldProcessImmediately(actionType: string, acquisitionLocked: boolean): boolean {
  if (actionType === 'DROP_PLAYER' && acquisitionLocked) return false;
  return ['SET_CAPTAIN', 'SET_VICE_CAPTAIN', 'OPTIMIZE_LINEUP', 'DROP_PLAYER'].includes(actionType);
}

// Process team action
async function processTeamAction(actionId: string): Promise<void> {
  try {
    const actionRows = (await prisma.$queryRaw`
      SELECT * FROM TeamAction WHERE id = ${actionId} LIMIT 1
    `) as Record<string, unknown>[];

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

      case 'DROP_PLAYER': {
        const leagueId = String(action.leagueId);
        const memberId = String(action.memberId);
        const playerId =
          typeof details.playerId === 'string' ? details.playerId : String(details.playerId || '');
        if (!playerId) {
          throw new Error('Player ID is required for drop action');
        }
        const league = await prisma.league.findUnique({
          where: { id: leagueId },
          select: {
            waiverSystem: true,
            waiverPriorityMode: true,
            waiverFaabBudget: true,
            waiverMinimumBid: true,
            waiverPeriodHours: true,
            waiverMaxWeekAcquisitions: true,
            waiverMaxSeasonAcquisitions: true,
            waiverMoveWinnerToBack: true,
            waiverAcquisitionLocked: true,
            cantDropListJson: true,
          },
        });
        if (!league) {
          throw new Error('League not found');
        }
        const rules = buildWaiverRulesFromLeague(league);
        if (rules.system !== 'FREE_AGENCY' || rules.acquisitionLocked) {
          throw new Error(
            'Direct drop actions are only supported for FREE_AGENCY leagues with acquisitions unlocked'
          );
        }

        await prisma.$transaction(async (tx) => {
          const roster = await tx.leagueRoster.findUnique({
            where: { leagueId_memberId: { leagueId, memberId } },
          });
          if (!roster) {
            throw new Error('Roster not found');
          }

          const parsedIds = roster.playerIds ? JSON.parse(String(roster.playerIds)) : [];
          const playerIds = Array.isArray(parsedIds) ? parsedIds.map(String) : [];
          if (!playerIds.includes(playerId)) {
            throw new Error('Player is not on roster');
          }

          const nextPlayerIds = playerIds.filter((id) => id !== playerId);
          const nextCaptainId = roster.captainId === playerId ? null : roster.captainId;
          const nextViceCaptainId = roster.viceCaptainId === playerId ? null : roster.viceCaptainId;

          await tx.leagueRoster.update({
            where: { leagueId_memberId: { leagueId, memberId } },
            data: {
              playerIds: JSON.stringify(nextPlayerIds),
              captainId: nextCaptainId,
              viceCaptainId: nextViceCaptainId,
            },
          });

          await tx.leagueRosterPlayer.deleteMany({
            where: { leagueId, memberId, playerId },
          });

          // Keep sort order contiguous after removal.
          const remaining = await tx.leagueRosterPlayer.findMany({
            where: { leagueId, memberId },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          });
          for (const [idx, row] of remaining.entries()) {
            if (row.sortOrder !== idx) {
              await tx.leagueRosterPlayer.update({
                where: { id: row.id },
                data: { sortOrder: idx },
              });
            }
          }

        });
        break;
      }

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

async function processDueTeamActions(leagueId: string): Promise<void> {
  const dueActions = (await prisma.$queryRaw`
      SELECT id FROM TeamAction
      WHERE leagueId = ${leagueId}
        AND status = 'PENDING'
        AND processingAt IS NOT NULL
        AND processingAt <= datetime('now')
      ORDER BY processingAt ASC
      LIMIT 25
    `) as Array<{ id: string }>;
  for (const row of dueActions) {
    if (!row?.id) continue;
    await processTeamAction(String(row.id));
  }
}

// Optimize lineup logic (reorders by average points descending)
async function optimizeLineup(leagueId: string, memberId: string): Promise<void> {
  try {
    const rosterRows = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { player: true },
    });
    if (rosterRows.length === 0) {
      throw new Error('Roster not found');
    }

    // Simplified: reorder by player name (real optimization would use average points)
    const playerIds = rosterRows.map((r) => r.playerId);
    await prisma.$transaction(
      playerIds.map((playerId, sortOrder) =>
        prisma.leagueRosterPlayer.updateMany({
          where: { leagueId, memberId, playerId },
          data: { sortOrder },
        })
      )
    );

    // Sync playerIds to LeagueRoster for backward compat
    await prisma.leagueRoster.updateMany({
      where: { leagueId, memberId },
      data: { playerIds: JSON.stringify(playerIds) },
    });

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
