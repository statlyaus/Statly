import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftDirection, DraftStatus } from '@prisma/client';

interface PickRequest {
  playerId: string;
  memberId: string;
}

/**
 * Snake Draft Logic Implementation
 * - N = team count; R = rosterSize + benchSize; totalPicks = N * R
 * - round = ceil(currentPick / N)
 * - direction = (round % 2 === 1) ? FORWARD : REVERSE
 * - slot = direction === FORWARD ? ((currentPick-1) % N) + 1 : N - ((currentPick-1) % N)
 */
function calculateSnakeLogic(currentPick: number, teamCount: number) {
  const round = Math.ceil(currentPick / teamCount);
  const direction = round % 2 === 1 ? DraftDirection.FORWARD : DraftDirection.REVERSE;

  let slot: number;
  if (direction === DraftDirection.FORWARD) {
    slot = ((currentPick - 1) % teamCount) + 1;
  } else {
    slot = teamCount - ((currentPick - 1) % teamCount);
  }

  return { round, direction, slot };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;
    const body: PickRequest = await request.json();
    const { playerId, memberId } = body;

    if (!playerId || !memberId) {
      return commonErrors.badRequest('Missing playerId or memberId');
    }

    // Get draft with all necessary data
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
            members: true,
          },
        },
        orders: {
          orderBy: { slot: 'asc' },
        },
        picks: {
          orderBy: { overall: 'asc' },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (draft.status !== DraftStatus.LIVE) {
      return commonErrors.badRequest('Draft is not active');
    }

    const { league } = draft;
    if (!league?.settings) {
      return commonErrors.badRequest('Draft settings not found');
    }

    const teamCount = league.members.length;
    const rosterSize = league.settings.rosterSize + league.settings.benchSize;
    const totalPicks = teamCount * rosterSize;

    // Validate draft is not complete
    if (draft.currentPick > totalPicks) {
      return commonErrors.badRequest('Draft is already complete');
    }

    // Calculate snake logic for current pick
    const { round, direction, slot } = calculateSnakeLogic(draft.currentPick, teamCount);

    // Find the member who should be picking
    const draftOrder = draft.orders.find((order) => order.slot === slot);
    if (!draftOrder) {
      return commonErrors.badRequest('Invalid draft order');
    }

    // Validate it's the correct member's turn
    if (draftOrder.memberId !== memberId) {
      return commonErrors.badRequest('Not your turn to pick');
    }

    // Validate player exists and is available
    const player = await prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player || !player.active) {
      return commonErrors.badRequest('Player not found or not available');
    }

    // Validate player hasn't been picked already
    const existingPick = draft.picks.find((pick) => pick.playerId === playerId);
    if (existingPick) {
      return commonErrors.badRequest('Player already picked');
    }

    // Validate member hasn't exceeded roster capacity for this round
    const memberPicks = draft.picks.filter((pick) => pick.memberId === memberId);
    if (memberPicks.length >= rosterSize) {
      return commonErrors.badRequest('Roster is full');
    }

    // Check queue for auto-pick preference
    const queueItem = await prisma.queueItem.findFirst({
      where: {
        memberId,
        playerId,
      },
    });

    // Execute the pick in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the pick
      const pick = await tx.pick.create({
        data: {
          draftId,
          overall: draft.currentPick,
          round,
          slot,
          memberId,
          playerId,
          auto: false, // Manual pick
        },
        include: {
          player: true,
          member: {
            include: {
              user: true,
            },
          },
        },
      });

      // Remove from queue if it was queued
      if (queueItem) {
        await tx.queueItem.delete({
          where: { id: queueItem.id },
        });
      }

      // Calculate next pick state
      const nextPick = draft.currentPick + 1;
      const isComplete = nextPick > totalPicks;

      interface DraftUpdateData {
        currentPick: number;
        status?: DraftStatus;
        completedAt?: Date;
        round?: number;
        direction?: DraftDirection;
      }

      let updateData: DraftUpdateData = {
        currentPick: nextPick,
      };

      if (isComplete) {
        updateData.status = DraftStatus.COMPLETED;
        updateData.completedAt = new Date();
      } else {
        // Calculate next round/direction for the upcoming pick
        const nextState = calculateSnakeLogic(nextPick, teamCount);
        updateData.round = nextState.round;
        updateData.direction = nextState.direction;
      }

      // Update draft state
      await tx.draft.update({
        where: { id: draftId },
        data: updateData,
      });

      return { pick, isComplete, nextPick };
    });

    logger.info('Pick made successfully', {
      draftId,
      pickNumber: draft.currentPick,
      round,
      slot,
      direction,
      playerId,
      playerName: result.pick.player.name,
      memberId,
      isComplete: result.isComplete,
    });

    return successResponse({
      pick: result.pick,
      currentPick: result.nextPick,
      isComplete: result.isComplete,
      nextTurn: result.isComplete ? null : calculateSnakeLogic(result.nextPick, teamCount),
    });
  } catch (error) {
    logger.error('Failed to make pick', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to make pick', 500);
  }
}
